import { and, asc, desc, eq, inArray, isNull, like, or, sql, type SQL } from 'drizzle-orm';
import type { Db } from '../database/client.js';
import { jobAnalysis, jobSources, jobs } from '../database/schema.js';
import { canonicalizeUrl, findDuplicate, normalizeCompany } from '../job-search/dedup.js';
import type { JobListQuery, JobStatus, LocationMatch, NormalizedJob } from '../models/job.js';
import { AppError, NotFoundError } from '../utils/errors.js';

const NOW = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;

export type UpsertOutcome = { kind: 'new'; id: number } | { kind: 'updated'; id: number } | { kind: 'duplicate'; id: number; of: number };

/** Built-in sources. automationAllowed=false → never fetched automatically (ToS), manual import only. */
export const DEFAULT_SOURCES = [
  { key: 'greenhouse', name: 'Greenhouse (public job board API)', kind: 'api', enabled: true, automationAllowed: true, notes: 'Public Job Board API, intended for publishing listings.' },
  { key: 'lever', name: 'Lever (public postings API)', kind: 'api', enabled: true, automationAllowed: true, notes: 'Public Postings API, intended for publishing listings.' },
  { key: 'manual', name: 'Manual import', kind: 'manual', enabled: true, automationAllowed: true, notes: 'Offers you paste yourself.' },
  { key: 'company-site', name: 'Company career sites', kind: 'manual', enabled: true, automationAllowed: false, notes: 'Imported manually by URL + text.' },
  { key: 'linkedin', name: 'LinkedIn', kind: 'manual', enabled: true, automationAllowed: false, notes: 'Terms prohibit automated access: use the generated search links, then import offers manually.' },
  { key: 'indeed', name: 'Indeed', kind: 'manual', enabled: true, automationAllowed: false, notes: 'Terms prohibit scraping: search links + manual import.' },
  { key: 'glassdoor', name: 'Glassdoor', kind: 'manual', enabled: true, automationAllowed: false, notes: 'Terms prohibit scraping: search links + manual import.' },
  { key: 'welcometothejungle', name: 'Welcome to the Jungle', kind: 'manual', enabled: true, automationAllowed: false, notes: 'No public API: search links + manual import.' },
  { key: 'workday', name: 'Workday career sites', kind: 'manual', enabled: true, automationAllowed: false, notes: 'No public job API: manual import.' },
] as const;

export function ensureDefaultSources(db: Db): void {
  for (const s of DEFAULT_SOURCES) {
    db.insert(jobSources).values({ ...s }).onConflictDoNothing({ target: jobSources.key }).run();
  }
}

/** Jobs that are not grouped under another job (one row per real offer). */
const isCanonical = or(isNull(jobs.duplicateGroupId), eq(jobs.duplicateGroupId, jobs.id))!;

export class JobService {
  constructor(private readonly db: Db) {
    ensureDefaultSources(db);
  }

  private sourceId(key: string): number | null {
    return this.db.select({ id: jobSources.id }).from(jobSources).where(eq(jobSources.key, key)).get()?.id ?? null;
  }

  /**
   * Insert or update a job.
   * - same canonical URL (source or application URL) → update in place
   * - same company + similar title/location/description → stored, but grouped under the earlier job
   */
  upsert(job: NormalizedJob, locationMatch: LocationMatch): UpsertOutcome {
    const sourceUrl = canonicalizeUrl(job.sourceUrl);
    const applicationUrl = job.applicationUrl ? canonicalizeUrl(job.applicationUrl) : null;
    const values = {
      jobUid: `${job.sourceKey}:${job.externalId}`,
      sourceId: this.sourceId(job.sourceKey),
      sourceUrl,
      company: job.company,
      title: job.title,
      location: job.location ?? null,
      description: job.description ?? null,
      requirements: job.requirements,
      responsibilities: job.responsibilities,
      skills: job.skills,
      salary: job.salary ?? null,
      employmentType: job.employmentType ?? null,
      internshipDuration: job.internshipDuration ?? null,
      startDate: job.startDate ?? null,
      endDate: job.endDate ?? null,
      postedDate: job.postedDate ?? null,
      applicationUrl,
      department: job.department ?? null,
      workplaceType: job.workplaceType ?? null,
      locationMatch,
      periodHints: job.periodHints,
      raw: { ...(job.raw as object | undefined), allLocations: job.allLocations },
      lastSeenAt: NOW,
      closedAt: null,
      updatedAt: NOW,
    };

    return this.db.transaction((tx) => {
      const urls = [sourceUrl, ...(applicationUrl ? [applicationUrl] : [])];
      const existing = tx
        .select({ id: jobs.id })
        .from(jobs)
        .where(or(eq(jobs.jobUid, values.jobUid), inArray(jobs.sourceUrl, urls), inArray(jobs.applicationUrl, urls)))
        .get();
      if (existing) {
        // Never overwrite the user's workflow status on refresh.
        tx.update(jobs).set(values).where(eq(jobs.id, existing.id)).run();
        return { kind: 'updated', id: existing.id } as const;
      }

      const company = normalizeCompany(job.company);
      const candidates = tx
        .select({ id: jobs.id, company: jobs.company, title: jobs.title, location: jobs.location, locationMatch: jobs.locationMatch, description: jobs.description, group: jobs.duplicateGroupId })
        .from(jobs)
        .where(isCanonical)
        .all()
        .filter((c) => normalizeCompany(c.company) === company);
      const dup = findDuplicate({ ...job, locationMatch }, candidates);

      const inserted = tx.insert(jobs).values({ ...values, duplicateGroupId: dup ? dup.id : null }).returning({ id: jobs.id }).get();
      if (dup) {
        tx.update(jobs).set({ duplicateGroupId: dup.id }).where(eq(jobs.id, dup.id)).run();
        return { kind: 'duplicate', id: inserted.id, of: dup.id } as const;
      }
      return { kind: 'new', id: inserted.id } as const;
    });
  }

  /** Mark jobs of a board that are no longer listed as closed (only after a fully successful fetch). */
  markClosed(jobUidPrefix: string, seenUids: string[]): number {
    const open = this.db
      .select({ id: jobs.id, uid: jobs.jobUid })
      .from(jobs)
      .where(and(like(jobs.jobUid, `${jobUidPrefix}%`), isNull(jobs.closedAt)))
      .all();
    const seen = new Set(seenUids);
    const gone = open.filter((j) => j.uid.startsWith(jobUidPrefix) && !seen.has(j.uid)).map((j) => j.id);
    if (gone.length) this.db.update(jobs).set({ closedAt: NOW }).where(inArray(jobs.id, gone)).run();
    return gone.length;
  }

  list(q: JobListQuery) {
    const latestScore = sql<number | null>`(select ja.overall_score from ${jobAnalysis} ja where ja.job_id = ${jobs.id} order by ja.id desc limit 1)`;
    const latestCategory = sql<string | null>`(select ja.category from ${jobAnalysis} ja where ja.job_id = ${jobs.id} order by ja.id desc limit 1)`;
    const dupCount = sql<number>`(select count(*) from ${jobs} d where d.duplicate_group_id = ${jobs.id} and d.id != ${jobs.id})`;
    const where: SQL[] = [];
    if (!q.includeDuplicates) where.push(isCanonical);
    if (!q.includeClosed) where.push(isNull(jobs.closedAt));
    if (q.status) where.push(eq(jobs.status, q.status));
    if (q.source) where.push(eq(jobSources.key, q.source));
    if (q.locationMatch) where.push(eq(jobs.locationMatch, q.locationMatch));
    if (q.location) where.push(like(jobs.location, `%${q.location}%`));
    if (q.duration) where.push(like(jobs.internshipDuration, `%${q.duration}%`));
    if (q.startDate) where.push(or(like(jobs.startDate, `%${q.startDate}%`), like(jobs.periodHints, `%${q.startDate}%`))!);
    if (q.minScore !== undefined && q.minScore > 0) where.push(sql`${latestScore} >= ${q.minScore}`);
    if (q.q) {
      const t = `%${q.q}%`;
      where.push(or(like(jobs.title, t), like(jobs.company, t), like(jobs.department, t), like(jobs.description, t))!);
    }
    const order =
      q.sort === 'company' ? [asc(jobs.company), asc(jobs.title)] :
      q.sort === 'posted' ? [desc(jobs.postedDate), desc(jobs.id)] :
      q.sort === 'score' ? [sql`${latestScore} desc nulls last`, desc(jobs.id)] :
      [desc(jobs.id)];

    const base = this.db
      .select({
        id: jobs.id,
        company: jobs.company,
        title: jobs.title,
        location: jobs.location,
        locationMatch: jobs.locationMatch,
        salary: jobs.salary,
        postedDate: jobs.postedDate,
        startDate: jobs.startDate,
        endDate: jobs.endDate,
        internshipDuration: jobs.internshipDuration,
        periodHints: jobs.periodHints,
        department: jobs.department,
        sourceUrl: jobs.sourceUrl,
        applicationUrl: jobs.applicationUrl,
        source: jobSources.key,
        status: jobs.status,
        closedAt: jobs.closedAt,
        createdAt: jobs.createdAt,
        score: latestScore,
        category: latestCategory,
        duplicates: dupCount,
      })
      .from(jobs)
      .leftJoin(jobSources, eq(jobs.sourceId, jobSources.id))
      .where(where.length ? and(...where) : undefined);

    const total = this.db
      .select({ n: sql<number>`count(*)` })
      .from(jobs)
      .leftJoin(jobSources, eq(jobs.sourceId, jobSources.id))
      .where(where.length ? and(...where) : undefined)
      .get()?.n ?? 0;
    const items = base.orderBy(...order).limit(q.limit).offset(q.offset).all();
    return { total, items };
  }

  get(id: number) {
    const row = this.db
      .select({ job: jobs, source: jobSources.key, sourceName: jobSources.name })
      .from(jobs)
      .leftJoin(jobSources, eq(jobs.sourceId, jobSources.id))
      .where(eq(jobs.id, id))
      .get();
    if (!row) throw new NotFoundError(`Job ${id}`);
    const groupId = row.job.duplicateGroupId ?? row.job.id;
    const related = this.db
      .select({ id: jobs.id, title: jobs.title, company: jobs.company, sourceUrl: jobs.sourceUrl, source: jobSources.key })
      .from(jobs)
      .leftJoin(jobSources, eq(jobs.sourceId, jobSources.id))
      .where(and(or(eq(jobs.duplicateGroupId, groupId), eq(jobs.id, groupId)), sql`${jobs.id} != ${id}`))
      .all();
    const analysis = this.db.select().from(jobAnalysis).where(eq(jobAnalysis.jobId, id)).orderBy(desc(jobAnalysis.id)).limit(1).get() ?? null;
    return { ...row.job, source: row.source, sourceName: row.sourceName, duplicatesOf: row.job.duplicateGroupId !== row.job.id ? row.job.duplicateGroupId : null, related, analysis };
  }

  setStatus(id: number, status: JobStatus): void {
    const res = this.db.update(jobs).set({ status, updatedAt: NOW }).where(eq(jobs.id, id)).run();
    if (res.changes === 0) throw new NotFoundError(`Job ${id}`);
  }

  /** Detach a job wrongly grouped as a duplicate. */
  ungroup(id: number): void {
    const job = this.get(id);
    const head = job.duplicateGroupId;
    if (head === null || head === id) throw new AppError('This job is not grouped under another offer', 400);
    this.db.update(jobs).set({ duplicateGroupId: null }).where(eq(jobs.id, id)).run();
    const remaining = this.db.select({ id: jobs.id }).from(jobs).where(and(eq(jobs.duplicateGroupId, head), sql`${jobs.id} != ${head}`)).all();
    if (remaining.length === 0) this.db.update(jobs).set({ duplicateGroupId: null }).where(eq(jobs.id, head)).run();
  }

  sources() {
    return this.db.select().from(jobSources).orderBy(asc(jobSources.id)).all();
  }
}
