import { z } from 'zod';
import type { Education, Experience, PersonalInfo, Skill } from '../models/profile.js';

/**
 * Draft produced from an imported CV. It is NEVER saved to the profile automatically:
 * the candidate reviews/edits it in the UI and then saves the profile explicitly.
 * Work authorization and preferences are deliberately not extracted.
 */
export interface CvExtractionDraft {
  personal: PersonalInfo;
  headline?: string;
  summary?: string;
  education: Education[];
  experiences: Experience[];
  skills: Skill[];
  warnings: string[];
}

/** Plain schema for LLM structured output (no transforms, JSON-schema friendly). */
export const LlmCvExtractionSchema = z.object({
  personal: z.object({
    firstName: z.string().nullable(),
    lastName: z.string().nullable(),
    email: z.string().nullable(),
    phone: z.string().nullable(),
    currentLocation: z.string().nullable(),
    linkedin: z.string().nullable(),
    portfolio: z.string().nullable(),
    website: z.string().nullable(),
  }),
  headline: z.string().nullable(),
  summary: z.string().nullable(),
  education: z.array(
    z.object({
      school: z.string(),
      degree: z.string().nullable(),
      field: z.string().nullable(),
      startDate: z.string().nullable(),
      endDate: z.string().nullable(),
      gpa: z.string().nullable(),
      description: z.string().nullable(),
    }),
  ),
  experiences: z.array(
    z.object({
      company: z.string(),
      title: z.string(),
      location: z.string().nullable(),
      startDate: z.string().nullable(),
      endDate: z.string().nullable(),
      isCurrent: z.boolean(),
      description: z.string().nullable(),
      achievements: z.array(z.string()),
      technologies: z.array(z.string()),
      skills: z.array(z.string()),
    }),
  ),
  skills: z.array(
    z.object({
      category: z.enum(['technical', 'language', 'soft', 'certification']),
      name: z.string(),
      level: z.string().nullable(),
    }),
  ),
  uncertainFields: z.array(z.string()),
});
export type LlmCvExtraction = z.infer<typeof LlmCvExtractionSchema>;
