import { z } from 'zod';
import { ApplicationMode, PartialDate, StringList } from './common.js';

const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM (24h)');

export const SearchSettingsSchema = z.object({
  locations: StringList.default(['New York City', 'New York, NY', 'Manhattan', 'Brooklyn', 'Queens']),
  availabilityStart: PartialDate.default('2027-03-01'),
  availabilityEnd: PartialDate.default('2027-08-31'),
  minimumDurationMonths: z.number().int().min(0).max(24).default(0),
  idealDurationMonths: z.number().int().min(0).max(24).default(6),
  industries: StringList,
  jobTitles: StringList,
  minimumScore: z.number().int().min(0).max(100).default(75),
  /** Internship-only rule (section 36). Only the user can turn this off. */
  internshipOnly: z.boolean().default(true),
});

export const ClassificationSettingsSchema = z
  .object({
    greenMin: z.number().int().min(0).max(100).default(90),
    yellowMin: z.number().int().min(0).max(100).default(75),
  })
  .refine((v) => v.greenMin > v.yellowMin, { message: 'greenMin must be greater than yellowMin' });

export const AutomationSettingsSchema = z.object({
  applicationMode: ApplicationMode.default('SEMI_AUTO'),
  /** Only GREEN jobs at or above this score may ever be auto-submitted. */
  autoSubmitThreshold: z.number().int().min(0).max(100).default(90),
  dailySearchTime: HHMM.default('08:00'),
  dailyAutomationEnabled: z.boolean().default(false),
  maxApplicationsPerDay: z.number().int().min(0).max(200).default(20),
  followUpDays: z.number().int().min(1).max(60).default(7),
  /** Safety switch: no real submission while true. Also forced on by TEST_MODE env. */
  testMode: z.boolean().default(true),
});

export const LlmSettingsSchema = z.object({
  provider: z.enum(['anthropic']).default('anthropic'),
  model: z.string().min(1).default('claude-opus-5-5'),
  /** Ignored for models that do not accept sampling parameters (e.g. Opus 5.x). */
  temperature: z.number().min(0).max(1).nullable().default(null),
  maxTokens: z.number().int().min(256).max(64000).default(8000),
  effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).default('medium'),
  /** Server-side refusal fallback (Anthropic beta). */
  refusalFallback: z.boolean().default(true),
});

export const NotificationSettingsSchema = z.object({
  dashboard: z.literal(true).default(true),
  email: z.boolean().default(false),
  telegram: z.boolean().default(false),
  discord: z.boolean().default(false),
});

export const SettingsSchema = z.object({
  search: SearchSettingsSchema.prefault({}),
  classification: ClassificationSettingsSchema.prefault({}),
  automation: AutomationSettingsSchema.prefault({}),
  llm: LlmSettingsSchema.prefault({}),
  notifications: NotificationSettingsSchema.prefault({}),
});

export type Settings = z.infer<typeof SettingsSchema>;
export type SettingsSection = keyof Settings;
export const SETTINGS_SECTIONS = Object.keys(SettingsSchema.shape) as SettingsSection[];

export const SettingsSectionSchemas = {
  search: SearchSettingsSchema,
  classification: ClassificationSettingsSchema,
  automation: AutomationSettingsSchema,
  llm: LlmSettingsSchema,
  notifications: NotificationSettingsSchema,
} as const satisfies Record<SettingsSection, z.ZodType>;

export function defaultSettings(): Settings {
  return SettingsSchema.parse({});
}

export type MatchCategory = 'GREEN' | 'YELLOW' | 'RED';

export function classifyScore(score: number, c: Settings['classification']): MatchCategory {
  if (score >= c.greenMin) return 'GREEN';
  if (score >= c.yellowMin) return 'YELLOW';
  return 'RED';
}
