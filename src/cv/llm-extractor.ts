import { getLlmProvider, llmConfigFromSettings, loadPrompt, renderPrompt } from '../llm/index.js';
import { CandidateProfileSchema } from '../models/profile.js';
import type { Settings } from '../models/settings.js';
import { LlmCvExtractionSchema, type CvExtractionDraft, type LlmCvExtraction } from './extraction-types.js';

const SYSTEM =
  'You extract facts from CVs with perfect fidelity. You never invent or embellish information. When unsure, you leave fields empty and flag them.';

export async function extractProfileWithLlm(cvText: string, llmSettings: Settings['llm']): Promise<CvExtractionDraft> {
  const prompt = renderPrompt(loadPrompt('cv-extraction'), { cv_text: cvText });
  const { data } = await getLlmProvider().completeStructured(
    { system: SYSTEM, prompt },
    LlmCvExtractionSchema,
    llmConfigFromSettings(llmSettings),
  );
  return normalizeLlmExtraction(data, cvText);
}

const n = (v: string | null | undefined) => (v && v.trim() ? v.trim() : undefined);

/**
 * Convert the LLM output to the profile shape and run fidelity checks against the source text:
 * an extracted company/school/email that does not literally appear in the CV is flagged.
 */
export function normalizeLlmExtraction(data: LlmCvExtraction, sourceText: string): CvExtractionDraft {
  const warnings: string[] = data.uncertainFields.map((f) => `Uncertain: ${f}`);
  const haystack = sourceText.toLowerCase().replace(/\s+/g, ' ');
  const appears = (s: string | undefined) => !s || haystack.includes(s.toLowerCase().replace(/\s+/g, ' '));
  const date = (d: string | null, label: string) => {
    const v = n(d);
    if (v && !/^\d{4}(-(0[1-9]|1[0-2]))?$/.test(v)) {
      warnings.push(`${label}: unreadable date "${v}" was dropped — please enter it manually.`);
      return undefined;
    }
    return v;
  };

  const draft: CvExtractionDraft = {
    personal: {
      firstName: n(data.personal.firstName),
      lastName: n(data.personal.lastName),
      email: n(data.personal.email),
      phone: n(data.personal.phone),
      currentLocation: n(data.personal.currentLocation),
      linkedin: n(data.personal.linkedin),
      portfolio: n(data.personal.portfolio),
      website: n(data.personal.website),
    },
    headline: n(data.headline),
    summary: n(data.summary),
    education: data.education.map((e, i) => ({
      school: e.school.trim(),
      degree: n(e.degree),
      field: n(e.field),
      startDate: date(e.startDate, `education[${i}].startDate`),
      endDate: date(e.endDate, `education[${i}].endDate`),
      gpa: n(e.gpa),
      description: n(e.description),
    })),
    experiences: data.experiences.map((e, i) => ({
      company: e.company.trim(),
      title: e.title.trim(),
      location: n(e.location),
      startDate: date(e.startDate, `experiences[${i}].startDate`),
      endDate: date(e.endDate, `experiences[${i}].endDate`),
      isCurrent: e.isCurrent,
      description: n(e.description),
      achievements: e.achievements.map((a) => a.trim()).filter(Boolean),
      technologies: e.technologies.map((a) => a.trim()).filter(Boolean),
      skills: e.skills.map((a) => a.trim()).filter(Boolean),
    })),
    skills: data.skills.map((s) => ({ category: s.category, name: s.name.trim(), level: n(s.level) })),
    warnings,
  };

  if (!appears(draft.personal.email)) warnings.push(`Email "${draft.personal.email}" not found verbatim in the CV.`);
  draft.experiences.forEach((e) => {
    if (!appears(e.company)) warnings.push(`Company "${e.company}" not found verbatim in the CV — verify.`);
  });
  draft.education.forEach((e) => {
    if (!appears(e.school)) warnings.push(`School "${e.school}" not found verbatim in the CV — verify.`);
  });
  draft.skills.forEach((s) => {
    if (!appears(s.name)) warnings.push(`Skill "${s.name}" not found verbatim in the CV — verify.`);
  });

  // Drop invalid emails rather than fail the whole draft.
  const check = CandidateProfileSchema.shape.personal.safeParse(draft.personal);
  if (!check.success && draft.personal.email) {
    warnings.push(`Invalid email "${draft.personal.email}" dropped.`);
    draft.personal.email = undefined;
  }
  warnings.push('Review every field before saving: the extraction is a draft.');
  return draft;
}
