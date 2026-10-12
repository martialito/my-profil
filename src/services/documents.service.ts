import fs from 'node:fs';
import path from 'node:path';
import { and, desc, eq, sql } from 'drizzle-orm';
import { paths } from '../config/env.js';
import { checkLetter, letterText, LlmCoverLetterSchema, type LetterCheck } from '../cover-letter/letter.js';
import { letterToDocx, letterToPdf, type LetterDoc } from '../cover-letter/render.js';
import { resumeToDocx, resumeToPdf, resumeToText } from '../cv/render.js';
import { LlmTailoredCvSchema, tailor, type TailorResult } from '../cv/tailor.js';
import type { Db } from '../database/client.js';
import { applicationEvents, applications, coverLetters, jobAnalysis, jobs, resumes } from '../database/schema.js';
import { getLlmProvider, llmConfigFromSettings, loadPrompt, renderPrompt } from '../llm/index.js';
import type { MasterCvContent, MasterCvVersion } from '../models/master-cv.js';
import type { ApplicationStatus } from '../models/statuses.js';
import { preparationTarget } from '../application/state-machine.js';
import { NotificationService } from '../notifications/notification.service.js';
import { AppError, NotFoundError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { cvForLlm } from './job-analysis.service.js';
import { MasterCvService } from './master-cv.service.js';
import { ProfileService } from './profile.service.js';
import { SettingsService } from './settings.service.js';
import { ensureDefaultUser } from './user.service.js';

type JobRow = typeof jobs.$inferSelect;
const NOW = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;

const RESUME_SYSTEM =
  'You tailor CVs for internship applications. You select and rephrase facts from the candidate\'s Master CV; you never add, inflate or alter facts.';
const LETTER_SYSTEM =
  'You write specific, natural cover letters for internship applications using only verified facts about the candidate. You never invent experience, results or motivations.';

export interface GenerateOptions {
  /** Free-text instructions from the user (e.g. "emphasise hospitality"). Never treated as facts. */
  guidance?: string;
  /** Generate even if the offer is RED / not analysed (explicit user action). */
  force?: boolean;
}

function jobText(job: JobRow): string {
  return [
    `Company: ${job.company}`,
    `Title: ${job.title}`,
    `Location: ${job.location ?? 'not stated'}`,
    job.skills.length ? `Skills asked: ${job.skills.join(', ')}` : '',
    job.responsibilities.length ? `Responsibilities:\n- ${job.responsibilities.join('\n- ')}` : '',
    job.requirements.length ? `Requirements:\n- ${job.requirements.join('\n- ')}` : '',
    '',
    job.description ?? '',
  ]
    .filter((l) => l !== '')
    .join('\n');
}

function masterContext(master: MasterCvContent): string {
  const indexed = {
    headline: master.headline,
    summary: master.summary,
    experiences: master.experiences.map((e, i) => ({ ref: `experiences[${i}]`, ...e, id: undefined })),
    education: master.education.map((e, i) => ({ ref: `education[${i}]`, ...e, id: undefined })),
    skills: master.skills.map((s) => ({ category: s.category, name: s.name, level: s.level })),
  };
  return `MASTER CV (the only source of truth about the candidate):\n<<<MASTER_CV\n${JSON.stringify(indexed, null, 2)}\nMASTER_CV>>>`;
}

const rel = (p: string) => path.relative(process.cwd(), p);

function writeVersioned(baseDir: string, version: number, files: Record<string, Buffer | string>): Record<string, string> {
  const vDir = path.join(baseDir, `v${version}`);
  fs.mkdirSync(vDir, { recursive: true, mode: 0o700 });
  const out: Record<string, string> = {};
  for (const [name, data] of Object.entries(files)) {
    fs.writeFileSync(path.join(vDir, name), data, { mode: 0o600 });
    fs.writeFileSync(path.join(baseDir, name), data, { mode: 0o600 }); // latest version at the documented location
    out[name] = rel(path.join(vDir, name));
  }
  return out;
}

function longDate(d = new Date()): string {
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

export class DocumentsService {
  constructor(private readonly db: Db) {}

  private job(jobId: number): JobRow {
    const job = this.db.select().from(jobs).where(eq(jobs.id, jobId)).get();
    if (!job) throw new NotFoundError(`Job ${jobId}`);
    return job;
  }

  private prerequisites(job: JobRow, opts: GenerateOptions): { master: MasterCvVersion } {
    const master = new MasterCvService(this.db).latest();
    if (!master) throw new AppError('Create your Master CV first.', 422, 'NO_MASTER_CV');
    if (!getLlmProvider().isConfigured()) throw new AppError('ANTHROPIC_API_KEY is not configured in .env', 400, 'LLM_NOT_CONFIGURED');
    const analysis = this.db.select({ category: jobAnalysis.category }).from(jobAnalysis).where(eq(jobAnalysis.jobId, job.id)).orderBy(desc(jobAnalysis.id)).limit(1).get();
    if (!opts.force && (!analysis || analysis.category === 'RED')) {
      throw new AppError(
        analysis ? 'This offer is RED: documents are not prepared automatically. Use "Generate anyway" if you really want them.' : 'Analyse this offer first.',
        422,
        'NOT_ELIGIBLE',
      );
    }
    return { master };
  }

  // ── Applications bookkeeping ───────────────────────────

  private advanceApplication(jobId: number, to: ApplicationStatus, patch: { resumeId?: number; coverLetterId?: number }, message: string): void {
    this.db.transaction((tx) => {
      let app = tx.select().from(applications).where(eq(applications.jobId, jobId)).get();
      if (!app) app = tx.insert(applications).values({ jobId, status: 'SHORTLISTED' }).returning().get();
      // Forward-only, preparation stages only: an APPLIED/INTERVIEW… application keeps its status.
      const status = preparationTarget(app.status as ApplicationStatus, to);
      tx.update(applications).set({ ...patch, status, updatedAt: NOW }).where(eq(applications.id, app.id)).run();
      tx.insert(applicationEvents).values({ applicationId: app.id, type: 'document', fromStatus: app.status, toStatus: status, message }).run();
    });
  }

  // ── Resume ─────────────────────────────────────────────

  async generateResume(jobId: number, opts: GenerateOptions = {}) {
    const job = this.job(jobId);
    const { master } = this.prerequisites(job, opts);
    const settings = new SettingsService(this.db).get();
    const template = loadPrompt('resume-customization');
    const { data, usage } = await getLlmProvider().completeStructured(
      {
        system: RESUME_SYSTEM,
        cachedContext: masterContext(master.content),
        prompt: renderPrompt(template, { job: jobText(job), guidance: opts.guidance ? `\nThe candidate asks: ${opts.guidance}\n(This is a preference about emphasis, not new facts.)\n` : '' }),
      },
      LlmTailoredCvSchema,
      llmConfigFromSettings(settings.llm),
    );

    const result: TailorResult = tailor(master.content, data, job.skills);
    if (result.violations.length) {
      logger.stepError({ company: job.company, job: job.title, step: 'Generate CV', reason: result.violations.map((v) => v.message).join('; ') });
      throw new AppError(`The tailored CV failed the truth check: ${result.violations.map((v) => v.message).join('; ')}`, 422, 'TRUTH_CHECK_FAILED');
    }

    const { userId } = ensureDefaultUser(this.db);
    const version = (this.db.select({ v: sql<number>`max(${resumes.version})` }).from(resumes).where(and(eq(resumes.kind, 'tailored'), eq(resumes.jobId, jobId))).get()?.v ?? 0) + 1;
    const [pdf, docx] = await Promise.all([resumeToPdf(result.content), resumeToDocx(result.content)]);
    const checks = { repaired: result.repaired, violations: result.violations, warnings: result.warnings, changes: result.changes };
    const metadata = {
      jobId,
      company: job.company,
      title: job.title,
      version,
      masterCvVersion: master.version,
      generatedAt: new Date().toISOString(),
      model: usage.model,
      truthCheck: result.violations.length === 0 ? 'passed' : 'failed',
      ...checks,
    };
    const files = writeVersioned(path.join(paths.generated(), 'cv', String(jobId)), version, {
      'resume.pdf': pdf,
      'resume.docx': docx,
      'metadata.json': JSON.stringify(metadata, null, 2),
    });
    const row = this.db
      .insert(resumes)
      .values({ userId, kind: 'tailored', version, jobId, masterResumeId: master.id, content: result.content, pdfPath: files['resume.pdf'], docxPath: files['resume.docx'], checks })
      .returning({ id: resumes.id })
      .get();
    this.advanceApplication(jobId, 'CV_CREATED', { resumeId: row.id }, `Tailored CV v${version} generated`);
    logger.info(`CV generated for "${job.title}" at ${job.company} (v${version})`);
    return { id: row.id, version, content: result.content, checks, files };
  }

  // ── Cover letter ───────────────────────────────────────

  async generateCoverLetter(jobId: number, opts: GenerateOptions = {}) {
    const job = this.job(jobId);
    const { master } = this.prerequisites(job, opts);
    const settings = new SettingsService(this.db).get();
    const profile = new ProfileService(this.db).get();
    const template = loadPrompt('cover-letter');
    const motivations = profile.motivations ?? '';
    const availability = `${settings.search.availabilityStart} to ${settings.search.availabilityEnd}`;
    // Availability dates are facts the letter may state.
    const sources = { masterCv: `${resumeToText(master.content)}\n${cvForLlm(master.content)}`, motivations: `${motivations}\nAvailability: ${availability}`, job: jobText(job) };

    const ask = async (feedback?: string) => {
      const guidance = [opts.guidance ? `The candidate asks: ${opts.guidance} (a preference about emphasis, not new facts).` : '', feedback ?? ''].filter(Boolean).join('\n');
      return getLlmProvider().completeStructured(
        {
          system: LETTER_SYSTEM,
          cachedContext: masterContext(master.content),
          prompt: renderPrompt(template, {
            language: settings.documents.letterLanguage,
            availability,
            motivations: motivations || '(none provided)',
            motivation_rule: motivations
              ? ''
              : '\nThe candidate has not written motivations: do not claim personal feelings, dreams or reasons; keep the motivation part strictly factual (fit between experience and role).\n',
            guidance: guidance ? `\n${guidance}\n` : '',
            job: jobText(job),
          }),
        },
        LlmCoverLetterSchema,
        llmConfigFromSettings(settings.llm),
      );
    };

    const signature = [profile.personal.firstName, profile.personal.lastName].filter(Boolean).join(' ');
    let { data, usage } = await ask();
    let text = letterText(data, signature);
    let check: LetterCheck = checkLetter(text, data.claims, sources, job);
    if (check.stockPhrases.length || check.unverifiedClaims.length || check.inventedNumbers.length) {
      // One rewrite with precise feedback.
      ({ data, usage } = await ask(`Your previous draft had problems that you must fix: ${check.issues.join(' ')} Remove anything you cannot quote from the sources.`));
      text = letterText(data, signature);
      check = checkLetter(text, data.claims, sources, job);
    }
    return this.saveLetter(job, text, check, { model: usage.model, masterVersion: master.version, edited: false });
  }

  /** Save a letter edited by the user (re-rendered and re-checked for figures not in the sources). */
  async saveEditedLetter(jobId: number, text: string) {
    const job = this.job(jobId);
    const master = new MasterCvService(this.db).latest();
    if (!master) throw new AppError('Create your Master CV first.', 422, 'NO_MASTER_CV');
    if (text.trim().length < 50) throw new AppError('The letter is too short.');
    const profile = new ProfileService(this.db).get();
    const s = new SettingsService(this.db).get().search;
    const check = checkLetter(
      text,
      [],
      { masterCv: `${resumeToText(master.content)}\n${cvForLlm(master.content)}`, motivations: `${profile.motivations ?? ''}\nAvailability: ${s.availabilityStart} to ${s.availabilityEnd}`, job: jobText(job) },
      job,
    );
    return this.saveLetter(job, text.trim() + '\n', check, { model: null, masterVersion: master.version, edited: true });
  }

  private async saveLetter(job: JobRow, text: string, check: LetterCheck, meta: { model: string | null; masterVersion: number; edited: boolean }) {
    const profile = new ProfileService(this.db).get();
    const p = profile.personal;
    const doc: LetterDoc = {
      text,
      senderName: [p.firstName, p.lastName].filter(Boolean).join(' '),
      senderContact: [p.email, p.phone, p.currentLocation].filter(Boolean).join(' | '),
      date: longDate(),
      recipient: ['Hiring Team', job.company, job.location ?? ''].filter(Boolean),
    };
    const version = (this.db.select({ v: sql<number>`max(${coverLetters.version})` }).from(coverLetters).where(eq(coverLetters.jobId, job.id)).get()?.v ?? 0) + 1;
    const [pdf, docx] = await Promise.all([letterToPdf(doc), letterToDocx(doc)]);
    const resume = this.db.select({ id: resumes.id }).from(resumes).where(and(eq(resumes.kind, 'tailored'), eq(resumes.jobId, job.id))).orderBy(desc(resumes.version)).limit(1).get();
    const checks = { ...check, needsReview: check.issues.length > 0 };
    const files = writeVersioned(path.join(paths.generated(), 'cover-letters', String(job.id)), version, {
      'cover-letter.pdf': pdf,
      'cover-letter.docx': docx,
      'cover-letter.txt': text,
      'metadata.json': JSON.stringify({ jobId: job.id, company: job.company, title: job.title, version, masterCvVersion: meta.masterVersion, generatedAt: new Date().toISOString(), model: meta.model, editedByUser: meta.edited, checks }, null, 2),
    });
    const row = this.db
      .insert(coverLetters)
      .values({ jobId: job.id, resumeId: resume?.id ?? null, version, content: text, txtPath: files['cover-letter.txt'], pdfPath: files['cover-letter.pdf'], docxPath: files['cover-letter.docx'], checks, editedByUser: meta.edited })
      .returning({ id: coverLetters.id })
      .get();
    this.advanceApplication(job.id, 'COVER_LETTER_CREATED', { coverLetterId: row.id }, `Cover letter v${version} ${meta.edited ? 'edited by you' : 'generated'}`);
    if (!meta.edited) {
      new NotificationService(this.db).notify({
        type: 'documents_ready',
        level: 'action_required',
        title: `Application for ${job.title} at ${job.company} requires your attention`,
        message: checks.needsReview
          ? 'CV and cover letter are prepared, but the letter has points to review before it can be used.'
          : 'CV and cover letter are prepared. Review them before applying.',
        link: `/jobs/${job.id}`,
        dedupeKey: `documents:${job.id}:${version}`,
      });
    }
    logger.info(`Cover letter ${meta.edited ? 'saved' : 'generated'} for "${job.title}" at ${job.company} (v${version})`);
    return { id: row.id, version, text, checks, files };
  }

  // ── Batch & queries ────────────────────────────────────

  async generateForJob(jobId: number, opts: GenerateOptions = {}) {
    const resume = await this.generateResume(jobId, opts);
    const letter = await this.generateCoverLetter(jobId, opts);
    return { resume, letter };
  }

  /** Generate documents for analysed offers in the configured categories that have none yet. */
  async generatePending(opts: { limit?: number } = {}) {
    const cats = new SettingsService(this.db).get().documents.autoGenerateFor;
    const latestCat = sql<string | null>`(select ja.category from ${jobAnalysis} ja where ja.job_id = ${jobs.id} order by ja.id desc limit 1)`;
    const candidates = this.db
      .select({ id: jobs.id, company: jobs.company, title: jobs.title, category: latestCat })
      .from(jobs)
      .where(sql`${jobs.status} != 'SKIPPED' and ${jobs.closedAt} is null and not exists (select 1 from ${resumes} r where r.job_id = ${jobs.id} and r.kind = 'tailored')`)
      .all()
      .filter((j) => j.category && (cats as string[]).includes(j.category))
      .slice(0, opts.limit ?? 20);
    const summary = { cvs: 0, letters: 0, errors: [] as Array<{ jobId: number; company: string; title: string; reason: string }> };
    for (const j of candidates) {
      try {
        await this.generateResume(j.id);
        summary.cvs++;
        await this.generateCoverLetter(j.id);
        summary.letters++;
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        summary.errors.push({ jobId: j.id, company: j.company, title: j.title, reason });
        logger.stepError({ company: j.company, job: j.title, step: 'Generate documents', reason });
        if (err instanceof AppError && ['LLM_NOT_CONFIGURED', 'NO_MASTER_CV'].includes(err.code)) break;
      }
    }
    logger.info(`${summary.cvs} CVs generated`);
    logger.info(`${summary.letters} cover letters generated`);
    return summary;
  }

  latest(jobId: number) {
    this.job(jobId);
    const resume = this.db.select().from(resumes).where(and(eq(resumes.kind, 'tailored'), eq(resumes.jobId, jobId))).orderBy(desc(resumes.version)).limit(1).get() ?? null;
    const letter = this.db.select().from(coverLetters).where(eq(coverLetters.jobId, jobId)).orderBy(desc(coverLetters.version)).limit(1).get() ?? null;
    return {
      resume: resume && { id: resume.id, version: resume.version, createdAt: resume.createdAt, content: resume.content, checks: resume.checks, masterResumeId: resume.masterResumeId },
      coverLetter: letter && { id: letter.id, version: letter.version, createdAt: letter.createdAt, content: letter.content, checks: letter.checks, editedByUser: letter.editedByUser },
    };
  }

  /** Absolute path of a generated file, restricted to the generated directory. */
  file(kind: 'resume' | 'cover-letter', id: number, format: 'pdf' | 'docx' | 'txt'): { absPath: string; filename: string } {
    let p: string | null | undefined;
    let jobId: number;
    if (kind === 'resume') {
      const r = this.db.select().from(resumes).where(and(eq(resumes.id, id), eq(resumes.kind, 'tailored'))).get();
      if (!r || format === 'txt') throw new NotFoundError('Resume file');
      p = format === 'pdf' ? r.pdfPath : r.docxPath;
      jobId = r.jobId!;
    } else {
      const l = this.db.select().from(coverLetters).where(eq(coverLetters.id, id)).get();
      if (!l) throw new NotFoundError('Cover letter file');
      p = format === 'pdf' ? l.pdfPath : format === 'docx' ? l.docxPath : l.txtPath;
      jobId = l.jobId;
    }
    if (!p) throw new NotFoundError('File');
    const abs = path.resolve(process.cwd(), p);
    if (!abs.startsWith(path.resolve(paths.generated()) + path.sep) || !fs.existsSync(abs)) throw new NotFoundError('File');
    const job = this.job(jobId);
    const slug = `${job.company}-${job.title}`.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 60);
    return { absPath: abs, filename: `${kind}-${slug}.${format}` };
  }
}
