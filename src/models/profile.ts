import { z } from 'zod';
import { OptionalPartialDate, OptionalText, StringList, WorkMode } from './common.js';

export const PersonalInfoSchema = z.object({
  firstName: OptionalText,
  lastName: OptionalText,
  email: z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), z.email().optional()),
  phone: OptionalText,
  currentLocation: OptionalText,
  linkedin: OptionalText,
  portfolio: OptionalText,
  website: OptionalText,
});
export type PersonalInfo = z.infer<typeof PersonalInfoSchema>;

export const EducationSchema = z.object({
  id: z.number().int().optional(),
  school: z.string().trim().min(1, 'School is required'),
  degree: OptionalText,
  field: OptionalText,
  startDate: OptionalPartialDate,
  endDate: OptionalPartialDate,
  gpa: OptionalText,
  description: OptionalText,
});
export type Education = z.infer<typeof EducationSchema>;

export const ExperienceSchema = z.object({
  id: z.number().int().optional(),
  company: z.string().trim().min(1, 'Company is required'),
  title: z.string().trim().min(1, 'Title is required'),
  location: OptionalText,
  startDate: OptionalPartialDate,
  endDate: OptionalPartialDate,
  isCurrent: z.boolean().default(false),
  description: OptionalText,
  achievements: StringList,
  technologies: StringList,
  skills: StringList,
});
export type Experience = z.infer<typeof ExperienceSchema>;

export const SkillCategories = ['technical', 'language', 'soft', 'certification'] as const;
export const SkillCategory = z.enum(SkillCategories);
export type SkillCategory = z.infer<typeof SkillCategory>;

export const SkillSchema = z.object({
  id: z.number().int().optional(),
  category: SkillCategory,
  name: z.string().trim().min(1),
  level: OptionalText,
});
export type Skill = z.infer<typeof SkillSchema>;

export const PreferencesSchema = z.object({
  preferredIndustries: StringList,
  preferredJobTitles: StringList,
  preferredCompanies: StringList,
  preferredLocations: StringList,
  workModes: z.array(WorkMode).default(['on-site', 'hybrid']),
  minimumScore: z.number().int().min(0).max(100).default(75),
  minimumDurationMonths: z.number().int().min(0).max(24).default(0),
});
export type Preferences = z.infer<typeof PreferencesSchema>;

/**
 * Work authorization is NEVER guessed: it stays undefined until the candidate fills it in.
 * The application engine must refuse to auto-answer related questions while it is undefined.
 */
export const WorkAuthorizationSchema = z.object({
  authorizedToWorkInUS: z.enum(['yes', 'no']).optional(),
  requiresSponsorship: z.enum(['yes', 'no']).optional(),
  visaStatus: OptionalText,
  notes: OptionalText,
});
export type WorkAuthorization = z.infer<typeof WorkAuthorizationSchema>;

export const CandidateProfileSchema = z.object({
  personal: PersonalInfoSchema.prefault({}),
  headline: OptionalText,
  summary: OptionalText,
  workAuthorization: WorkAuthorizationSchema.prefault({}),
  education: z.array(EducationSchema).default([]),
  experiences: z.array(ExperienceSchema).default([]),
  skills: z.array(SkillSchema).default([]),
  preferences: PreferencesSchema.prefault({}),
});
export type CandidateProfile = z.infer<typeof CandidateProfileSchema>;
export type CandidateProfileInput = z.input<typeof CandidateProfileSchema>;

export function emptyProfile(): CandidateProfile {
  return CandidateProfileSchema.parse({});
}

/** Rough completeness indicator shown on the dashboard. */
export function profileCompleteness(p: CandidateProfile): { score: number; missing: string[] } {
  const checks: Array<[string, boolean]> = [
    ['First name', !!p.personal.firstName],
    ['Last name', !!p.personal.lastName],
    ['Email', !!p.personal.email],
    ['Phone', !!p.personal.phone],
    ['Current location', !!p.personal.currentLocation],
    ['Education', p.education.length > 0],
    ['Experience', p.experiences.length > 0],
    ['Skills', p.skills.length > 0],
    ['Work authorization (US)', !!p.workAuthorization.authorizedToWorkInUS],
    ['Sponsorship answer', !!p.workAuthorization.requiresSponsorship],
    ['Preferred job titles', p.preferences.preferredJobTitles.length > 0],
  ];
  const missing = checks.filter(([, ok]) => !ok).map(([label]) => label);
  return { score: Math.round(((checks.length - missing.length) / checks.length) * 100), missing };
}
