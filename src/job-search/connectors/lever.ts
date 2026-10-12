import { z } from 'zod';
import { SourceError, type FetchJson } from '../http.js';
import { htmlToText } from '../text.js';
import { enrich } from './normalize.js';
import type { BoardConnector, BoardRef } from './types.js';

/**
 * Lever public Postings API (no auth, intended for publishing job listings):
 * https://github.com/lever/postings-api
 */
const API = 'https://api.lever.co/v0/postings';

const LeverPosting = z.object({
  id: z.string(),
  text: z.string(),
  hostedUrl: z.string(),
  applyUrl: z.string().nullish(),
  createdAt: z.number().nullish(),
  workplaceType: z.string().nullish(),
  categories: z
    .object({
      location: z.string().nullish(),
      commitment: z.string().nullish(),
      team: z.string().nullish(),
      department: z.string().nullish(),
      allLocations: z.array(z.string()).nullish(),
    })
    .nullish(),
  description: z.string().nullish(),
  descriptionPlain: z.string().nullish(),
  lists: z.array(z.object({ text: z.string(), content: z.string() })).nullish(),
  additional: z.string().nullish(),
  additionalPlain: z.string().nullish(),
  salaryRange: z
    .object({ min: z.number().nullish(), max: z.number().nullish(), currency: z.string().nullish(), interval: z.string().nullish() })
    .nullish(),
  salaryDescriptionPlain: z.string().nullish(),
});
type LeverPosting = z.infer<typeof LeverPosting>;

const REQ = /(requirement|qualification|what you(?:'|’)?ll (?:need|bring)|who you are|about you|skills|you have|nice to have|preferred)/i;
const RESP = /(responsibilit|what you(?:'|’)?ll do|what you will do|the role|duties|day[- ]to[- ]day|you will)/i;

function formatSalary(r: LeverPosting['salaryRange']): string | undefined {
  if (!r || (r.min == null && r.max == null)) return undefined;
  const cur = r.currency === 'USD' || !r.currency ? '$' : `${r.currency} `;
  const fmt = (n: number) => `${cur}${n.toLocaleString('en-US')}`;
  const range = r.min != null && r.max != null && r.min !== r.max ? `${fmt(r.min)} - ${fmt(r.max)}` : fmt((r.min ?? r.max)!);
  const interval = r.interval ? ` ${r.interval.replace(/-/g, ' ')}` : '';
  return range + interval;
}

export function normalizeLeverPosting(p: LeverPosting, site: string, companyName: string) {
  const lists = p.lists ?? [];
  const items = (html: string) => htmlToText(html).split('\n').map((l) => l.replace(/^•\s*/, '').trim()).filter(Boolean);
  const listText = lists.map((l) => `${l.text}\n${htmlToText(l.content)}`).join('\n\n');
  const description = [p.descriptionPlain ?? (p.description ? htmlToText(p.description) : ''), listText, p.additionalPlain ?? (p.additional ? htmlToText(p.additional) : '')]
    .filter(Boolean)
    .join('\n\n')
    .trim();
  return enrich({
    sourceKey: 'lever',
    externalId: `${site}:${p.id}`,
    sourceUrl: p.hostedUrl,
    applicationUrl: p.applyUrl ?? p.hostedUrl,
    company: companyName,
    title: p.text.trim(),
    location: p.categories?.location ?? undefined,
    allLocations: p.categories?.allLocations ?? [],
    description: description || undefined,
    requirements: lists.filter((l) => REQ.test(l.text)).flatMap((l) => items(l.content)),
    responsibilities: lists.filter((l) => RESP.test(l.text)).flatMap((l) => items(l.content)),
    salary: formatSalary(p.salaryRange) ?? p.salaryDescriptionPlain ?? undefined,
    employmentType: p.categories?.commitment ?? undefined,
    postedDate: p.createdAt ? new Date(p.createdAt).toISOString().slice(0, 10) : undefined,
    department: p.categories?.department ?? p.categories?.team ?? undefined,
    workplaceType: p.workplaceType ?? undefined,
    raw: { provider: 'lever', site, id: p.id },
  });
}

async function get(fetchJson: FetchJson, url: string): Promise<unknown> {
  const res = await fetchJson(url);
  if (res.status === 404) throw new SourceError('Lever site or posting not found (check the site name)', 404);
  if (res.status >= 400) throw new SourceError(`Lever API returned HTTP ${res.status}`, res.status);
  return res.body;
}

export const leverConnector: BoardConnector = {
  provider: 'lever',

  async boardInfo(token, fetchJson) {
    const list = z.array(LeverPosting).safeParse(await get(fetchJson, `${API}/${encodeURIComponent(token)}?mode=json`));
    if (!list.success) throw new SourceError('Unexpected Lever response format');
    return { name: token, jobCount: list.data.length };
  },

  async listJobs(board: BoardRef, fetchJson) {
    const list = z.array(LeverPosting).safeParse(await get(fetchJson, `${API}/${encodeURIComponent(board.token)}?mode=json`));
    if (!list.success) throw new SourceError('Unexpected Lever response format');
    return list.data.map((p) => normalizeLeverPosting(p, board.token, board.companyName));
  },

  async getJob(token, id, fetchJson, companyName) {
    const p = LeverPosting.parse(await get(fetchJson, `${API}/${encodeURIComponent(token)}/${encodeURIComponent(id)}?mode=json`));
    return normalizeLeverPosting(p, token, companyName ?? token);
  },
};
