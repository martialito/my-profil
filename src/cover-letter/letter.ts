/**
 * Cover letter generation helpers: output schema, verification and plain-text rendering.
 * The LLM must justify each factual claim with an exact quote from the Master CV, the candidate's motivations
 * or the offer; unverifiable claims and stock phrases are reported and trigger one rewrite.
 */
import { z } from 'zod';
import { appearsIn } from '../job-analysis/scoring.js';

export const LlmCoverLetterSchema = z.object({
  greeting: z.string(),
  paragraphs: z.array(z.string()),
  sign_off: z.string(),
  claims: z.array(
    z.object({
      statement: z.string(),
      source: z.enum(['master_cv', 'motivations', 'job_offer']),
      quote: z.string(),
    }),
  ),
});
export type LlmCoverLetter = z.infer<typeof LlmCoverLetterSchema>;

/** Generic openings/phrases that make every letter sound the same (section 10). */
export const STOCK_PHRASES = [
  'i am writing to express my',
  'keen interest',
  'i am thrilled',
  'i am excited to apply',
  'esteemed',
  'perfect fit',
  'dynamic team',
  'i believe i would be a great',
  'to whom it may concern',
  'passion for excellence',
  'fast-paced environment',
  'hit the ground running',
];

export interface LetterSources {
  masterCv: string;
  motivations: string;
  job: string;
}

export interface LetterCheck {
  issues: string[];
  stockPhrases: string[];
  unverifiedClaims: string[];
  inventedNumbers: string[];
  wordCount: number;
}

const numbersIn = (t: string) => (t.match(/\d+(?:[.,]\d+)?\s*%?/g) ?? []).map((n) => n.replace(/\s+/g, '').replace(',', '.'));

export function letterText(l: Pick<LlmCoverLetter, 'greeting' | 'paragraphs' | 'sign_off'>, signature: string): string {
  return [l.greeting.trim(), '', ...l.paragraphs.map((p) => p.trim()).flatMap((p) => [p, '']), l.sign_off.trim(), signature].join('\n').trim() + '\n';
}

export function checkLetter(body: string, claims: LlmCoverLetter['claims'], src: LetterSources, opts: { company: string; title: string }): LetterCheck {
  const lower = body.toLowerCase();
  const stockPhrases = STOCK_PHRASES.filter((p) => lower.includes(p));
  const unverifiedClaims = claims
    .filter((c) => !appearsIn(c.quote, c.source === 'master_cv' ? src.masterCv : c.source === 'motivations' ? src.motivations : src.job))
    .map((c) => c.statement);
  const known = new Set([...numbersIn(src.masterCv), ...numbersIn(src.job), ...numbersIn(src.motivations)]);
  const inventedNumbers = [...new Set(numbersIn(body).filter((n) => !known.has(n)))];
  const wordCount = body.split(/\s+/).filter(Boolean).length;
  const issues: string[] = [];
  if (!lower.includes(opts.company.toLowerCase())) issues.push(`The letter never names the company (${opts.company}).`);
  if (stockPhrases.length) issues.push(`Generic phrases: ${stockPhrases.map((p) => `"${p}"`).join(', ')}.`);
  if (unverifiedClaims.length) issues.push(`Claims without a matching quote in your documents: ${unverifiedClaims.map((c) => `"${c}"`).join('; ')}.`);
  if (inventedNumbers.length) issues.push(`Figures not found in your Master CV or the offer: ${inventedNumbers.join(', ')}.`);
  if (wordCount < 150 || wordCount > 450) issues.push(`Length is ${wordCount} words (expected 250-350).`);
  return { issues, stockPhrases, unverifiedClaims, inventedNumbers, wordCount };
}
