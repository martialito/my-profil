import { Router } from 'express';
import { and, count, desc, eq, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import type { Db } from '../../database/client.js';
import { applicationEvents, applications, jobAnalysis, jobs, searchRuns } from '../../database/schema.js';
import { profileCompleteness } from '../../models/profile.js';
import { NotificationService } from '../../notifications/notification.service.js';
import { MasterCvService } from '../../services/master-cv.service.js';
import { ProfileService } from '../../services/profile.service.js';
import { SettingsService } from '../../services/settings.service.js';

/** Real counts from the database. */
export function dashboardRoutes(db: Db): Router {
  const r = Router();
  // One row per real offer: duplicates grouped under another job are not counted.
  const canonical = and(or(isNull(jobs.duplicateGroupId), eq(jobs.duplicateGroupId, jobs.id)), isNull(jobs.closedAt));
  const latest = (col: string) => sql.raw(`(select ja.${col} from job_analysis ja where ja.job_id = jobs.id order by ja.id desc limit 1)`);

  r.get('/', (_req, res) => {
    const notifier = new NotificationService(db);
    notifier.checkFollowUps();
    const c = (q: { count: number } | undefined) => q?.count ?? 0;
    const settings = new SettingsService(db).get();
    const profile = new ProfileService(db).get();
    const master = new MasterCvService(db).latest();
    const appCount = (statuses: string[]) => c(db.select({ count: count() }).from(applications).where(inArray(applications.status, statuses)).get());
    const notif = notifier.counts();

    const topJobs = db
      .select({
        id: jobs.id,
        company: jobs.company,
        title: jobs.title,
        startDate: jobs.startDate,
        periodHints: jobs.periodHints,
        jobStatus: jobs.status,
        applicationUrl: jobs.applicationUrl,
        sourceUrl: jobs.sourceUrl,
        score: sql<number | null>`${latest('overall_score')}`,
        category: sql<string | null>`${latest('category')}`,
        dateStatus: sql<string | null>`${latest('date_status')}`,
        applicationId: applications.id,
        applicationStatus: applications.status,
        hasResume: sql<boolean>`${applications.resumeId} is not null`,
        hasLetter: sql<boolean>`${applications.coverLetterId} is not null`,
      })
      .from(jobs)
      .leftJoin(applications, eq(applications.jobId, jobs.id))
      .where(and(canonical, sql`${jobs.status} != 'SKIPPED'`))
      .orderBy(sql`${latest('overall_score')} desc nulls last`, desc(jobs.id))
      .limit(15)
      .all();

    const recentEvents = db
      .select({ id: applicationEvents.id, message: applicationEvents.message, toStatus: applicationEvents.toStatus, createdAt: applicationEvents.createdAt, company: jobs.company, title: jobs.title, applicationId: applications.id })
      .from(applicationEvents)
      .innerJoin(applications, eq(applicationEvents.applicationId, applications.id))
      .innerJoin(jobs, eq(applications.jobId, jobs.id))
      .orderBy(desc(applicationEvents.id))
      .limit(10)
      .all();

    res.json({
      stats: {
        totalJobs: c(db.select({ count: count() }).from(jobs).where(canonical).get()),
        newJobs: c(db.select({ count: count() }).from(jobs).where(and(canonical, eq(jobs.status, 'FOUND'))).get()),
        matchingJobs: c(db.select({ count: count() }).from(jobs).where(and(canonical, sql`${latest('category')} in ('GREEN', 'YELLOW')`)).get()),
        highMatch: c(db.select({ count: count() }).from(jobs).where(and(canonical, sql`${latest('category')} = 'GREEN'`)).get()),
        applications: c(db.select({ count: count() }).from(applications).get()),
        applicationsPrepared: appCount(['CV_CREATED', 'COVER_LETTER_CREATED', 'READY_TO_APPLY']),
        applicationsSubmitted: c(db.select({ count: count() }).from(applications).where(isNotNull(applications.submittedAt)).get()),
        needsValidation: notif.actionRequired,
        responses: appCount(['INTERVIEW', 'OFFER', 'REJECTED']),
        interviews: appCount(['INTERVIEW']),
        offers: appCount(['OFFER']),
        rejected: appCount(['REJECTED']),
      },
      topJobs,
      recentEvents,
      notifications: notif,
      profile: profileCompleteness(profile),
      masterCv: master ? { version: master.version, createdAt: master.createdAt } : null,
      lastSearch: db.select().from(searchRuns).orderBy(desc(searchRuns.id)).limit(1).get() ?? null,
      lastAnalysis: db.select({ createdAt: jobAnalysis.createdAt }).from(jobAnalysis).orderBy(desc(jobAnalysis.id)).limit(1).get() ?? null,
      testMode: settings.automation.testMode,
      applicationMode: settings.automation.applicationMode,
    });
  });
  return r;
}
