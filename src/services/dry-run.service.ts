import { and, desc, eq, isNotNull, sql } from 'drizzle-orm';
import type { Db } from '../database/client.js';
import { applications, jobs } from '../database/schema.js';
import { getLlmProvider } from '../llm/index.js';
import { ApplicationEngineService } from './application-engine.service.js';
import { DocumentsService } from './documents.service.js';
import { JobAnalysisService } from './job-analysis.service.js';
import { JobSearchService } from './job-search.service.js';
import { MasterCvService } from './master-cv.service.js';

export interface DryRunStep {
  step: string;
  status: 'done' | 'skipped' | 'failed';
  detail: string;
}

/**
 * npm run dry-run (section 32): search → analyse → score → CV → cover letter → simulated form.
 * NOTHING is ever submitted. Steps that cannot run (no board, no API key…) are reported as skipped, not faked.
 */
export async function dryRun(db: Db, opts: { limit?: number; log?: (line: string) => void } = {}): Promise<DryRunStep[]> {
  const limit = opts.limit ?? 3;
  const steps: DryRunStep[] = [];
  const add = (s: DryRunStep) => {
    steps.push(s);
    opts.log?.(`[${s.status.toUpperCase()}] ${s.step}: ${s.detail}`);
  };

  // 1. Search
  const search = new JobSearchService(db);
  if (search.listBoards().some((b) => b.enabled)) {
    try {
      const r = await search.run('cli');
      add({ step: '1. Search', status: r.errors.length && !r.stats.fetched ? 'failed' : 'done', detail: `${r.stats.fetched} offers fetched, ${r.stats.newJobs} new, ${r.stats.duplicatesGrouped} duplicates grouped${r.errors.length ? `, ${r.errors.length} board error(s)` : ''}.` });
    } catch (e) {
      add({ step: '1. Search', status: 'failed', detail: (e as Error).message });
    }
  } else {
    add({ step: '1. Search', status: 'skipped', detail: 'No company board configured (Sources page). Using offers already in the database.' });
  }

  // 2-3. Analyse & score
  const llm = getLlmProvider().isConfigured();
  const master = new MasterCvService(db).latest();
  if (!master) add({ step: '2-3. Analyse & score', status: 'skipped', detail: 'No Master CV yet.' });
  else if (!llm) add({ step: '2-3. Analyse & score', status: 'skipped', detail: 'ANTHROPIC_API_KEY not configured.' });
  else {
    const s = await new JobAnalysisService(db).analyzePending({ limit });
    add({ step: '2-3. Analyse & score', status: s.errors.length && !s.analyzed ? 'failed' : 'done', detail: `${s.analyzed} analysed: ${s.green} GREEN, ${s.yellow} YELLOW, ${s.red} RED (≈ $${s.costUsd.toFixed(2)})${s.errors.length ? `; ${s.errors[0]!.reason}` : ''}.` });
  }

  // 4-5. Documents
  if (!master || !llm) add({ step: '4-5. CV & cover letters', status: 'skipped', detail: !master ? 'No Master CV yet.' : 'ANTHROPIC_API_KEY not configured.' });
  else {
    const d = await new DocumentsService(db).generatePending({ limit });
    add({ step: '4-5. CV & cover letters', status: d.errors.length && !d.cvs ? 'failed' : 'done', detail: `${d.cvs} CV(s), ${d.letters} letter(s) generated${d.errors.length ? `; ${d.errors[0]!.reason}` : ''}.` });
  }

  // 6. Simulated forms for applications that have both documents
  const ready = db
    .select({ id: applications.id, title: jobs.title, company: jobs.company })
    .from(applications)
    .innerJoin(jobs, eq(applications.jobId, jobs.id))
    .where(and(isNotNull(applications.resumeId), isNotNull(applications.coverLetterId), sql`${applications.submittedAt} is null`, sql`${applications.status} not in ('REJECTED','WITHDRAWN')`))
    .orderBy(desc(applications.updatedAt))
    .limit(limit)
    .all();
  if (!ready.length) add({ step: '6. Simulated application', status: 'skipped', detail: 'No application with a CV and a cover letter yet.' });
  const engine = new ApplicationEngineService(db);
  for (const a of ready) {
    try {
      const { result, report } = await engine.simulate(a.id);
      add({
        step: `6. Simulated application — ${a.title} at ${a.company}`,
        status: result.status === 'error' ? 'failed' : 'done',
        detail:
          result.status === 'blocked'
            ? `stopped: ${result.blocker?.detail}`
            : result.status === 'error'
              ? result.error ?? 'error'
              : `${report.wouldFill.length} field(s) would be filled, ${report.questionsForYou.length} question(s) for you, submit button "${result.submitButton ?? 'not found'}" NOT clicked.`,
      });
    } catch (e) {
      add({ step: `6. Simulated application — ${a.title} at ${a.company}`, status: 'failed', detail: (e as Error).message });
    }
  }
  add({ step: '7. Submission', status: 'skipped', detail: 'Dry run: nothing was submitted.' });
  return steps;
}
