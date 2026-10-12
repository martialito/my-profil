import fs from 'node:fs';
import path from 'node:path';
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { finalCheck, type FinalCheck } from '../application/final-check.js';
import { planForm, type FillPlan } from '../application/form-plan.js';
import { simulateApplication, type SimulationResult } from '../browser/engine.js';
import { paths } from '../config/env.js';
import { resumeToPdf } from '../cv/render.js';
import type { Db } from '../database/client.js';
import { applicationEvents, applications, coverLetters, jobAnalysis, jobs, resumes } from '../database/schema.js';
import { ApplicationModes, type ApplicationMode } from '../models/common.js';
import type { MasterCvContent } from '../models/master-cv.js';
import { NotificationService } from '../notifications/notification.service.js';
import { AppError, NotFoundError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { AnswerBankService } from './answer-bank.service.js';
import { MasterCvService } from './master-cv.service.js';
import { ProfileService } from './profile.service.js';
import { SettingsService } from './settings.service.js';

export interface SimulateOptions {
  /** Answers you give for this application, keyed by field label. */
  answers?: Record<string, string>;
  /** Labels whose answer should also be saved to the Answer Bank. */
  saveToBank?: string[];
  /** Override the URL (used for the local demo form only). */
  url?: string;
}

const abs = (p: string | null | undefined) => (p ? path.resolve(process.cwd(), p) : undefined);
const cleanLabel = (l: string) => l.replace(/\s*\*\s*$/, '').trim();

export class ApplicationEngineService {
  constructor(private readonly db: Db) {}

  private app(id: number) {
    const a = this.db.select().from(applications).where(eq(applications.id, id)).get();
    if (!a) throw new NotFoundError(`Application ${id}`);
    const job = this.db.select().from(jobs).where(eq(jobs.id, a.jobId)).get()!;
    return { a, job };
  }

  setMode(id: number, mode: ApplicationMode | null) {
    if (mode !== null && !ApplicationModes.includes(mode)) throw new AppError('Invalid mode');
    this.app(id);
    this.db.update(applications).set({ mode }).where(eq(applications.id, id)).run();
    this.db.insert(applicationEvents).values({ applicationId: id, type: 'mode', message: mode ? `Application mode set to ${mode}` : 'Application mode reset to the global setting' }).run();
  }

  effectiveMode(id: number): ApplicationMode {
    return this.app(id).a.mode ?? new SettingsService(this.db).get().automation.applicationMode;
  }

  /** Contradictions between Answer Bank answers and My Profile. */
  contradictions(): string[] {
    const wa = new ProfileService(this.db).get().workAuthorization;
    const out: string[] = [];
    for (const e of new AnswerBankService(this.db).list()) {
      if (!e.answer) continue;
      const yes = /^y(es)?\b/i.test(e.answer.trim());
      const no = /^no?\b/i.test(e.answer.trim());
      if (e.category === 'work_authorization' && wa.authorizedToWorkInUS && ((yes && wa.authorizedToWorkInUS === 'no') || (no && wa.authorizedToWorkInUS === 'yes'))) {
        out.push(`Answer Bank says "${e.answer}" to "${e.question}" but My Profile says ${wa.authorizedToWorkInUS}.`);
      }
      if (e.category === 'sponsorship' && wa.requiresSponsorship && ((yes && wa.requiresSponsorship === 'no') || (no && wa.requiresSponsorship === 'yes'))) {
        out.push(`Answer Bank says "${e.answer}" to "${e.question}" but My Profile says ${wa.requiresSponsorship}.`);
      }
    }
    return out;
  }

  dailyLimit() {
    const today = new Date().toISOString().slice(0, 10);
    const submittedToday = this.db.select({ n: sql<number>`count(*)` }).from(applications).where(gte(applications.submittedAt, today)).get()?.n ?? 0;
    return { submittedToday, max: new SettingsService(this.db).get().automation.maxApplicationsPerDay };
  }

  private documents(jobId: number) {
    const resume = this.db.select().from(resumes).where(and(eq(resumes.kind, 'tailored'), eq(resumes.jobId, jobId))).orderBy(desc(resumes.version)).limit(1).get();
    const letter = this.db.select().from(coverLetters).where(eq(coverLetters.jobId, jobId)).orderBy(desc(coverLetters.version)).limit(1).get();
    return { resume, letter };
  }

  check(id: number, sim?: { plan?: FillPlan; pageText?: string }): FinalCheck & { summary: Record<string, string | number | null>; mode: ApplicationMode } {
    const { job } = this.app(id);
    const profile = new ProfileService(this.db).get();
    const { resume, letter } = this.documents(job.id);
    const analysis = this.db.select().from(jobAnalysis).where(eq(jobAnalysis.jobId, job.id)).orderBy(desc(jobAnalysis.id)).limit(1).get();
    const rChecks = resume?.checks as { violations?: unknown[] } | null;
    const lChecks = letter?.checks as { issues?: string[]; inventedNumbers?: string[]; unverifiedClaims?: string[] } | null;
    const date = analysis?.dateDetails as { autoSubmitSafe?: boolean; period?: { start?: string; end?: string } } | null;
    const res = finalCheck({
      job: { id: job.id, company: job.company, title: job.title, location: job.location, locationMatch: job.locationMatch },
      candidate: profile.personal,
      resume: resume ? { jobId: resume.jobId, fileExists: !!abs(resume.pdfPath) && fs.existsSync(abs(resume.pdfPath)!), personal: (resume.content as MasterCvContent).personal, violations: rChecks?.violations?.length ?? 0, version: resume.version } : null,
      coverLetter: letter ? { jobId: letter.jobId, fileExists: !!abs(letter.pdfPath) && fs.existsSync(abs(letter.pdfPath)!), issues: lChecks?.issues ?? [], inventedNumbers: lChecks?.inventedNumbers ?? [], unverifiedClaims: lChecks?.unverifiedClaims ?? [], version: letter.version } : null,
      analysis: analysis ? { dateStatus: analysis.dateStatus, dateAutoSafe: !!date?.autoSubmitSafe, score: analysis.overallScore, category: analysis.category } : null,
      plan: sim?.plan,
      pageText: sim?.pageText,
      contradictions: this.contradictions(),
      dailyLimit: this.dailyLimit(),
    });
    return {
      ...res,
      mode: this.effectiveMode(id),
      summary: {
        Company: job.company,
        Position: job.title,
        Location: job.location,
        'Start date': date?.period?.start ?? job.startDate ?? null,
        'End date': date?.period?.end ?? job.endDate ?? null,
        Score: analysis?.overallScore ?? null,
        CV: resume ? `resume.pdf (v${resume.version})` : null,
        'Cover Letter': letter ? `cover-letter.pdf (v${letter.version})` : null,
      },
    };
  }

  private saveAnswers(plan: FillPlan | undefined, opts: SimulateOptions): void {
    if (!opts.saveToBank?.length || !opts.answers) return;
    const bank = new AnswerBankService(this.db);
    for (const label of opts.saveToBank) {
      const answer = opts.answers[label];
      if (!answer) continue;
      const item = plan?.items.find((i) => i.field.label === label);
      if (item?.match?.entryId && item.match.status !== 'unknown') {
        const entry = bank.list().find((e) => e.id === item.match!.entryId)!;
        // Confirmed: keep the answer and remember this wording.
        bank.update(entry.id, { ...entry, answer: entry.answer ?? answer });
        bank.addAlias(entry.id, cleanLabel(label));
      } else {
        bank.create({ question: cleanLabel(label), answer });
      }
    }
  }

  /**
   * TEST MODE simulation (section 31): open the application page, fill everything known, upload the documents,
   * screenshot, and report exactly what would be sent. Never clicks submit — real submission is not implemented.
   */
  async simulate(id: number, opts: SimulateOptions = {}) {
    const { a, job } = this.app(id);
    const url = opts.url ?? job.applicationUrl ?? job.sourceUrl;
    const settings = new SettingsService(this.db).get();
    const profile = new ProfileService(this.db).get();
    const { resume, letter } = this.documents(job.id);
    const bank = new AnswerBankService(this.db).effectiveEntries();
    const dir = path.join(paths.generated(), 'applications', String(job.id));
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const screenshotPath = path.join(dir, `simulation-${stamp}.png`);

    logger.info(`Simulation started for "${job.title}" at ${job.company} (test mode, nothing will be sent)`);
    const result: SimulationResult = await simulateApplication({
      url,
      screenshotPath,
      plan: (fields) =>
        planForm(fields, {
          profile,
          bank,
          resumePath: abs(resume?.pdfPath),
          coverLetterPath: abs(letter?.pdfPath),
          coverLetterText: letter?.content,
          userAnswers: opts.answers,
        }),
      options: {
        headless: settings.browser.headless,
        persistentProfileDir: settings.browser.persistentProfile ? paths.browserProfile() : undefined,
        slowMoMs: settings.browser.slowMoMs,
        timeoutMs: settings.browser.timeoutSeconds * 1000,
      },
    });
    this.saveAnswers(result.plan, opts);

    const check = this.check(id, { plan: result.plan, pageText: result.pageText });
    const report = {
      simulatedAt: new Date().toISOString(),
      testMode: true,
      submitted: false,
      url,
      status: result.status,
      blocker: result.blocker,
      error: result.error,
      submitButtonFound: result.submitButton,
      wouldFill: result.filled,
      questionsForYou: result.plan?.needsInput.map((i) => ({ label: i.field.label, type: i.field.type, options: i.field.options, reason: i.reason })) ?? [],
      toConfirm: result.plan?.needsConfirmation.map((i) => ({ label: i.field.label, proposed: i.value, reason: i.reason })) ?? [],
      leftEmpty: result.plan?.skipped.map((i) => ({ label: i.field.label, reason: i.reason })) ?? [],
      finalCheck: check.items,
    };
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(dir, `simulation-${stamp}.json`), JSON.stringify(report, null, 2), { mode: 0o600 });

    this.db
      .insert(applicationEvents)
      .values({ applicationId: a.id, type: 'simulation', message: `Test-mode simulation: ${result.status}${result.blocker ? ` (${result.blocker.kind})` : ''} — nothing was sent`, data: { status: result.status, filled: result.filled.length, questions: report.questionsForYou.length, screenshot: result.screenshotPath ? path.relative(process.cwd(), result.screenshotPath) : null } })
      .run();

    if (result.status === 'blocked' || result.status === 'needs_input') {
      new NotificationService(this.db).notify({
        type: 'application_attention',
        level: 'action_required',
        title: `Application for ${job.title} at ${job.company} requires your attention`,
        message: result.status === 'blocked' ? `${result.blocker!.detail} The app stopped and will not try to get around it.` : `${report.questionsForYou.length} question(s) need your answer, ${report.toConfirm.length} to confirm.`,
        link: `/jobs/${job.id}`,
        dedupeKey: `simulation:${a.id}:${stamp}`,
      });
    }
    logger.info(`Simulation for "${job.title}": ${result.status} (${result.filled.length} field(s) filled, nothing sent)`);
    const { pageText: _t, ...rest } = result;
    return { result: { ...rest, screenshotUrl: result.screenshotPath ? `/api/applications/${id}/simulation-screenshot/${path.basename(result.screenshotPath)}` : null }, report, check };
  }

  screenshot(id: number, file: string): string {
    const { job } = this.app(id);
    if (!/^simulation-[\w-]+\.png$/.test(file)) throw new NotFoundError('Screenshot');
    const p = path.join(paths.generated(), 'applications', String(job.id), file);
    if (!fs.existsSync(p)) throw new NotFoundError('Screenshot');
    return p;
  }

  /** Demo: run the simulation against the local demo form with your real profile (no job needed). */
  async simulateDemo(demoUrl: string, answers?: Record<string, string>) {
    const settings = new SettingsService(this.db).get();
    const profile = new ProfileService(this.db).get();
    const master = new MasterCvService(this.db).latest();
    const dir = path.join(paths.generated(), 'demo');
    fs.mkdirSync(dir, { recursive: true });
    let resumePath: string | undefined;
    if (master) {
      resumePath = path.join(dir, 'master-cv.pdf');
      fs.writeFileSync(resumePath, await resumeToPdf(master.content));
    }
    const screenshotPath = path.join(dir, 'simulation.png');
    const result = await simulateApplication({
      url: demoUrl,
      screenshotPath,
      plan: (fields) => planForm(fields, { profile, bank: new AnswerBankService(this.db).effectiveEntries(), resumePath, userAnswers: answers }),
      options: { headless: true, slowMoMs: 0, timeoutMs: settings.browser.timeoutSeconds * 1000 },
    });
    const { pageText: _t, ...rest } = result;
    return { ...rest, screenshotUrl: result.screenshotPath ? '/api/demo/simulation.png' : null };
  }
}
