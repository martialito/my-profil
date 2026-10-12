import type { LocationMatch, NormalizedJob } from '../models/job.js';

const strip = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();

const NYC_RE = /\b(new york city|nyc|manhattan|brooklyn|queens|bronx|staten island|long island city|astoria|harlem|soho|tribeca|chelsea|midtown|flatiron|dumbo)\b/;
const NEAR_RE = /\b(jersey city|hoboken|newark|weehawken|secaucus|white plains|yonkers|stamford|long island|westchester)\b/;
const REMOTE_RE = /\b(remote|anywhere|work from home|wfh)\b/;

/** Classify one location string relative to NYC. */
export function matchLocation(location: string | undefined, extra: string[] = []): LocationMatch {
  if (!location) return 'none';
  const loc = strip(location);
  if (NYC_RE.test(loc)) return 'nyc';
  for (const e of extra) {
    const t = strip(e).trim();
    if (t.length >= 3 && !/^(new york|ny)$/.test(t) && loc.includes(t)) return 'nyc';
  }
  // "New York, NY", "New York, New York", "New York (Hybrid)": first part must be the city itself.
  const parts = loc.split(/[,;/|•()]|\bor\b|\s-\s/).map((p) => p.trim()).filter(Boolean);
  if (parts.some((p, i) => /^new york$/.test(p) || /^new york\b(?!\s+state)/.test(p) || (i > 0 && p === 'ny' && /^new york/.test(parts[i - 1]!)))) {
    return 'nyc';
  }
  if (/^new york\b/.test(loc) && !/\bstate\b/.test(loc)) return 'nyc';
  if (NEAR_RE.test(loc)) return 'near';
  if (REMOTE_RE.test(loc)) return 'remote';
  return 'none';
}

/** Best match across all listed locations (nyc > near > remote > none). */
export function matchJobLocation(job: Pick<NormalizedJob, 'location' | 'allLocations' | 'workplaceType'>, extra: string[] = []): LocationMatch {
  const order: LocationMatch[] = ['nyc', 'near', 'remote', 'none'];
  const all = [job.location, ...job.allLocations].filter((l): l is string => !!l);
  let best: LocationMatch = 'none';
  for (const l of all) {
    const m = matchLocation(l, extra);
    if (order.indexOf(m) < order.indexOf(best)) best = m;
  }
  if (best === 'none' && job.workplaceType && /remote/i.test(job.workplaceType)) best = 'remote';
  return best;
}

const INTERN_RE = /\b(intern|interns|internship|internships|co-?op|stagiaire|summer analyst|summer associate|apprentice(ship)?|trainee)\b/i;
const NON_INTERN_RE = /\b(senior|sr\.?|staff|principal|lead|manager|director|head of|vp|vice president|chief)\b/i;

export interface InternshipCheck {
  isInternship: boolean;
  reason?: string;
}

/**
 * Internship detection (section 36). A role counts as an internship only when the title or the
 * employment type says so. "Manager" etc. are accepted only alongside an explicit intern keyword
 * (e.g. "Product Manager Intern").
 */
export function checkInternship(job: Pick<NormalizedJob, 'title' | 'employmentType'>): InternshipCheck {
  const titleIntern = INTERN_RE.test(job.title);
  const typeIntern = !!job.employmentType && INTERN_RE.test(job.employmentType);
  if (titleIntern || typeIntern) return { isInternship: true };
  if (NON_INTERN_RE.test(job.title)) return { isInternship: false, reason: 'senior/manager position' };
  if (job.employmentType && /full[- ]?time|permanent|regular/i.test(job.employmentType)) {
    return { isInternship: false, reason: `employment type "${job.employmentType}"` };
  }
  return { isInternship: false, reason: 'no intern/internship keyword in the title or employment type' };
}

export interface FilterContext {
  internshipOnly: boolean;
  allowRemote: boolean;
  extraLocations: string[];
}

export type FilterResult = { keep: true; locationMatch: LocationMatch } | { keep: false; reason: 'not_internship' | 'not_nyc'; detail: string };

export function applySearchFilters(job: NormalizedJob, ctx: FilterContext): FilterResult {
  if (ctx.internshipOnly) {
    const c = checkInternship(job);
    if (!c.isInternship) return { keep: false, reason: 'not_internship', detail: c.reason ?? '' };
  }
  const locationMatch = matchJobLocation(job, ctx.extraLocations);
  if (locationMatch === 'none' || (locationMatch === 'remote' && !ctx.allowRemote)) {
    return { keep: false, reason: 'not_nyc', detail: [job.location, ...job.allLocations].filter(Boolean).join(' | ') || 'no location' };
  }
  return { keep: true, locationMatch };
}
