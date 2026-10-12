/**
 * Matching application-form questions to the Answer Bank (section 12).
 *
 * Deterministic and conservative: similar wordings are recognised through synonyms and token overlap,
 * but any doubt (medium similarity, a "sensitive" word that differs such as "currently" / "future" / "not",
 * an answer that does not fit the field's options) results in "needs confirmation" — never in a guess.
 */

const STOP = new Set(
  'a an the you your are is be will do does did have has of to for in on at with as by or and this that we our us please any if would could can i me my it its which what when how who be been being'.split(' '),
);

/** Map wording variants to a canonical token. */
const SYNONYMS: Array<[RegExp, string]> = [
  [/\b(legally )?(authori[sz]ed|eligible|permitted|entitled|allowed)\b/g, 'authorized'],
  [/\b(sponsor(ship|ed|ing)?|h-?1b|visa support|work visa)\b/g, 'sponsorship'],
  [/\b(united states|u\.?s\.?a?|america)\b/g, 'us'],
  [/\b(work|employment|job)\b/g, 'work'],
  [/\b(enrolled|enrol(l)?ment|student|studying|attending)\b/g, 'enrolled'],
  [/\b(start(ing)?|begin(ning)?|commence|available from|availability start)\b/g, 'start'],
  [/\b(finish|end(ing)?|until|available until|last day)\b/g, 'end'],
  [/\b(salary|compensation|pay|wage|remuneration|stipend)\b/g, 'salary'],
  [/\b(expectations?|expected|desired|requirements?)\b/g, 'expectation'],
  [/\b(relocat(e|ion|ing)|move|moving)\b/g, 'relocate'],
  [/\b(months?)\b/g, 'month'],
  [/\b(how did you (hear|find|learn)|source|referr?al|referred)\b/g, 'heard'],
];

/** Words that change the meaning of a question: if they differ, the match is ambiguous. */
const SENSITIVE = ['not', 'never', 'future', 'currently', 'now', 'ever', 'previously', 'former', 'within', 'outside', 'under', 'over'];

export function normalizeQuestion(q: string): string {
  let s = q.toLowerCase().replace(/[’']/g, '').replace(/\*/g, ' ');
  for (const [re, canon] of SYNONYMS) s = s.replace(re, ` ${canon} `);
  return s.replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export function tokens(q: string): Set<string> {
  return new Set(normalizeQuestion(q).split(' ').filter((t) => t.length > 1 && !STOP.has(t)));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

function sensitive(q: string): Set<string> {
  const words = new Set(q.toLowerCase().replace(/[^a-z ]+/g, ' ').split(/\s+/));
  return new Set(SENSITIVE.filter((w) => words.has(w)));
}

export interface BankEntry {
  id: number;
  question: string;
  aliases: string[];
  answer: string | null;
  requiresConfirmation: boolean;
  category: string | null;
}

export type MatchStatus = 'matched' | 'needs_confirmation' | 'unanswered' | 'unknown';

export interface MatchResult {
  status: MatchStatus;
  entry?: BankEntry;
  answer?: string;
  similarity: number;
  reason: string;
}

export const MATCH_THRESHOLD = 0.6;
export const AMBIGUOUS_THRESHOLD = 0.34;

export function matchQuestion(question: string, bank: BankEntry[]): MatchResult {
  const qt = tokens(question);
  let best: { entry: BankEntry; sim: number; wording: string } | undefined;
  for (const entry of bank) {
    for (const wording of [entry.question, ...entry.aliases]) {
      const sim = jaccard(qt, tokens(wording));
      if (!best || sim > best.sim) best = { entry, sim, wording };
    }
  }
  if (!best || best.sim < AMBIGUOUS_THRESHOLD) return { status: 'unknown', similarity: best?.sim ?? 0, reason: 'No similar question in your Answer Bank.' };

  const { entry, sim, wording } = best;
  const a = sensitive(question);
  const b = sensitive(wording);
  const sensitiveDiff = [...a].filter((w) => !b.has(w)).concat([...b].filter((w) => !a.has(w)));

  if (entry.answer === null || entry.answer.trim() === '') {
    return { status: 'unanswered', entry, similarity: sim, reason: `Recognised as "${entry.question}", but you have not configured an answer yet.` };
  }
  if (sim < MATCH_THRESHOLD) {
    return { status: 'needs_confirmation', entry, answer: entry.answer, similarity: sim, reason: `Looks like "${entry.question}" but the wording differs: please confirm.` };
  }
  if (sensitiveDiff.length) {
    return { status: 'needs_confirmation', entry, answer: entry.answer, similarity: sim, reason: `Similar to "${entry.question}" but differs on "${sensitiveDiff.join('", "')}": please confirm.` };
  }
  if (entry.requiresConfirmation) {
    return { status: 'needs_confirmation', entry, answer: entry.answer, similarity: sim, reason: 'You asked to always confirm this answer.' };
  }
  return { status: 'matched', entry, answer: entry.answer, similarity: sim, reason: `Matches "${entry.question}".` };
}

/**
 * Fit a stored answer to a select/radio field's options.
 * Exact (case-insensitive) match, or a yes/no answer to an option starting with yes/no. Otherwise undefined.
 */
export function fitToOptions(answer: string, options: string[]): string | undefined {
  const a = answer.trim().toLowerCase();
  const exact = options.find((o) => o.trim().toLowerCase() === a);
  if (exact) return exact;
  if (a === 'yes' || a === 'no') {
    const candidates = options.filter((o) => new RegExp(`^${a}\\b`, 'i').test(o.trim()));
    return candidates.length === 1 ? candidates[0] : undefined;
  }
  const contains = options.filter((o) => o.toLowerCase().includes(a) && a.length >= 4);
  return contains.length === 1 ? contains[0] : undefined;
}
