import { and, asc, desc, eq, like, or, sql, type SQL } from 'drizzle-orm';
import { assertTransition, followUpDate, TransitionError } from '../application/state-machine.js';
import type { Db } from '../database/client.js';
import { applicationEvents, applications, coverLetters, jobAnalysis, jobs, resumes } from '../database/schema.js';
import { ApplicationStatuses, type ApplicationStatus } from '../models/statuses.js';
import { AppError, NotFoundError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { SettingsService } from './settings.service.js';

const NOW = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;
const today = () => new Date().toISOString().slice(0, 10);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface TransitionInput {
  to: ApplicationStatus;
  note?: string;
  /** APPLIED only: date you submitted (defaults to today). */
  applicationDate?: string;
  /** APPLIED only: confirmation e-mail subject/text or confirmation page URL, when you have one. */
  confirmationText?: string;
  confirmationUrl?: string;
}

export class ApplicationService {
  constructor(private readonly db: Db) {}

  /** The application for a job, created on demand (one application per job). */
  forJob(jobId: number) {
    const job = this.db.select({ id: jobs.id, status: jobs.status }).from(jobs).where(eq(jobs.id, jobId)).get();
    if (!job) throw new NotFoundError(`Job ${jobId}`);
    let app = this.db.select().from(applications).where(eq(applications.jobId, jobId)).get();
    if (!app) {
      app = this.db.insert(applications).values({ jobId, status: 'SHORTLISTED' }).returning().get();
      this.event(app.id, 'created', null, 'SHORTLISTED', 'Added to the tracker');
    }
    return app;
  }

  private event(applicationId: number, type: string, from: string | null, to: string | null, message: string, data?: unknown): void {
    this.db.insert(applicationEvents).values({ applicationId, type, fromStatus: from, toStatus: to, message, data: data ?? null }).run();
  }

  private row(id: number) {
    const app = this.db.select().from(applications).where(eq(applications.id, id)).get();
    if (!app) throw new NotFoundError(`Application ${id}`);
    return app;
  }

  list(q: { status?: string; q?: string; active?: boolean } = {}) {
    const score = sql<number | null>`(select ja.overall_score from ${jobAnalysis} ja where ja.job_id = ${jobs.id} order by ja.id desc limit 1)`;
    const category = sql<string | null>`(select ja.category from ${jobAnalysis} ja where ja.job_id = ${jobs.id} order by ja.id desc limit 1)`;
    const resumeVersion = sql<number | null>`(select r.version from ${resumes} r where r.id = ${applications.resumeId})`;
    const letterVersion = sql<number | null>`(select c.version from ${coverLetters} c where c.id = ${applications.coverLetterId})`;
    const where: SQL[] = [];
    if (q.status) where.push(eq(applications.status, q.status));
    if (q.active) where.push(sql`${applications.status} not in ('REJECTED', 'WITHDRAWN')`);
    if (q.q) where.push(or(like(jobs.company, `%${q.q}%`), like(jobs.title, `%${q.q}%`))!);
    return this.db
      .select({
        id: applications.id,
        jobId: jobs.id,
        company: jobs.company,
        title: jobs.title,
        location: jobs.location,
        startDate: jobs.startDate,
        periodHints: jobs.periodHints,
        applicationUrl: jobs.applicationUrl,
        sourceUrl: jobs.sourceUrl,
        status: applications.status,
        mode: applications.mode,
        isSimulation: applications.isSimulation,
        applicationDate: applications.applicationDate,
        submittedAt: applications.submittedAt,
        confirmationSource: applications.confirmationSource,
        followUpDate: applications.followUpDate,
        notes: applications.notes,
        resumeVersion,
        letterVersion,
        score,
        category,
        updatedAt: applications.updatedAt,
      })
      .from(applications)
      .innerJoin(jobs, eq(applications.jobId, jobs.id))
      .where(where.length ? and(...where) : undefined)
      .orderBy(desc(applications.updatedAt))
      .all();
  }

  get(id: number) {
    const app = this.list().find((a) => a.id === id);
    if (!app) throw new NotFoundError(`Application ${id}`);
    const row = this.row(id);
    const events = this.db.select().from(applicationEvents).where(eq(applicationEvents.applicationId, id)).orderBy(asc(applicationEvents.id)).all();
    return { ...app, confirmationText: row.confirmationText, confirmationUrl: row.confirmationUrl, resumeId: row.resumeId, coverLetterId: row.coverLetterId, events };
  }

  transition(id: number, input: TransitionInput) {
    const app = this.row(id);
    const from = app.status as ApplicationStatus;
    if (!ApplicationStatuses.includes(input.to)) throw new AppError(`Unknown status ${input.to}`);
    const applied = input.to === 'APPLIED';
    if (applied && input.applicationDate && !DATE_RE.test(input.applicationDate)) throw new AppError('applicationDate must be YYYY-MM-DD');
    try {
      assertTransition(from, input.to, {
        hasResume: app.resumeId !== null,
        hasCoverLetter: app.coverLetterId !== null,
        isSimulation: app.isSimulation,
        // Through the API the only possible confirmation is yours ("I submitted it myself").
        confirmation: applied ? { source: 'user', text: input.confirmationText, url: input.confirmationUrl } : undefined,
      });
    } catch (err) {
      if (err instanceof TransitionError) throw new AppError(err.message, 409, 'INVALID_TRANSITION');
      throw err;
    }

    const patch: Partial<typeof applications.$inferInsert> = { status: input.to, updatedAt: NOW as unknown as string };
    if (applied) {
      const date = input.applicationDate ?? today();
      Object.assign(patch, {
        applicationDate: date,
        submittedAt: new Date().toISOString(),
        confirmationSource: 'user',
        confirmationText: input.confirmationText ?? null,
        confirmationUrl: input.confirmationUrl ?? null,
        isSimulation: false,
        followUpDate: followUpDate(date, new SettingsService(this.db).get().automation.followUpDays),
      });
    }
    if (input.to === 'INTERVIEW' || input.to === 'OFFER' || input.to === 'REJECTED' || input.to === 'WITHDRAWN') {
      patch.followUpDate = null; // a response (or withdrawal) cancels the pending follow-up
    }
    this.db.transaction((tx) => {
      tx.update(applications).set(patch).where(eq(applications.id, id)).run();
      tx.insert(applicationEvents)
        .values({
          applicationId: id,
          type: 'status',
          fromStatus: from,
          toStatus: input.to,
          message: input.note ?? (applied ? 'You confirmed that you submitted this application.' : `Status changed to ${input.to}`),
          data: applied ? { confirmationSource: 'user', applicationDate: patch.applicationDate, confirmationText: input.confirmationText, confirmationUrl: input.confirmationUrl } : null,
        })
        .run();
    });
    logger.info(`Application #${id}: ${from} → ${input.to}`);
    return this.get(id);
  }

  /**
   * Record a submission CONFIRMED BY THE SITE (Phase 7 engine only, never reachable from the API directly).
   */
  recordSiteSubmission(id: number, proof: { confirmationText: string; confirmationUrl: string; screenshotPath?: string }) {
    const app = this.row(id);
    try {
      assertTransition(app.status as ApplicationStatus, 'APPLIED', {
        hasResume: app.resumeId !== null,
        hasCoverLetter: app.coverLetterId !== null,
        isSimulation: false,
        confirmation: { source: 'site', text: proof.confirmationText, url: proof.confirmationUrl },
      });
    } catch (err) {
      if (err instanceof TransitionError) throw new AppError(err.message, 409, 'INVALID_TRANSITION');
      throw err;
    }
    const date = today();
    this.db.transaction((tx) => {
      tx.update(applications)
        .set({
          status: 'APPLIED',
          isSimulation: false,
          applicationDate: date,
          submittedAt: new Date().toISOString(),
          confirmationSource: 'site',
          confirmationText: proof.confirmationText,
          confirmationUrl: proof.confirmationUrl,
          screenshotPath: proof.screenshotPath ?? null,
          followUpDate: followUpDate(date, new SettingsService(this.db).get().automation.followUpDays),
          updatedAt: NOW as unknown as string,
        })
        .where(eq(applications.id, id))
        .run();
      tx.insert(applicationEvents)
        .values({ applicationId: id, type: 'status', fromStatus: app.status, toStatus: 'APPLIED', message: 'Submitted after your click — confirmed by the website.', data: { confirmationSource: 'site', ...proof } })
        .run();
    });
    logger.info(`Application #${id}: submitted and confirmed by the website`);
    return this.get(id);
  }

  update(id: number, patch: { notes?: string | null; followUpDate?: string | null }) {
    const app = this.row(id);
    if (patch.followUpDate && !DATE_RE.test(patch.followUpDate)) throw new AppError('followUpDate must be YYYY-MM-DD');
    this.db.update(applications).set({ ...patch, updatedAt: NOW as unknown as string }).where(eq(applications.id, id)).run();
    if (patch.followUpDate !== undefined && patch.followUpDate !== app.followUpDate) {
      this.event(id, 'follow_up', null, null, patch.followUpDate ? `Follow-up planned for ${patch.followUpDate}` : 'Follow-up cancelled');
    }
    if (patch.notes !== undefined && patch.notes !== app.notes) this.event(id, 'note', null, null, 'Notes updated');
    return this.get(id);
  }

  /** Counts per status, used by the dashboard. */
  statusCounts(): Record<string, number> {
    const rows = this.db.select({ status: applications.status, n: sql<number>`count(*)` }).from(applications).groupBy(applications.status).all();
    return Object.fromEntries(rows.map((r) => [r.status, r.n]));
  }
}
