import { z } from 'zod';
import { SourceError, type FetchJson } from '../http.js';
import { htmlToText } from '../text.js';
import { enrich } from './normalize.js';
import type { BoardConnector, BoardRef } from './types.js';

/**
 * Greenhouse public Job Board API (no auth, intended for embedding job listings):
 * https://developers.greenhouse.io/job-board.html
 */
const API = 'https://boards-api.greenhouse.io/v1/boards';

const GhJob = z.object({
  id: z.number(),
  title: z.string(),
  absolute_url: z.string(),
  updated_at: z.string().nullish(),
  first_published: z.string().nullish(),
  location: z.object({ name: z.string().nullish() }).nullish(),
  content: z.string().nullish(),
  departments: z.array(z.object({ name: z.string() })).nullish(),
  offices: z.array(z.object({ name: z.string().nullish(), location: z.string().nullish() })).nullish(),
  metadata: z.array(z.object({ name: z.string().nullish(), value: z.unknown() })).nullish(),
});
type GhJob = z.infer<typeof GhJob>;

const GhJobs = z.object({ jobs: z.array(GhJob) });
const GhBoard = z.object({ name: z.string() });

export function normalizeGreenhouseJob(j: GhJob, token: string, companyName: string) {
  const description = j.content ? htmlToText(j.content) : undefined;
  const employmentMeta = j.metadata?.find((m) => /employment|job type|commitment/i.test(m.name ?? ''));
  return enrich({
    sourceKey: 'greenhouse',
    externalId: `${token}:${j.id}`,
    sourceUrl: j.absolute_url,
    applicationUrl: j.absolute_url,
    company: companyName,
    title: j.title.trim(),
    location: j.location?.name ?? undefined,
    allLocations: (j.offices ?? []).flatMap((o) => [o.location, o.name]).filter((x): x is string => !!x),
    description,
    employmentType: typeof employmentMeta?.value === 'string' ? employmentMeta.value : undefined,
    postedDate: (j.first_published ?? j.updated_at ?? undefined)?.slice(0, 10),
    department: j.departments?.[0]?.name,
    raw: { provider: 'greenhouse', token, id: j.id, updated_at: j.updated_at },
  });
}

async function get(fetchJson: FetchJson, url: string): Promise<unknown> {
  const res = await fetchJson(url);
  if (res.status === 404) throw new SourceError('Greenhouse board or job not found (check the board token)', 404);
  if (res.status >= 400) throw new SourceError(`Greenhouse API returned HTTP ${res.status}`, res.status);
  return res.body;
}

export const greenhouseConnector: BoardConnector = {
  provider: 'greenhouse',

  async boardInfo(token, fetchJson) {
    const board = GhBoard.parse(await get(fetchJson, `${API}/${encodeURIComponent(token)}`));
    const jobs = GhJobs.parse(await get(fetchJson, `${API}/${encodeURIComponent(token)}/jobs`));
    return { name: board.name, jobCount: jobs.jobs.length };
  },

  async listJobs(board: BoardRef, fetchJson) {
    const parsed = GhJobs.safeParse(await get(fetchJson, `${API}/${encodeURIComponent(board.token)}/jobs?content=true`));
    if (!parsed.success) throw new SourceError('Unexpected Greenhouse response format');
    return parsed.data.jobs.map((j) => normalizeGreenhouseJob(j, board.token, board.companyName));
  },

  async getJob(token, id, fetchJson, companyName) {
    const job = GhJob.parse(await get(fetchJson, `${API}/${encodeURIComponent(token)}/jobs/${encodeURIComponent(id)}`));
    let name = companyName;
    if (!name) {
      const board = GhBoard.safeParse(await get(fetchJson, `${API}/${encodeURIComponent(token)}`));
      name = board.success ? board.data.name : token;
    }
    return normalizeGreenhouseJob(job, token, name);
  },
};
