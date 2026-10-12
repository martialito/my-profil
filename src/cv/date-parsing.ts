const MONTHS: Record<string, number> = {
  jan: 1, january: 1, janv: 1, janvier: 1,
  feb: 2, february: 2, fev: 2, fevr: 2, fevrier: 2,
  mar: 3, march: 3, mars: 3,
  apr: 4, april: 4, avr: 4, avril: 4,
  may: 5, mai: 5,
  jun: 6, june: 6, juin: 6,
  jul: 7, july: 7, juil: 7, juillet: 7,
  aug: 8, august: 8, aout: 8,
  sep: 9, sept: 9, september: 9, septembre: 9,
  oct: 10, october: 10, octobre: 10,
  nov: 11, november: 11, novembre: 11,
  dec: 12, december: 12, decembre: 12,
};

const strip = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Parse one CV date token to "YYYY" or "YYYY-MM". Returns undefined if not recognisable. */
export function parseCvDate(token: string): string | undefined {
  const t = strip(token).replace(/\./g, '').trim();
  let m = t.match(/^(\d{4})-(\d{1,2})(?:-\d{1,2})?$/);
  if (m) return `${m[1]}-${m[2]!.padStart(2, '0')}`;
  m = t.match(/^(\d{1,2})\/(\d{4})$/);
  if (m && +m[1]! >= 1 && +m[1]! <= 12) return `${m[2]}-${m[1]!.padStart(2, '0')}`;
  m = t.match(/^([a-z]+)\s+(\d{4})$/);
  if (m && MONTHS[m[1]!]) return `${m[2]}-${String(MONTHS[m[1]!]).padStart(2, '0')}`;
  m = t.match(/^(\d{4})$/);
  if (m) return m[1];
  return undefined;
}

const MONTH_WORDS = Object.keys(MONTHS).join('|');
const DATE_TOKEN = `(?:(?:${MONTH_WORDS})\\.?\\s+\\d{4}|\\d{1,2}/\\d{4}|\\d{4}-\\d{2}|\\d{4})`;
const PRESENT = '(?:present|current|now|today|aujourd\'?hui|actuel|en cours)';
export const DATE_RANGE_RE = new RegExp(`(${DATE_TOKEN})\\s*(?:-|–|—|to|a|à|au)\\s*(${DATE_TOKEN}|${PRESENT})`, 'i');

export interface ParsedRange {
  startDate?: string;
  endDate?: string;
  isCurrent: boolean;
  matched: string;
}

export function findDateRange(line: string): ParsedRange | undefined {
  const m = strip(line).match(DATE_RANGE_RE);
  if (!m) return undefined;
  const isCurrent = new RegExp(`^${PRESENT}$`, 'i').test(m[2]!.trim());
  return {
    startDate: parseCvDate(m[1]!),
    endDate: isCurrent ? undefined : parseCvDate(m[2]!),
    isCurrent,
    matched: m[0],
  };
}
