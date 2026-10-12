import type { NormalizedJob } from '../../models/job.js';
import { extractDuration, extractPeriodHints, extractSalary, extractStartEnd } from '../extract.js';
import { extractSections } from '../text.js';

type Base = Omit<NormalizedJob, 'requirements' | 'responsibilities' | 'skills' | 'periodHints' | 'internshipDuration' | 'startDate' | 'endDate'> &
  Partial<Pick<NormalizedJob, 'requirements' | 'responsibilities' | 'internshipDuration' | 'startDate' | 'endDate'>>;

/** Fill derived fields from the plain-text description (only literal matches, nothing inferred). */
export function enrich(base: Base): NormalizedJob {
  const text = [base.title, base.description ?? ''].join('\n');
  const sections = base.description ? extractSections(base.description) : { requirements: [], responsibilities: [] };
  const se = extractStartEnd(text);
  return {
    ...base,
    salary: base.salary ?? extractSalary(base.description ?? ''),
    requirements: base.requirements?.length ? base.requirements : sections.requirements,
    responsibilities: base.responsibilities?.length ? base.responsibilities : sections.responsibilities,
    skills: [], // extracted by the LLM analysis in Phase 3
    internshipDuration: base.internshipDuration ?? extractDuration(text),
    startDate: base.startDate ?? se.startDate,
    endDate: base.endDate ?? se.endDate,
    periodHints: extractPeriodHints(text),
  };
}
