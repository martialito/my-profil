/**
 * Deterministic extraction of facts that appear literally in an offer.
 * Nothing is inferred: if a pattern is not found, the field stays undefined.
 */

const SALARY_RE =
  /\$\s?\d{1,3}(?:,\d{3})*(?:\.\d+)?\s?[kK]?(?:\s?(?:-|–|—|to)\s?\$?\s?\d{1,3}(?:,\d{3})*(?:\.\d+)?\s?[kK]?)?(?:\s?(?:\/|per|an|a)\s?(?:hour|hr|year|yr|annum|week|month))?/;

export function extractSalary(text: string): string | undefined {
  const m = text.match(SALARY_RE);
  return m ? m[0].replace(/\s+/g, ' ').trim() : undefined;
}

const NUM_WORDS = 'one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen';
const DURATION_RE = new RegExp(`\\b(\\d{1,2}|${NUM_WORDS})(?:\\s*(?:-|–|to)\\s*(?:\\d{1,2}|${NUM_WORDS}))?[\\s-]*(month|week)s?\\b`, 'i');

export function extractDuration(text: string): string | undefined {
  const m = text.match(DURATION_RE);
  return m ? m[0].trim() : undefined;
}

const MONTHS = 'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';
const SEASONS = 'spring|summer|fall|autumn|winter';
const YEAR = '20\\d{2}';
const PERIOD_RES = [
  // "March - August 2027", "March 2027 – August 2027"
  new RegExp(`\\b(?:${MONTHS})(?:\\s+${YEAR})?\\s*(?:-|–|—|to|through)\\s*(?:${MONTHS})\\s+${YEAR}\\b`, 'gi'),
  // "Summer 2027", "Spring/Summer 2027"
  new RegExp(`\\b(?:${SEASONS})(?:\\s*(?:\\/|and|&|-)\\s*(?:${SEASONS}))?\\s+${YEAR}\\b`, 'gi'),
  // "March 2027"
  new RegExp(`\\b(?:${MONTHS})\\.?\\s+${YEAR}\\b`, 'gi'),
  // "2027 Summer"
  new RegExp(`\\b${YEAR}\\s+(?:${SEASONS})\\b`, 'gi'),
];

/** All period phrases found in title + description, longest first, deduplicated. */
export function extractPeriodHints(text: string): string[] {
  const found: string[] = [];
  for (const re of PERIOD_RES) {
    for (const m of text.matchAll(re)) {
      const phrase = m[0].replace(/\s+/g, ' ').trim();
      if (!found.some((f) => f.toLowerCase().includes(phrase.toLowerCase()))) found.push(phrase);
    }
  }
  return found.slice(0, 8);
}

const START_RE = new RegExp(
  `\\bstart(?:s|ing)?(?:\\s+date)?(?:\\s+(?:in|on|from))?\\s*[:\\-]?\\s*((?:${MONTHS})\\.?\\s+(?:\\d{1,2},?\\s+)?${YEAR}|(?:${SEASONS})\\s+${YEAR}|\\d{1,2}\\/\\d{1,2}\\/${YEAR}|${YEAR}-\\d{2}-\\d{2})`,
  'i',
);
const END_RE = new RegExp(
  `\\b(?:end(?:s|ing)?(?:\\s+date)?|through|until)\\s*(?:in|on)?\\s*[:\\-]?\\s*((?:${MONTHS})\\.?\\s+(?:\\d{1,2},?\\s+)?${YEAR}|\\d{1,2}\\/\\d{1,2}\\/${YEAR}|${YEAR}-\\d{2}-\\d{2})`,
  'i',
);

/** Explicit start/end phrases ("Start date: March 2027"), kept as written. */
export function extractStartEnd(text: string): { startDate?: string; endDate?: string } {
  return { startDate: text.match(START_RE)?.[1]?.trim(), endDate: text.match(END_RE)?.[1]?.trim() };
}
