/**
 * Duplicate detection (section 19).
 * 1. Same canonical URL → same offer (hard rule).
 * 2. Same company + very similar title + compatible location + similar description → grouped as duplicates.
 */

const TRACKING_PARAMS = /^(utm_.*|gh_src|gh_jid_src|source|src|ref|refid|trk|trackingid|lever-source|lever-origin|lever-via|from|campaign|ccuid|cmp|mode|iis|iisn)$/i;

export function canonicalizeUrl(input: string): string {
  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    return input.trim();
  }
  u.hash = '';
  u.protocol = 'https:';
  u.hostname = u.hostname.toLowerCase().replace(/^www\./, '');
  for (const key of [...u.searchParams.keys()]) {
    if (TRACKING_PARAMS.test(key)) u.searchParams.delete(key);
  }
  u.searchParams.sort();
  // Lever "/apply" and trailing slashes point to the same posting.
  u.pathname = u.pathname.replace(/\/apply\/?$/, '').replace(/\/+$/, '') || '/';
  return u.toString().replace(/\?$/, '');
}

const COMPANY_SUFFIX = /\b(inc|incorporated|llc|ltd|limited|corp|corporation|co|company|group|holdings|plc|sa|sas|gmbh|the)\b/g;

export function normalizeCompany(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(COMPANY_SUFFIX, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const TITLE_NOISE = /\b(the|a|an|of|for|and|to|in|at|-|–|—|nyc|new york|ny|remote|hybrid|onsite)\b/g;

export function titleTokens(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .replace(/\b(internship|interns)\b/g, 'intern')
      .replace(/[()[\],|/:]+/g, ' ')
      .replace(TITLE_NOISE, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 1),
  );
}

export function jaccard<T>(a: Set<T>, b: Set<T>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

/** Word 3-shingles of a description, for near-duplicate detection. */
export function shingles(text: string, k = 3): Set<string> {
  const words = text.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(Boolean);
  const out = new Set<string>();
  for (let i = 0; i + k <= words.length; i++) out.add(words.slice(i, i + k).join(' '));
  return out;
}

export interface DedupCandidate {
  id: number;
  company: string;
  title: string;
  location?: string | null;
  locationMatch?: string | null;
  description?: string | null;
}

export interface DuplicateScore {
  title: number;
  description: number | null;
  isDuplicate: boolean;
}

export const TITLE_THRESHOLD = 0.75;
export const DESCRIPTION_THRESHOLD = 0.5;

export function compareJobs(a: Omit<DedupCandidate, 'id'>, b: Omit<DedupCandidate, 'id'>): DuplicateScore {
  if (normalizeCompany(a.company) !== normalizeCompany(b.company)) return { title: 0, description: null, isDuplicate: false };
  const title = jaccard(titleTokens(a.title), titleTokens(b.title));
  const sameArea =
    !a.location || !b.location || (a.locationMatch && a.locationMatch === b.locationMatch) || a.location.toLowerCase() === b.location.toLowerCase();
  let description: number | null = null;
  if (a.description && b.description) description = jaccard(shingles(a.description), shingles(b.description));
  const isDuplicate =
    !!sameArea && title >= TITLE_THRESHOLD && (description === null ? title === 1 : description >= DESCRIPTION_THRESHOLD);
  return { title, description, isDuplicate };
}

/** Return the existing job the new one duplicates, if any (best title match wins). */
export function findDuplicate(job: Omit<DedupCandidate, 'id'>, candidates: DedupCandidate[]): DedupCandidate | undefined {
  let best: { c: DedupCandidate; score: number } | undefined;
  for (const c of candidates) {
    const s = compareJobs(job, c);
    if (s.isDuplicate && (!best || s.title > best.score)) best = { c, score: s.title };
  }
  return best?.c;
}
