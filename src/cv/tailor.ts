/**
 * Tailored CV = selection + rephrasing of Master CV facts.
 *
 * The LLM never writes a company, title, date, school, degree or GPA: it references Master CV entries by index,
 * and the code copies those facts verbatim. It may only write the headline, the summary and rephrased bullets,
 * and pick skills, which are then checked against the Master CV by the truth guard.
 */
import { z } from 'zod';
import type { MasterCvContent } from '../models/master-cv.js';
import { normalize, verifyAgainstMaster, type TruthViolation } from './truth-guard.js';

export const LlmTailoredCvSchema = z.object({
  headline: z.string(),
  summary: z.string(),
  experiences: z.array(
    z.object({
      index: z.number(),
      bullets: z.array(z.object({ text: z.string(), source: z.string() })),
    }),
  ),
  education: z.array(z.object({ index: z.number() })),
  skills: z.array(z.string()),
  changes: z.array(z.string()),
});
export type LlmTailoredCv = z.infer<typeof LlmTailoredCvSchema>;

export interface TailorResult {
  content: MasterCvContent;
  /** Violations found in the LLM proposal and automatically repaired. */
  repaired: TruthViolation[];
  /** Must be empty for the CV to be usable. */
  violations: TruthViolation[];
  warnings: string[];
  changes: string[];
}

const numbersIn = (t: string) => (t.match(/\d+(?:[.,]\d+)?\s*%?/g) ?? []).map((n) => n.replace(/\s+/g, '').replace(',', '.'));

/** Assemble the CV from the LLM plan, copying every factual field from the Master CV. */
export function assembleTailoredCv(master: MasterCvContent, plan: LlmTailoredCv): { content: MasterCvContent; warnings: string[] } {
  const warnings: string[] = [];
  const seen = new Set<number>();
  const experiences = plan.experiences.flatMap((p) => {
    const src = master.experiences[p.index];
    if (!src || seen.has(p.index)) {
      warnings.push(`Ignored unknown or repeated experience reference #${p.index}.`);
      return [];
    }
    seen.add(p.index);
    return [{ ...src, achievements: p.bullets.map((b) => b.text.trim()).filter(Boolean) }];
  });
  const seenEdu = new Set<number>();
  const education = plan.education.flatMap((p) => {
    const src = master.education[p.index];
    if (!src || seenEdu.has(p.index)) return [];
    seenEdu.add(p.index);
    return [src];
  });
  // Skills keep the Master CV category/level when the name matches.
  const skills = [...new Set(plan.skills.map((s) => s.trim()).filter(Boolean))].map((name) => {
    const m = master.skills.find((s) => normalize(s.name) === normalize(name));
    return m ? { ...m } : { category: 'technical' as const, name, level: undefined };
  });
  // Languages are always relevant for an international candidate: keep them even if not selected.
  for (const lang of master.skills.filter((s) => s.category === 'language')) {
    if (!skills.some((s) => normalize(s.name) === normalize(lang.name))) skills.push({ ...lang });
  }
  return {
    content: {
      personal: master.personal,
      workAuthorization: master.workAuthorization,
      headline: plan.headline.trim() || master.headline,
      summary: plan.summary.trim() || master.summary,
      experiences,
      education,
      skills,
    },
    warnings,
  };
}

/**
 * Repair what the truth guard rejects instead of shipping it:
 * unknown skills are removed, bullets with invented figures fall back to the original Master CV bullets,
 * a summary/headline with invented figures falls back to the Master CV one.
 */
export function enforceTruth(master: MasterCvContent, content: MasterCvContent): { content: MasterCvContent; repaired: TruthViolation[]; violations: TruthViolation[] } {
  const repaired = verifyAgainstMaster(master, content);
  if (repaired.length === 0) return { content, repaired, violations: [] };

  const fixed = structuredClone(content);
  const known = new Set(numbersIn(JSON.stringify(master)));
  const invented = (t?: string) => !!t && numbersIn(t).some((n) => !known.has(n));

  const unknownSkills = new Set(repaired.filter((v) => v.type === 'UNKNOWN_SKILL').map((v) => v.message.match(/"(.+?)"/)?.[1]));
  fixed.skills = fixed.skills.filter((s) => !unknownSkills.has(normalize(s.name)));
  fixed.experiences = fixed.experiences.map((e) => {
    const original = master.experiences.find((m) => normalize(m.company) === normalize(e.company) && normalize(m.title) === normalize(e.title));
    const bulletsBad = e.achievements.some(invented);
    return {
      ...e,
      skills: e.skills.filter((s) => !unknownSkills.has(normalize(s))),
      technologies: e.technologies.filter((s) => !unknownSkills.has(normalize(s))),
      achievements: bulletsBad && original ? original.achievements : e.achievements,
      description: invented(e.description) ? original?.description : e.description,
    };
  });
  if (invented(fixed.summary)) fixed.summary = master.summary;
  if (invented(fixed.headline)) fixed.headline = master.headline;
  return { content: fixed, repaired, violations: verifyAgainstMaster(master, fixed) };
}

/** Flags keyword stuffing: a job keyword repeated too often in the CV text. */
export function keywordStuffing(content: MasterCvContent, keywords: string[], maxRepeats = 4): string[] {
  const text = ` ${normalize([content.headline, content.summary, ...content.experiences.flatMap((e) => e.achievements)].join(' '))} `;
  return [...new Set(keywords.map(normalize).filter((k) => k.length > 2))]
    .map((k) => ({ k, n: text.match(new RegExp(`(?<= )${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?= )`, 'g'))?.length ?? 0 }))
    .filter((x) => x.n > maxRepeats)
    .map((x) => `"${x.k}" appears ${x.n} times — looks like keyword stuffing.`);
}

export function tailor(master: MasterCvContent, plan: LlmTailoredCv, jobKeywords: string[] = []): TailorResult {
  const { content, warnings } = assembleTailoredCv(master, plan);
  if (content.experiences.length === 0 && master.experiences.length > 0) warnings.push('No experience selected — the CV may look empty.');
  const { content: safe, repaired, violations } = enforceTruth(master, content);
  warnings.push(...keywordStuffing(safe, jobKeywords));
  return { content: safe, repaired, violations, warnings, changes: plan.changes };
}
