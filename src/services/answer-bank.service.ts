import { asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { matchQuestion, normalizeQuestion, type BankEntry, type MatchResult } from '../application/answer-matching.js';
import type { Db } from '../database/client.js';
import { applicationAnswers } from '../database/schema.js';
import { getLlmProvider, llmConfigFromSettings, loadPrompt, renderPrompt } from '../llm/index.js';
import { AppError, NotFoundError } from '../utils/errors.js';
import { ProfileService } from './profile.service.js';
import { SettingsService } from './settings.service.js';
import { ensureDefaultUser } from './user.service.js';

export const AnswerInputSchema = z.object({
  question: z.string().trim().min(3).max(500),
  answer: z.string().trim().max(5000).nullable().optional(),
  aliases: z.array(z.string().trim().min(3).max(500)).default([]),
  category: z.string().trim().max(50).nullable().optional(),
  requiresConfirmation: z.boolean().default(false),
});
export type AnswerInput = z.input<typeof AnswerInputSchema>;

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthYear = (iso: string) => `${MONTHS[+iso.slice(5, 7) - 1]} ${iso.slice(0, 4)}`;

/**
 * Default questions (section 11). Answers are left EMPTY on purpose, except availability, which comes from
 * your own Settings. Work authorization / sponsorship fall back to My Profile when left empty here.
 */
function defaults(availabilityStart: string, availabilityEnd: string): AnswerInput[] {
  const months = (+availabilityEnd.slice(0, 4) * 12 + +availabilityEnd.slice(5, 7)) - (+availabilityStart.slice(0, 4) * 12 + +availabilityStart.slice(5, 7)) + 1;
  return [
    { question: 'Are you authorized to work in the United States?', category: 'work_authorization', aliases: ['Are you legally authorized to work in the US?', 'Are you eligible to work in the United States?'] },
    { question: 'Will you now or in the future require sponsorship for employment visa status?', category: 'sponsorship', aliases: ['Will you require visa sponsorship?', 'Do you require sponsorship to work in the US?'] },
    { question: 'Are you currently enrolled in a degree program?', category: 'enrollment', aliases: ['Are you currently a student?'] },
    { question: 'When can you start?', category: 'availability', answer: monthYear(availabilityStart), aliases: ['What is your earliest start date?', 'Available start date'] },
    { question: 'When can you finish?', category: 'availability', answer: monthYear(availabilityEnd), aliases: ['What is your end date?', 'Until when are you available?'] },
    { question: 'How many months are you available?', category: 'availability', answer: String(months), aliases: ['What is the length of your availability in months?'] },
    { question: 'What are your salary expectations?', category: 'salary', aliases: ['Desired compensation', 'Expected hourly rate'] },
    { question: 'Are you willing to relocate?', category: 'relocation', aliases: ['Are you willing to relocate to New York?'] },
    { question: 'How did you hear about this position?', category: 'source', aliases: ['How did you find this job?'] },
  ];
}

type Row = typeof applicationAnswers.$inferSelect;
const toEntry = (r: Row): BankEntry => ({ id: r.id, question: r.question, aliases: r.aliases, answer: r.answer, requiresConfirmation: r.requiresConfirmation, category: r.category });

export class AnswerBankService {
  constructor(private readonly db: Db) {}

  /** Seed the default questions once (only when the bank is empty). */
  ensureDefaults(): void {
    const existing = this.db.select({ id: applicationAnswers.id }).from(applicationAnswers).limit(1).get();
    if (existing) return;
    const s = new SettingsService(this.db).get().search;
    for (const d of defaults(s.availabilityStart, s.availabilityEnd)) this.create(d);
  }

  list(): BankEntry[] {
    this.ensureDefaults();
    return this.db.select().from(applicationAnswers).orderBy(asc(applicationAnswers.id)).all().map(toEntry);
  }

  /** Entries with profile fallbacks applied (work authorization / sponsorship from My Profile). */
  effectiveEntries(): BankEntry[] {
    const wa = new ProfileService(this.db).get().workAuthorization;
    const fallback: Record<string, string | undefined> = {
      work_authorization: wa.authorizedToWorkInUS === 'yes' ? 'Yes' : wa.authorizedToWorkInUS === 'no' ? 'No' : undefined,
      sponsorship: wa.requiresSponsorship === 'yes' ? 'Yes' : wa.requiresSponsorship === 'no' ? 'No' : undefined,
    };
    return this.list().map((e) => (e.answer || !e.category || !fallback[e.category] ? e : { ...e, answer: fallback[e.category]! }));
  }

  create(input: AnswerInput): BankEntry {
    const d = AnswerInputSchema.parse(input);
    const { userId } = ensureDefaultUser(this.db);
    const row = this.db
      .insert(applicationAnswers)
      .values({ userId, question: d.question, normalizedQuestion: normalizeQuestion(d.question), answer: d.answer || null, aliases: d.aliases, category: d.category ?? null, requiresConfirmation: d.requiresConfirmation })
      .returning()
      .get();
    return toEntry(row);
  }

  update(id: number, input: AnswerInput): BankEntry {
    const d = AnswerInputSchema.parse(input);
    const row = this.db
      .update(applicationAnswers)
      .set({ question: d.question, normalizedQuestion: normalizeQuestion(d.question), answer: d.answer || null, aliases: d.aliases, category: d.category ?? null, requiresConfirmation: d.requiresConfirmation, updatedAt: sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))` })
      .where(eq(applicationAnswers.id, id))
      .returning()
      .get();
    if (!row) throw new NotFoundError(`Answer ${id}`);
    return toEntry(row);
  }

  remove(id: number): void {
    if (this.db.delete(applicationAnswers).where(eq(applicationAnswers.id, id)).run().changes === 0) throw new NotFoundError(`Answer ${id}`);
  }

  /** Add a new wording to an existing entry (after you confirmed a match). */
  addAlias(id: number, wording: string): BankEntry {
    const e = this.list().find((x) => x.id === id);
    if (!e) throw new NotFoundError(`Answer ${id}`);
    if ([e.question, ...e.aliases].some((w) => normalizeQuestion(w) === normalizeQuestion(wording))) return e;
    return this.update(id, { question: e.question, answer: e.answer, aliases: [...e.aliases, wording], category: e.category, requiresConfirmation: e.requiresConfirmation });
  }

  match(question: string): MatchResult {
    return matchQuestion(question, this.effectiveEntries());
  }

  /**
   * Optional AI suggestion when the deterministic matcher finds nothing: the model may only point to an EXISTING
   * entry, and the result always requires your confirmation.
   */
  async suggestWithLlm(question: string, fieldType: string, options: string[]): Promise<MatchResult> {
    const provider = getLlmProvider();
    if (!provider.isConfigured()) throw new AppError('ANTHROPIC_API_KEY is not configured', 400, 'LLM_NOT_CONFIGURED');
    const entries = this.effectiveEntries().filter((e) => e.answer);
    const bank = entries.map((e) => `#${e.id}: ${e.question} → ${e.answer}`).join('\n');
    const schema = z.object({ entry_id: z.number().nullable(), reason: z.string() });
    const { data } = await provider.completeStructured(
      { prompt: renderPrompt(loadPrompt('application-question'), { question, field_type: fieldType, options: options.join(' | ') || '(free text)', answer_bank: bank || '(empty)' }) },
      schema,
      llmConfigFromSettings(new SettingsService(this.db).get().llm),
    );
    const entry = entries.find((e) => e.id === data.entry_id);
    if (!entry) return { status: 'unknown', similarity: 0, reason: `AI: ${data.reason}` };
    return { status: 'needs_confirmation', entry, answer: entry.answer!, similarity: 0, reason: `AI suggestion (please confirm): ${data.reason}` };
  }
}
