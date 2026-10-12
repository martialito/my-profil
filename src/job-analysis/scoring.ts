/**
 * Final score = deterministic formula over sub-scores, then hard caps.
 * The LLM only provides sub-scores and evidence; dates, location and the internship rule are computed in code,
 * and every LLM claim that can be checked against the source texts is checked.
 */
import { normalize } from '../cv/truth-guard.js';
import type { LocationMatch } from '../models/job.js';
import type { MasterCvContent } from '../models/master-cv.js';
import { classifyScore, type MatchCategory, type Settings } from '../models/settings.js';
import { isDateCompatible, type Availability, type DateCompatibility, type DateInput } from './dates.js';
import type { LlmJobAnalysis } from './schema.js';

export const WEIGHTS = { skills: 0.3, experience: 0.2, education: 0.1, location: 0.15, dates: 0.15, preferences: 0.1 } as const;
export const LOCATION_SCORES: Record<LocationMatch, number> = { nyc: 100, near: 80, remote: 70, none: 0 };
/** Weight given to an UNKNOWN date in the formula (neither a bonus nor a penalty). */
export const UNKNOWN_DATE_SCORE = 50;

export interface Cap {
  max: number;
  reason: string;
}

export interface ScoringInput {
  llm: LlmJobAnalysis;
  job: DateInput & { description?: string | null };
  date: DateCompatibility;
  availability: Availability;
  locationMatch: LocationMatch;
  isInternship: boolean;
  master: MasterCvContent;
  requiresSponsorship?: 'yes' | 'no';
  classification: Settings['classification'];
}

export interface ScoreResult {
  overall: number;
  category: MatchCategory;
  date: DateCompatibility;
  dimensions: { skills: number; experience: number; education: number; location: number; dates: number | null; preferences: number };
  matchedSkills: string[];
  missingSkills: string[];
  missingRequirements: string[];
  reasons: string[];
  redFlags: string[];
  caps: Cap[];
  notes: string[];
  rawFormulaScore: number;
}

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(Number.isFinite(n) ? n : 0)));
const squash = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

/** True when `quote` appears (case/whitespace-insensitive) in `source`. */
export function appearsIn(quote: string | null | undefined, source: string): boolean {
  if (!quote) return false;
  const q = squash(quote).replace(/^["'“]|["'”]$/g, '');
  return q.length >= 3 && squash(source).includes(q);
}

function masterText(master: MasterCvContent): string {
  return JSON.stringify({ s: master.summary, h: master.headline, e: master.experiences, ed: master.education, sk: master.skills });
}

/** Keep only matched skills backed by the Master CV (skill vocabulary or verbatim evidence). */
export function verifyMatchedSkills(llm: LlmJobAnalysis, master: MasterCvContent): { kept: string[]; removed: string[] } {
  const vocab = new Set<string>();
  master.skills.forEach((s) => vocab.add(normalize(s.name)));
  master.experiences.forEach((e) => [...e.skills, ...e.technologies].forEach((s) => vocab.add(normalize(s))));
  const text = masterText(master);
  const kept: string[] = [];
  const removed: string[] = [];
  for (const m of llm.matched_skills) {
    const ok = vocab.has(normalize(m.skill)) || appearsIn(m.skill, text) || appearsIn(m.evidence, text);
    (ok ? kept : removed).push(m.skill);
  }
  return { kept: [...new Set(kept)], removed };
}

/** Cross-check the period the LLM read in the offer against the deterministic date analysis. */
export function reconcileDates(det: DateCompatibility, llm: LlmJobAnalysis, job: ScoringInput['job'], availability: Availability): { date: DateCompatibility; notes: string[] } {
  const sp = llm.stated_period;
  const notes: string[] = [];
  if (!sp.start && !sp.end && !sp.duration_months) return { date: det, notes };
  const source = `${job.title ?? ''}\n${job.description ?? ''}`;
  if (!appearsIn(sp.evidence, source)) {
    notes.push('The period reported by the AI was ignored: its quote was not found in the offer.');
    return { date: det, notes };
  }
  const fromLlm = isDateCompatible(
    { startDate: sp.start, endDate: sp.end, internshipDuration: sp.duration_months ? `${sp.duration_months} months` : null },
    availability,
  );
  if (det.status === 'UNKNOWN' && fromLlm.status !== 'UNKNOWN') {
    notes.push(`Dates read by the AI from: "${sp.evidence}".`);
    // AI-read dates are never considered safe enough for auto-submission.
    return { date: { ...fromLlm, autoSubmitSafe: false, reasons: [...fromLlm.reasons, `Source: "${sp.evidence}" (read by AI).`] }, notes };
  }
  if (det.status !== 'UNKNOWN' && fromLlm.status !== 'UNKNOWN' && fromLlm.status !== det.status) {
    return {
      date: { ...det, status: 'UNKNOWN', score: null, autoSubmitSafe: false, reasons: [...det.reasons, `Conflicting date signals: the AI read "${sp.evidence}" (${fromLlm.status}).`] },
      notes,
    };
  }
  return { date: det, notes };
}

export function computeScore(input: ScoringInput): ScoreResult {
  const { llm, locationMatch, master } = input;
  const notes: string[] = [];
  const caps: Cap[] = [];
  const redFlags = [...llm.red_flags];

  const { date, notes: dateNotes } = reconcileDates(input.date, llm, input.job, input.availability);
  notes.push(...dateNotes);

  const { kept, removed } = verifyMatchedSkills(llm, master);
  let skills = clamp(llm.skills_match);
  if (removed.length) {
    notes.push(`Ignored skill matches not supported by your Master CV: ${removed.join(', ')}.`);
    const missing = new Set([...llm.missing_skills, ...removed]).size;
    skills = Math.min(skills, clamp((100 * kept.length) / Math.max(1, kept.length + missing)));
  }

  const dimensions = {
    skills,
    experience: clamp(llm.experience_match),
    education: clamp(llm.education_match),
    location: LOCATION_SCORES[locationMatch],
    dates: date.score,
    preferences: clamp(llm.preferences_match),
  };
  const rawFormulaScore = clamp(
    WEIGHTS.skills * dimensions.skills +
      WEIGHTS.experience * dimensions.experience +
      WEIGHTS.education * dimensions.education +
      WEIGHTS.location * dimensions.location +
      WEIGHTS.dates * (dimensions.dates ?? UNKNOWN_DATE_SCORE) +
      WEIGHTS.preferences * dimensions.preferences,
  );

  // ── Hard caps ──
  const notInternship = !input.isInternship || llm.employment_type === 'full_time' || llm.seniority === 'experienced';
  if (notInternship) {
    caps.push({ max: 30, reason: 'Not an internship (internship-only rule).' });
    redFlags.push('Not an internship position.');
  }
  if (date.status === 'INCOMPATIBLE') caps.push({ max: 40, reason: `Dates incompatible: ${date.reasons.at(-1)}` });
  if (locationMatch === 'none') caps.push({ max: 40, reason: 'Location is not in or near New York City.' });

  const sp = llm.sponsorship;
  const restrictive = sp.statement === 'no_sponsorship' || sp.statement === 'us_authorization_required';
  if (restrictive && input.requiresSponsorship === 'yes') {
    if (appearsIn(sp.evidence, input.job.description ?? '')) {
      caps.push({ max: 40, reason: `Sponsorship conflict: the offer says "${sp.evidence}" and you need sponsorship.` });
      redFlags.push('The offer does not provide visa sponsorship.');
    } else {
      notes.push('The AI reported a sponsorship restriction but its quote was not found in the offer: please check manually.');
    }
  } else if (restrictive && !input.requiresSponsorship) {
    notes.push(`The offer mentions work authorization ("${sp.evidence ?? sp.statement}"). Fill in your work authorization in My Profile.`);
  }

  const cap = Math.min(100, ...caps.map((c) => c.max));
  const overall = Math.min(rawFormulaScore, cap);

  let category = classifyScore(overall, input.classification);
  if (category === 'GREEN' && date.status !== 'COMPATIBLE') {
    category = 'YELLOW';
    notes.push('Kept YELLOW instead of GREEN: the internship dates are not confirmed as compatible.');
  }

  return {
    overall,
    category,
    date,
    dimensions,
    matchedSkills: kept,
    missingSkills: [...new Set([...llm.missing_skills])],
    missingRequirements: llm.missing_requirements,
    reasons: llm.reasons,
    redFlags: [...new Set(redFlags)],
    caps,
    notes,
    rawFormulaScore,
  };
}
