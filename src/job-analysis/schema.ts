import { z } from 'zod';

/** Structured output requested from the LLM (plain JSON-schema friendly types only). */
export const LlmJobAnalysisSchema = z.object({
  seniority: z.enum(['internship', 'entry_level', 'experienced', 'unclear']),
  employment_type: z.enum(['internship', 'full_time', 'part_time', 'contract', 'unclear']),
  skills_required: z.array(z.string()),
  skills_preferred: z.array(z.string()),
  matched_skills: z.array(z.object({ skill: z.string(), evidence: z.string() })),
  missing_skills: z.array(z.string()),
  missing_requirements: z.array(z.string()),
  skills_match: z.number(),
  experience_match: z.number(),
  education_match: z.number(),
  preferences_match: z.number(),
  stated_period: z.object({
    start: z.string().nullable(),
    end: z.string().nullable(),
    duration_months: z.number().nullable(),
    evidence: z.string().nullable(),
  }),
  sponsorship: z.object({
    statement: z.enum(['no_sponsorship', 'sponsorship_available', 'us_authorization_required', 'not_stated']),
    evidence: z.string().nullable(),
  }),
  reasons: z.array(z.string()),
  red_flags: z.array(z.string()),
});
export type LlmJobAnalysis = z.infer<typeof LlmJobAnalysisSchema>;
