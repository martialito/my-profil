import { and, desc, eq, inArray, isNull, notExists, or, sql } from 'drizzle-orm';
import type { Db } from '../database/client.js';
import { jobAnalysis, jobs } from '../database/schema.js';
import { isDateCompatible, type Availability } from '../job-analysis/dates.js';
import { estimateCostUsd } from '../job-analysis/pricing.js';
import { LlmJobAnalysisSchema } from '../job-analysis/schema.js';
import { computeScore, type ScoreResult } from '../job-analysis/scoring.js';
import { checkInternship, matchJobLocation } from '../job-search/filters.js';
import { getLlmProvider, llmConfigFromSettings, loadPrompt, renderPrompt } from '../llm/index.js';
import type { LocationMatch } from '../models/job.js';
import type { MasterCvContent } from '../models/master-cv.js';
import type { Settings } from '../models/settings.js';
import { sha256 } from '../utils/crypto.js';
import { AppError, NotFoundError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { MasterCvService } from './master-cv.service.js';
import { NotificationService } from '../notifications/notification.service.js';
import { ProfileService } from './profile.service.js';
import { SettingsService } from './settings.service.js';

const SYSTEM =
  'You are a careful career advisor evaluating internship offers for one candidate. You only rely on facts written in the candidate\'s Master CV and in the offer. You never invent skills, experience or dates, and you quote your evidence exactly.';

type JobRow = typeof jobs.$inferSelect;

export interface AnalysisSummary {
  analyzed: number;
  green: number;
  yellow: number;
  red: number;
  errors: Array<{ jobId: number; company: string; title: string; reason: string }>;
  costUsd: number;
}

/** Deterministic checks that need no LLM: dates, location, internship rule. */
export function precheck(job: JobRow, settings: Settings, extraLocations: string[]) {
  const availability = availabilityOf(settings);
  const raw = (job.raw ?? {}) as { allLocations?: string[] };
  const locationMatch = (job.locationMatch as LocationMatch | null) ?? matchJobLocation({ location: job.location ?? undefined, allLocations: raw.allLocations ?? [], workplaceType: job.workplaceType ?? undefined }, extraLocations);
  return {
    date: isDateCompatible(job, availability),
    locationMatch,
    internship: checkInternship({ title: job.title, employmentType: job.employmentType ?? undefined }),
  };
}

function availabilityOf(settings: Settings): Availability {
  return {
    start: settings.search.availabilityStart,
    end: settings.search.availabilityEnd,
    minimumDurationMonths: settings.search.minimumDurationMonths || undefined,
    idealDurationMonths: settings.search.idealDurationMonths || undefined,
  };
}

/** Master CV facts sent to the LLM. Contact details and work authorization are NOT sent. */
export function cvForLlm(master: MasterCvContent): string {
  const { personal: _p, workAuthorization: _w, ...facts } = master;
  return JSON.stringify(facts, (k, v) => (k === 'id' ? undefined : v), 2);
}

function jobForLlm(job: JobRow): string {
  return [
    `Company: ${job.company}`,
    `Title: ${job.title}`,
    `Location: ${job.location ?? 'not stated'}`,
    job.employmentType ? `Employment type: ${job.employmentType}` : '',
    job.salary ? `Salary: ${job.salary}` : '',
    job.department ? `Department: ${job.department}` : '',
    '',
    job.description ?? '(no description)',
  ]
    .filter((l) => l !== '')
    .join('\n');
}

export class JobAnalysisService {
  constructor(private readonly db: Db) {}

  precheck(jobId: number) {
    const job = this.job(jobId);
    const settings = new SettingsService(this.db).get();
    const profile = new ProfileService(this.db).get();
    return precheck(job, settings, [...settings.search.locations, ...profile.preferences.preferredLocations]);
  }

  private job(jobId: number): JobRow {
    const job = this.db.select().from(jobs).where(eq(jobs.id, jobId)).get();
    if (!job) throw new NotFoundError(`Job ${jobId}`);
    return job;
  }

  async analyze(jobId: number): Promise<ScoreResult & { analysisId: number }> {
    const job = this.job(jobId);
    const master = new MasterCvService(this.db).latest();
    if (!master) throw new AppError('Create your Master CV first: offers are scored against it.', 422, 'NO_MASTER_CV');
    const provider = getLlmProvider();
    if (!provider.isConfigured()) throw new AppError('ANTHROPIC_API_KEY is not configured in .env', 400, 'LLM_NOT_CONFIGURED');

    const settings = new SettingsService(this.db).get();
    const profile = new ProfileService(this.db).get();
    const extra = [...settings.search.locations, ...profile.preferences.preferredLocations];
    const pre = precheck(job, settings, extra);

    const template = loadPrompt('job-analysis');
    const context = [
      'MASTER CV (the only source of truth about the candidate):',
      '<<<MASTER_CV',
      cvForLlm(master.content),
      'MASTER_CV>>>',
      '',
      `Availability: ${settings.search.availabilityStart} to ${settings.search.availabilityEnd} (ideal duration ${settings.search.idealDurationMonths} months).`,
      `Preferences: ${JSON.stringify({ ...profile.preferences, searchIndustries: settings.search.industries, searchJobTitles: settings.search.jobTitles })}`,
    ].join('\n');

    const { data, usage } = await provider.completeStructured(
      { system: SYSTEM, cachedContext: context, prompt: renderPrompt(template, { job: jobForLlm(job) }) },
      LlmJobAnalysisSchema,
      llmConfigFromSettings(settings.llm),
    );

    const score = computeScore({
      llm: data,
      job,
      date: pre.date,
      availability: availabilityOf(settings),
      locationMatch: pre.locationMatch,
      isInternship: pre.internship.isInternship,
      master: master.content,
      requiresSponsorship: profile.workAuthorization.requiresSponsorship,
      classification: settings.classification,
    });

    const row = this.db.transaction((tx) => {
      const inserted = tx
        .insert(jobAnalysis)
        .values({
          jobId,
          overallScore: score.overall,
          dateStatus: score.date.status,
          dateCompatibility: score.date.score,
          locationCompatibility: score.dimensions.location,
          skillsMatch: score.dimensions.skills,
          experienceMatch: score.dimensions.experience,
          educationMatch: score.dimensions.education,
          preferencesMatch: score.dimensions.preferences,
          category: score.category,
          reasons: score.reasons,
          missingRequirements: score.missingRequirements,
          redFlags: score.redFlags,
          matchedSkills: score.matchedSkills,
          missingSkills: score.missingSkills,
          locationMatch: pre.locationMatch,
          dateDetails: score.date,
          scoreDetails: { caps: score.caps, notes: score.notes, rawFormulaScore: score.rawFormulaScore, masterCvVersion: master.version, sponsorship: data.sponsorship, seniority: data.seniority, employmentType: data.employment_type },
          model: usage.model,
          promptVersion: sha256(template).slice(0, 12),
          inputTokens: usage.inputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0),
          outputTokens: usage.outputTokens,
          costUsd: estimateCostUsd(usage.model, usage),
        })
        .returning({ id: jobAnalysis.id, costUsd: jobAnalysis.costUsd })
        .get();
      tx.update(jobs)
        .set({
          skills: [...new Set([...data.skills_required, ...data.skills_preferred].map((s) => s.trim()).filter(Boolean))],
          // Do not override a decision the user already took.
          status: sql`case when ${jobs.status} = 'FOUND' then 'ANALYZED' else ${jobs.status} end`,
          updatedAt: sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`,
        })
        .where(eq(jobs.id, jobId))
        .run();
      return inserted;
    });
    logger.info(`Analyzed "${job.title}" at ${job.company}: ${score.overall}/100 (${score.category})`);
    if (score.category === 'GREEN') {
      new NotificationService(this.db).notify({
        type: 'high_match',
        level: 'info',
        title: `High match: ${job.title} at ${job.company} (${score.overall}/100)`,
        message: score.reasons[0] ?? 'This offer matches your profile and your dates.',
        link: `/jobs/${job.id}`,
        dedupeKey: `high_match:${job.id}`,
      });
    }
    return { ...score, analysisId: row.id };
  }

  /** Analyse offers not analysed yet (canonical, open, not skipped), one by one. */
  async analyzePending(opts: { limit?: number; jobIds?: number[] } = {}): Promise<AnalysisSummary> {
    const pending = this.db
      .select({ id: jobs.id, company: jobs.company, title: jobs.title })
      .from(jobs)
      .where(
        and(
          or(isNull(jobs.duplicateGroupId), eq(jobs.duplicateGroupId, jobs.id)),
          isNull(jobs.closedAt),
          sql`${jobs.status} != 'SKIPPED'`,
          opts.jobIds ? inArray(jobs.id, opts.jobIds) : notExists(this.db.select({ x: jobAnalysis.id }).from(jobAnalysis).where(eq(jobAnalysis.jobId, jobs.id))),
        ),
      )
      .orderBy(desc(jobs.id))
      .limit(opts.limit ?? 50)
      .all();

    const summary: AnalysisSummary = { analyzed: 0, green: 0, yellow: 0, red: 0, errors: [], costUsd: 0 };
    logger.info(`Analysis started (${pending.length} offers)`);
    for (const j of pending) {
      try {
        const r = await this.analyze(j.id);
        summary.analyzed++;
        summary[r.category.toLowerCase() as 'green' | 'yellow' | 'red']++;
        const cost = this.db.select({ c: jobAnalysis.costUsd }).from(jobAnalysis).where(eq(jobAnalysis.id, r.analysisId)).get()?.c;
        summary.costUsd += cost ?? 0;
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        summary.errors.push({ jobId: j.id, company: j.company, title: j.title, reason });
        logger.stepError({ company: j.company, job: j.title, step: 'Analyze offer', reason });
        // Configuration problems will fail for every offer: stop early.
        if (err instanceof AppError && ['LLM_NOT_CONFIGURED', 'NO_MASTER_CV'].includes(err.code)) break;
      }
    }
    summary.costUsd = Math.round(summary.costUsd * 10000) / 10000;
    logger.info(`${summary.analyzed} jobs analyzed`);
    logger.info(`${summary.green + summary.yellow} jobs scored >= ${new SettingsService(this.db).get().classification.yellowMin}`);
    return summary;
  }
}
