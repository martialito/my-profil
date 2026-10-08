import type { MasterCvContent } from '../models/master-cv.js';

/**
 * Verifies that a derived CV (tailored resume) only uses facts present in the Master CV.
 * Allowed: rephrasing, reordering, shortening, selecting, changing the summary.
 * Forbidden: new companies/titles/degrees/schools/skills, altered dates, altered work authorization.
 *
 * Text fields (descriptions, achievements) are rephrasable and can't be verified mechanically;
 * numbers appearing in them must, however, already exist in the master (no invented results).
 */
export type ViolationType =
  | 'UNKNOWN_EXPERIENCE'
  | 'ALTERED_DATES'
  | 'UNKNOWN_EDUCATION'
  | 'UNKNOWN_SKILL'
  | 'ALTERED_WORK_AUTHORIZATION'
  | 'ALTERED_IDENTITY'
  | 'INVENTED_NUMBER';

export interface TruthViolation {
  type: ViolationType;
  message: string;
}

export const normalize = (s: string | undefined): string =>
  (s ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9+#.]+/g, ' ')
    .trim();

function masterSkillVocabulary(master: MasterCvContent): Set<string> {
  const vocab = new Set<string>();
  master.skills.forEach((s) => vocab.add(normalize(s.name)));
  master.experiences.forEach((e) => [...e.skills, ...e.technologies].forEach((s) => vocab.add(normalize(s))));
  return vocab;
}

function numbersIn(text: string): string[] {
  return (text.match(/\d+(?:[.,]\d+)?\s*%?/g) ?? []).map((n) => n.replace(/\s+/g, '').replace(',', '.'));
}

function masterNumbers(master: MasterCvContent): Set<string> {
  const corpus = [
    master.summary,
    master.headline,
    ...master.experiences.flatMap((e) => [e.description, ...e.achievements, e.startDate, e.endDate]),
    ...master.education.flatMap((e) => [e.description, e.gpa, e.startDate, e.endDate]),
  ]
    .filter(Boolean)
    .join(' ');
  return new Set(numbersIn(corpus));
}

export function verifyAgainstMaster(master: MasterCvContent, derived: MasterCvContent): TruthViolation[] {
  const violations: TruthViolation[] = [];

  // Identity
  for (const key of ['firstName', 'lastName', 'email'] as const) {
    if (derived.personal[key] && normalize(derived.personal[key]) !== normalize(master.personal[key])) {
      violations.push({ type: 'ALTERED_IDENTITY', message: `Personal field "${key}" differs from the Master CV` });
    }
  }

  // Experiences: each must match a master experience (company + title) with identical dates.
  for (const exp of derived.experiences) {
    const match = master.experiences.find(
      (m) => normalize(m.company) === normalize(exp.company) && normalize(m.title) === normalize(exp.title),
    );
    if (!match) {
      violations.push({
        type: 'UNKNOWN_EXPERIENCE',
        message: `Experience "${exp.title}" at "${exp.company}" does not exist in the Master CV`,
      });
      continue;
    }
    if ((exp.startDate ?? '') !== (match.startDate ?? '') || (exp.endDate ?? '') !== (match.endDate ?? '') || exp.isCurrent !== match.isCurrent) {
      violations.push({ type: 'ALTERED_DATES', message: `Dates for "${exp.title}" at "${exp.company}" were modified` });
    }
  }

  // Education
  for (const edu of derived.education) {
    const match = master.education.find(
      (m) => normalize(m.school) === normalize(edu.school) && normalize(m.degree) === normalize(edu.degree),
    );
    if (!match) {
      violations.push({
        type: 'UNKNOWN_EDUCATION',
        message: `Education "${edu.degree ?? ''}" at "${edu.school}" does not exist in the Master CV`,
      });
      continue;
    }
    if ((edu.startDate ?? '') !== (match.startDate ?? '') || (edu.endDate ?? '') !== (match.endDate ?? '')) {
      violations.push({ type: 'ALTERED_DATES', message: `Dates for education at "${edu.school}" were modified` });
    }
    if (edu.gpa && normalize(edu.gpa) !== normalize(match.gpa)) {
      violations.push({ type: 'ALTERED_DATES', message: `GPA for "${edu.school}" differs from the Master CV` });
    }
  }

  // Skills (including skills listed under experiences)
  const vocab = masterSkillVocabulary(master);
  const derivedSkills = [
    ...derived.skills.map((s) => s.name),
    ...derived.experiences.flatMap((e) => [...e.skills, ...e.technologies]),
  ];
  for (const s of new Set(derivedSkills.map(normalize))) {
    if (s && !vocab.has(s)) {
      violations.push({ type: 'UNKNOWN_SKILL', message: `Skill "${s}" is not present in the Master CV` });
    }
  }

  // Work authorization must be identical
  if (JSON.stringify(derived.workAuthorization ?? {}) !== JSON.stringify(master.workAuthorization ?? {})) {
    violations.push({ type: 'ALTERED_WORK_AUTHORIZATION', message: 'Work authorization differs from the Master CV' });
  }

  // Numbers (results/metrics) must already exist in the master
  const known = masterNumbers(master);
  const derivedText = [
    derived.summary,
    derived.headline,
    ...derived.experiences.flatMap((e) => [e.description, ...e.achievements]),
  ]
    .filter(Boolean)
    .join(' ');
  for (const n of new Set(numbersIn(derivedText))) {
    if (!known.has(n)) {
      violations.push({ type: 'INVENTED_NUMBER', message: `Figure "${n}" does not appear anywhere in the Master CV` });
    }
  }

  return violations;
}
