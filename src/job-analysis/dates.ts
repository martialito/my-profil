/**
 * Date compatibility (section 35): can the candidate do this internship, given their availability?
 *
 * Works at month granularity (availability is expressed in whole months: 2027-03-01 → 2027-08-31).
 * Ambiguity is never resolved by guessing: the result is UNKNOWN, which forbids auto-submission.
 */
import type { DateCompatibilityStatus } from '../models/statuses.js';

export type DatePrecision = 'exact' | 'month' | 'season' | 'duration-only' | 'none';

export interface Availability {
  start: string; // YYYY-MM or YYYY-MM-DD
  end: string;
  minimumDurationMonths?: number;
  idealDurationMonths?: number;
}

export interface DateInput {
  title?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  internshipDuration?: string | null;
  periodHints?: string[] | null;
  description?: string | null;
}

export interface DateCompatibility {
  status: DateCompatibilityStatus;
  /** 0-100, null when UNKNOWN. */
  score: number | null;
  precision: DatePrecision;
  /** Detected internship period, "YYYY-MM". */
  period: { start?: string; end?: string; durationMonths?: number };
  flexible: boolean;
  /** True only for unambiguous compatible dates — required for auto-submission. */
  autoSubmitSafe: boolean;
  reasons: string[];
}

// ── Month arithmetic ───────────────────────────────────────

/** Months since year 0: 2027-03 → 2027*12 + 2. */
export type MonthIndex = number;
export const toIndex = (y: number, m: number): MonthIndex => y * 12 + (m - 1);
export const fromIndex = (i: MonthIndex): string => `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;

function parseIsoMonth(s: string): MonthIndex {
  const m = s.match(/^(\d{4})-(\d{2})/);
  if (!m) throw new Error(`Invalid availability date "${s}"`);
  return toIndex(+m[1]!, +m[2]!);
}

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};
const MONTH_RE = 'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';
const monthNum = (s: string): number => MONTHS[s.toLowerCase().replace('.', '')]!;

/**
 * Typical US internship windows. Spring/fall vary a lot between employers (spring often starts in January),
 * so a season gives 'season' precision only.
 */
const SEASONS: Record<string, [number, number]> = {
  winter: [1, 2],
  spring: [1, 5],
  summer: [6, 8],
  fall: [9, 12],
  autumn: [9, 12],
};

export interface ParsedPeriod {
  start?: MonthIndex;
  end?: MonthIndex;
  precision: Exclude<DatePrecision, 'duration-only' | 'none'>;
  kind: 'range' | 'season' | 'point';
}

/** Parse one period phrase ("March - August 2027", "Summer 2027", "March 2027", "03/15/2027"). */
export function parsePeriod(phrase: string): ParsedPeriod | undefined {
  const p = phrase.toLowerCase().replace(/\s+/g, ' ').trim();
  let m = p.match(new RegExp(`(${MONTH_RE})\\.?(?: (20\\d{2}))? ?(?:-|–|—|to|through|until) ?(${MONTH_RE})\\.? (20\\d{2})`));
  if (m) {
    const m1 = monthNum(m[1]!);
    const m2 = monthNum(m[3]!);
    const y2 = +m[4]!;
    const y1 = m[2] ? +m[2] : m1 <= m2 ? y2 : y2 - 1;
    return { start: toIndex(y1, m1), end: toIndex(y2, m2), precision: 'month', kind: 'range' };
  }
  m = p.match(/(winter|spring|summer|fall|autumn)(?: ?(?:\/|and|&|-) ?(winter|spring|summer|fall|autumn))? (20\d{2})/) ?? p.match(/(20\d{2}) (winter|spring|summer|fall|autumn)/);
  if (m) {
    const [s1, s2, year] = /^\d/.test(m[1]!) ? [m[2]!, undefined, +m[1]!] : [m[1]!, m[2], +m[3]!];
    const a = SEASONS[s1]!;
    const b = SEASONS[s2 ?? s1]!;
    return { start: toIndex(year, a[0]), end: toIndex(year, b[1]), precision: 'season', kind: 'season' };
  }
  m = p.match(/^(20\d{2})-(\d{2})$/);
  if (m && +m[2]! >= 1 && +m[2]! <= 12) return { start: toIndex(+m[1]!, +m[2]!), precision: 'month', kind: 'point' };
  m = p.match(/(\d{1,2})\/\d{1,2}\/(20\d{2})/) ?? p.match(/(20\d{2})-(\d{2})-\d{2}/);
  if (m) {
    const [mm, yy] = m[1]!.length === 4 ? [+m[2]!, +m[1]!] : [+m[1]!, +m[2]!];
    if (mm >= 1 && mm <= 12) return { start: toIndex(yy, mm), precision: 'exact', kind: 'point' };
  }
  m = p.match(new RegExp(`(${MONTH_RE})\\.? (?:\\d{1,2},? )?(20\\d{2})`));
  if (m) return { start: toIndex(+m[2]!, monthNum(m[1]!)), precision: 'month', kind: 'point' };
  return undefined;
}

const NUM: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15 };

/** "6-month" → 6, "12 weeks" → 3, "3-6 months" → 6 (longest bound, conservative). */
export function parseDurationMonths(text: string | null | undefined): number | undefined {
  if (!text) return undefined;
  const m = text.toLowerCase().match(/(\d{1,2}|[a-z]+)(?:\s*(?:-|–|to)\s*(\d{1,2}|[a-z]+))?[\s-]*(month|week)s?/);
  if (!m) return undefined;
  const n = (s?: string) => (s === undefined ? undefined : /^\d+$/.test(s) ? +s : NUM[s]);
  const value = Math.max(n(m[1]) ?? 0, n(m[2]) ?? 0);
  if (!value) return undefined;
  return m[3] === 'week' ? Math.ceil(value / 4.345) : value;
}

const FLEXIBLE_RE = /\b(flexible (?:start|dates?|timing|schedule)|start date (?:is )?(?:flexible|negotiable)|rolling (?:start|basis)|dates? (?:are )?flexible)\b/i;

// ── Main function ──────────────────────────────────────────

/** isDateCompatible(job) — see section 35 of the brief. */
export function isDateCompatible(job: DateInput, availability: Availability): DateCompatibility {
  const availStart = parseIsoMonth(availability.start);
  const availEnd = parseIsoMonth(availability.end);
  const availableMonths = availEnd - availStart + 1;
  const reasons: string[] = [];
  const flexible = FLEXIBLE_RE.test(job.description ?? '');
  const duration = parseDurationMonths(job.internshipDuration);

  // 1. Explicit start / end fields take priority.
  let start: MonthIndex | undefined;
  let end: MonthIndex | undefined;
  let precision: DatePrecision = 'none';
  const ps = job.startDate ? parsePeriod(job.startDate) : undefined;
  const pe = job.endDate ? parsePeriod(job.endDate) : undefined;
  if (ps) {
    start = ps.start;
    end = ps.end;
    precision = ps.precision;
  }
  if (pe) {
    end = pe.start;
    precision = precision === 'none' ? pe.precision : precision;
  }

  // 2. Otherwise period phrases mentioned in the title / description.
  if (start === undefined && end === undefined) {
    const hints = (job.periodHints ?? []).map((h) => ({ h, p: parsePeriod(h) })).filter((x): x is { h: string; p: ParsedPeriod } => !!x.p);
    const ranges = hints.filter((x) => x.p.kind === 'range');
    const seasons = hints.filter((x) => x.p.kind === 'season');
    const points = hints.filter((x) => x.p.kind === 'point');
    const distinct = (list: typeof hints) => new Set(list.map((x) => `${x.p.start}-${x.p.end}`)).size;

    let chosen: (typeof hints)[number] | undefined;
    if (ranges.length) {
      if (distinct(ranges) > 1) reasons.push(`Several periods are mentioned (${ranges.map((r) => r.h).join(', ')}).`);
      else chosen = ranges[0];
    } else if (seasons.length) {
      if (distinct(seasons) > 1) reasons.push(`Several seasons are mentioned (${seasons.map((r) => r.h).join(', ')}).`);
      else chosen = seasons[0];
    } else if (points.length) {
      if (distinct(points) > 1) reasons.push(`Several dates are mentioned (${points.map((r) => r.h).join(', ')}); the start date is unclear.`);
      else chosen = points[0];
    }
    if (chosen) {
      start = chosen.p.start;
      end = chosen.p.end;
      precision = chosen.p.precision;
      reasons.push(`Period found in the offer: "${chosen.h}".`);
    }
  }

  // 3. Derive the end from start + duration.
  if (start !== undefined && end === undefined && duration) end = start + duration - 1;
  if (start !== undefined && end !== undefined && precision !== 'season' && duration && end - start + 1 > duration + 1) {
    reasons.push(`Stated duration (${job.internshipDuration}) and dates do not agree.`);
  }

  const period = {
    start: start !== undefined ? fromIndex(start) : undefined,
    end: end !== undefined ? fromIndex(end) : undefined,
    durationMonths: duration ?? (start !== undefined && end !== undefined ? end - start + 1 : undefined),
  };
  const result = (status: DateCompatibilityStatus, score: number | null, why: string): DateCompatibility => ({
    status,
    score,
    precision: precision === 'none' && duration ? 'duration-only' : precision,
    period,
    flexible,
    autoSubmitSafe: status === 'COMPATIBLE' && (precision === 'exact' || precision === 'month') && !flexible && !reasons.some((r) => /do not agree/.test(r)),
    reasons: [...reasons, why],
  });

  const avail = `${fromIndex(availStart)} → ${fromIndex(availEnd)}`;

  // Minimum duration preference
  if (duration && availability.minimumDurationMonths && duration < availability.minimumDurationMonths) {
    return result('INCOMPATIBLE', 0, `Duration ${duration} month(s) is below your minimum of ${availability.minimumDurationMonths}.`);
  }
  if (duration && duration > availableMonths) {
    return result('INCOMPATIBLE', 0, `Duration ${duration} months exceeds your ${availableMonths}-month availability (${avail}).`);
  }

  if (start === undefined && end === undefined) {
    if (duration) return result('UNKNOWN', null, `Only a duration is stated (${job.internshipDuration}); no start date.`);
    return result('UNKNOWN', null, 'No internship dates found in the offer.');
  }
  if (start === undefined) {
    if (end! < availStart) return result('INCOMPATIBLE', 0, `Ends ${fromIndex(end!)}, before your availability (${avail}).`);
    if (end! > availEnd) return result('INCOMPATIBLE', 0, `Ends ${fromIndex(end!)}, after your availability ends (${avail}).`);
    return result('UNKNOWN', null, `Ends ${fromIndex(end!)} but the start date is not stated.`);
  }

  if (start > availEnd) return result('INCOMPATIBLE', 0, `Starts ${fromIndex(start)}, after your availability ends (${avail}).`);
  if (end !== undefined && end < availStart) return result('INCOMPATIBLE', 0, `Runs ${fromIndex(start)} → ${fromIndex(end)}, before your availability (${avail}).`);

  if (start < availStart) {
    if (precision === 'season' || flexible) {
      return result('UNKNOWN', null, `May start ${fromIndex(start)}, before you are available (${fromIndex(availStart)}); the exact start date must be confirmed.`);
    }
    return result('INCOMPATIBLE', 0, `Starts ${fromIndex(start)}, before you are available (${fromIndex(availStart)}).`);
  }

  if (end !== undefined && end > availEnd) {
    if (flexible) return result('UNKNOWN', null, `Runs until ${fromIndex(end)}, after ${fromIndex(availEnd)}; dates are said to be flexible.`);
    return result('INCOMPATIBLE', 0, `Runs until ${fromIndex(end)}, after your availability ends (${fromIndex(availEnd)}).`);
  }

  // Inside the availability window.
  if (end === undefined) {
    return result('COMPATIBLE', 85, `Starts ${fromIndex(start)}, within your availability; end date not stated.`);
  }
  const months = end - start + 1;
  const ideal = availability.idealDurationMonths ?? 0;
  let score = precision === 'season' ? 85 : 100;
  if (flexible) score = Math.min(score, 80);
  if (ideal && months < ideal - 1) score -= 10;
  return result('COMPATIBLE', score, `Runs ${fromIndex(start)} → ${fromIndex(end)} (${months} month${months > 1 ? 's' : ''}), within your availability.`);
}
