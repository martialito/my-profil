import { and, asc, desc, eq } from 'drizzle-orm';
import type { Db } from '../database/client.js';
import { companyBoards, searchRuns } from '../database/schema.js';
import { connectors, parseAtsUrl, sourceKeyForUrl, type BoardRef } from '../job-search/connectors/index.js';
import { enrich } from '../job-search/connectors/normalize.js';
import { applySearchFilters, matchJobLocation, type FilterContext } from '../job-search/filters.js';
import { defaultFetchJson, SourceError, sleep, type FetchJson } from '../job-search/http.js';
import { generateSearchQueries } from '../job-search/queries.js';
import { htmlToText } from '../job-search/text.js';
import { ManualJobSchema, type ManualJobInput, type SourceKey } from '../models/job.js';
import { AppError, NotFoundError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { JobService, type UpsertOutcome } from './job.service.js';
import { ProfileService } from './profile.service.js';
import { SettingsService } from './settings.service.js';

export interface SearchStats {
  boards: number;
  fetched: number;
  kept: number;
  newJobs: number;
  updated: number;
  duplicatesGrouped: number;
  filteredNotInternship: number;
  filteredNotNyc: number;
  closed: number;
  errors: number;
}

export interface SearchRunResult {
  runId: number;
  stats: SearchStats;
  errors: Array<{ board: string; reason: string }>;
}

export interface JobSearchOptions {
  fetchJson?: FetchJson;
  /** Pause between boards to stay a polite, low-volume client. */
  delayMs?: number;
}

export class JobSearchService {
  private readonly fetchJson: FetchJson;
  private readonly delayMs: number;
  private readonly jobsSvc: JobService;

  constructor(private readonly db: Db, opts: JobSearchOptions = {}) {
    this.fetchJson = opts.fetchJson ?? defaultFetchJson;
    this.delayMs = opts.delayMs ?? 1000;
    this.jobsSvc = new JobService(db);
  }

  private filterContext(): FilterContext {
    const settings = new SettingsService(this.db).get();
    const profile = new ProfileService(this.db).get();
    return {
      internshipOnly: settings.search.internshipOnly,
      allowRemote: profile.preferences.workModes.includes('remote'),
      extraLocations: [...settings.search.locations, ...profile.preferences.preferredLocations],
    };
  }

  // ── Boards ────────────────────────────────────────────────

  listBoards() {
    return this.db.select().from(companyBoards).orderBy(asc(companyBoards.companyName)).all();
  }

  /** Add a board after checking it really exists. Accepts a token or a board/job URL. */
  async addBoard(input: { provider?: BoardRef['provider']; token?: string; url?: string; companyName?: string }) {
    let provider = input.provider;
    let token = input.token?.trim();
    if (input.url) {
      const parsed = parseAtsUrl(input.url);
      if (!parsed) throw new AppError('Only boards.greenhouse.io / job-boards.greenhouse.io / jobs.lever.co URLs are supported', 400, 'UNSUPPORTED_URL');
      provider = parsed.provider;
      token = parsed.token;
    }
    if (!provider || !token) throw new AppError('Provide a board URL, or a provider and a token');
    if (!/^[A-Za-z0-9._-]{1,100}$/.test(token)) throw new AppError('Invalid board token');
    const exists = this.db.select().from(companyBoards).where(and(eq(companyBoards.provider, provider), eq(companyBoards.token, token))).get();
    if (exists) throw new AppError(`This ${provider} board is already configured`, 409, 'CONFLICT');

    let info: { name: string; jobCount: number };
    try {
      info = await connectors[provider].boardInfo(token, this.fetchJson);
    } catch (err) {
      throw new AppError(`Could not reach this ${provider} board: ${(err as Error).message}`, 422, 'BOARD_UNREACHABLE');
    }
    return this.db
      .insert(companyBoards)
      .values({ provider, token, companyName: input.companyName?.trim() || info.name, lastJobCount: info.jobCount })
      .returning()
      .get();
  }

  updateBoard(id: number, patch: { enabled?: boolean; companyName?: string }) {
    const row = this.db.update(companyBoards).set(patch).where(eq(companyBoards.id, id)).returning().get();
    if (!row) throw new NotFoundError(`Board ${id}`);
    return row;
  }

  removeBoard(id: number): void {
    const res = this.db.delete(companyBoards).where(eq(companyBoards.id, id)).run();
    if (res.changes === 0) throw new NotFoundError(`Board ${id}`);
  }

  // ── Search pipeline ───────────────────────────────────────

  async run(trigger: 'manual' | 'cli' | 'schedule' = 'manual', opts: { boardIds?: number[] } = {}): Promise<SearchRunResult> {
    const boards = this.listBoards().filter((b) => b.enabled && (!opts.boardIds || opts.boardIds.includes(b.id)));
    const run = this.db.insert(searchRuns).values({ trigger }).returning({ id: searchRuns.id }).get();
    const ctx = this.filterContext();
    const stats: SearchStats = { boards: boards.length, fetched: 0, kept: 0, newJobs: 0, updated: 0, duplicatesGrouped: 0, filteredNotInternship: 0, filteredNotNyc: 0, closed: 0, errors: 0 };
    const errors: SearchRunResult['errors'] = [];

    logger.info('Search started', { boards: boards.length });
    for (const [i, board] of boards.entries()) {
      if (i > 0 && this.delayMs) await sleep(this.delayMs);
      const label = `${board.provider}:${board.token}`;
      try {
        const fetched = await connectors[board.provider].listJobs(board, this.fetchJson);
        stats.fetched += fetched.length;
        for (const job of fetched) {
          const f = applySearchFilters(job, ctx);
          if (!f.keep) {
            if (f.reason === 'not_internship') stats.filteredNotInternship++;
            else stats.filteredNotNyc++;
            continue;
          }
          stats.kept++;
          this.count(stats, this.jobsSvc.upsert(job, f.locationMatch));
        }
        // Offers that vanished from a board we fetched completely are marked closed.
        stats.closed += this.jobsSvc.markClosed(`${board.provider}:${board.token}:`, fetched.map((j) => `${j.sourceKey}:${j.externalId}`));
        this.db.update(companyBoards).set({ lastFetchedAt: new Date().toISOString(), lastError: null, lastJobCount: fetched.length }).where(eq(companyBoards.id, board.id)).run();
      } catch (err) {
        const reason = err instanceof SourceError || err instanceof Error ? err.message : String(err);
        stats.errors++;
        errors.push({ board: label, reason });
        this.db.update(companyBoards).set({ lastFetchedAt: new Date().toISOString(), lastError: reason }).where(eq(companyBoards.id, board.id)).run();
        logger.stepError({ company: board.companyName, step: 'Fetch job board', reason });
      }
    }

    logger.info(`${stats.fetched} jobs found`);
    logger.info(`${stats.filteredNotInternship} non-internship and ${stats.filteredNotNyc} non-NYC offers filtered out`);
    logger.info(`${stats.newJobs} new, ${stats.updated} already known, ${stats.duplicatesGrouped} duplicates grouped`);
    this.db.update(searchRuns).set({ finishedAt: new Date().toISOString(), stats, errors }).where(eq(searchRuns.id, run.id)).run();
    return { runId: run.id, stats, errors };
  }

  private count(stats: SearchStats, o: UpsertOutcome): void {
    if (o.kind === 'new') stats.newJobs++;
    else if (o.kind === 'updated') stats.updated++;
    else stats.duplicatesGrouped++;
  }

  runs(limit = 20) {
    return this.db.select().from(searchRuns).orderBy(desc(searchRuns.id)).limit(limit).all();
  }

  // ── Manual / semi-automatic import ────────────────────────

  /**
   * Import one offer found by the user.
   * - Greenhouse / Lever URLs are fetched through their public API.
   * - Any other URL is NEVER fetched: company, title and description must be pasted by the user.
   * Filters are not applied (the user chose this offer), but the location match is recorded.
   */
  async importManual(input: ManualJobInput): Promise<UpsertOutcome & { warnings: string[] }> {
    const data = ManualJobSchema.parse(input);
    const warnings: string[] = [];
    const ats = parseAtsUrl(data.url);
    let job;
    if (ats?.jobId) {
      job = await connectors[ats.provider].getJob(ats.token, ats.jobId, this.fetchJson, data.company);
    } else {
      if (!data.company || !data.title || !data.description) {
        throw new AppError('For this website, paste the company, the job title and the full description (the page is not fetched automatically).', 422, 'MANUAL_FIELDS_REQUIRED');
      }
      const description = /<\/?[a-z][^>]*>/i.test(data.description) ? htmlToText(data.description) : data.description;
      const sourceKey = sourceKeyForUrl(data.url) as SourceKey;
      job = enrich({
        sourceKey,
        externalId: data.url,
        sourceUrl: data.url,
        applicationUrl: data.applicationUrl ?? data.url,
        company: data.company,
        title: data.title,
        location: data.location,
        allLocations: [],
        description,
        salary: data.salary,
        postedDate: data.postedDate,
        raw: { provider: 'manual' },
      });
    }
    const ctx = this.filterContext();
    const f = applySearchFilters(job, ctx);
    if (!f.keep) warnings.push(f.reason === 'not_internship' ? `This does not look like an internship (${f.detail}).` : `Location does not look like NYC (${f.detail}).`);
    const outcome = this.jobsSvc.upsert(job, matchJobLocation(job, ctx.extraLocations));
    if (outcome.kind === 'duplicate') warnings.push(`Same offer as job #${outcome.of}: grouped with it (use "Separate it" on the job page if this is wrong).`);
    if (outcome.kind === 'updated') warnings.push('This offer was already in the database: it has been refreshed.');
    return { ...outcome, warnings };
  }

  queries() {
    return generateSearchQueries(new ProfileService(this.db).get(), new SettingsService(this.db).get());
  }
}
