/**
 * Final check before any submission (sections 14 and 29). Pure function over facts gathered by the engine.
 * "fail" blocks, "warning" blocks automatic submission but leaves the decision to you, "pending" means the
 * application page has not been inspected yet.
 */
import { normalize } from '../cv/truth-guard.js';
import type { FillPlan } from './form-plan.js';

export type CheckStatus = 'ok' | 'warning' | 'fail' | 'pending';

export interface CheckItem {
  key: string;
  label: string;
  status: CheckStatus;
  detail: string;
}

export interface FinalCheckInput {
  job: { id: number; company: string; title: string; location: string | null; locationMatch: string | null };
  candidate: { firstName?: string; lastName?: string; email?: string };
  resume: null | { jobId: number | null; fileExists: boolean; personal: { firstName?: string; lastName?: string; email?: string }; violations: number; version: number };
  coverLetter: null | { jobId: number; fileExists: boolean; issues: string[]; inventedNumbers: string[]; unverifiedClaims: string[]; version: number };
  analysis: null | { dateStatus: string; dateAutoSafe: boolean; score: number; category: string };
  plan?: FillPlan;
  pageText?: string;
  contradictions: string[];
  dailyLimit: { submittedToday: number; max: number };
}

export interface FinalCheck {
  items: CheckItem[];
  /** No fail and no pending item. */
  ready: boolean;
  /** Ready and without any warning: the only state in which an automatic submission could ever be considered. */
  cleanForAutomation: boolean;
}

const has = (hay: string, needle: string) => normalize(hay).includes(normalize(needle));

function titleOnPage(page: string, title: string): boolean {
  if (has(page, title)) return true;
  const words = normalize(title).split(' ').filter((w) => w.length > 2);
  const p = ` ${normalize(page)} `;
  return words.length > 0 && words.filter((w) => p.includes(` ${w} `)).length / words.length >= 0.6;
}

export function finalCheck(i: FinalCheckInput): FinalCheck {
  const items: CheckItem[] = [];
  const add = (key: string, label: string, status: CheckStatus, detail: string) => items.push({ key, label, status, detail });

  if (i.pageText === undefined) {
    add('company', 'Correct company', 'pending', 'Application page not inspected yet.');
    add('job', 'Correct job', 'pending', 'Application page not inspected yet.');
  } else {
    add('company', 'Correct company', has(i.pageText, i.job.company) ? 'ok' : 'fail', has(i.pageText, i.job.company) ? `"${i.job.company}" appears on the application page.` : `"${i.job.company}" does not appear on the application page.`);
    const t = titleOnPage(i.pageText, i.job.title);
    add('job', 'Correct job', t ? 'ok' : 'fail', t ? `"${i.job.title}" appears on the page.` : `"${i.job.title}" was not found on the page.`);
  }

  const loc = i.job.locationMatch;
  add('location', 'Correct location', loc === 'nyc' ? 'ok' : loc === 'near' || loc === 'remote' ? 'warning' : 'fail', `${i.job.location ?? 'not stated'} (${loc ?? 'unknown'})`);

  if (!i.resume) add('cv', 'Correct CV', 'fail', 'No tailored CV for this offer.');
  else if (i.resume.jobId !== i.job.id) add('cv', 'Correct CV', 'fail', 'The CV was generated for another offer.');
  else if (!i.resume.fileExists) add('cv', 'Correct CV', 'fail', 'The CV file is missing on disk.');
  else add('cv', 'Correct CV', 'ok', `Tailored CV v${i.resume.version} for this offer.`);

  if (!i.coverLetter) add('letter', 'Correct cover letter', 'fail', 'No cover letter for this offer.');
  else if (i.coverLetter.jobId !== i.job.id) add('letter', 'Correct cover letter', 'fail', 'The letter was written for another offer.');
  else if (!i.coverLetter.fileExists) add('letter', 'Correct cover letter', 'fail', 'The letter file is missing on disk.');
  else if (i.coverLetter.issues.length) add('letter', 'Correct cover letter', 'warning', `Letter v${i.coverLetter.version} has points to review: ${i.coverLetter.issues.join(' ')}`);
  else add('letter', 'Correct cover letter', 'ok', `Cover letter v${i.coverLetter.version} for this offer.`);

  const sameCandidate =
    !!i.resume &&
    normalize(i.resume.personal.firstName) === normalize(i.candidate.firstName) &&
    normalize(i.resume.personal.lastName) === normalize(i.candidate.lastName) &&
    normalize(i.resume.personal.email) === normalize(i.candidate.email);
  add('candidate', 'Correct candidate', !i.resume ? 'fail' : sameCandidate ? 'ok' : 'fail', sameCandidate ? `${i.candidate.firstName} ${i.candidate.lastName}` : 'Name or e-mail on the CV differs from My Profile (create a new Master CV version and regenerate).');

  if (!i.analysis) add('dates', 'Correct dates', 'fail', 'Offer not analysed.');
  else if (i.analysis.dateStatus === 'COMPATIBLE') add('dates', 'Correct dates', i.analysis.dateAutoSafe ? 'ok' : 'warning', i.analysis.dateAutoSafe ? 'Dates compatible with your availability.' : 'Dates compatible but approximate (season or read by AI): confirm before applying.');
  else if (i.analysis.dateStatus === 'UNKNOWN') add('dates', 'Correct dates', 'warning', 'Internship dates are not stated clearly: confirm them with the employer.');
  else add('dates', 'Correct dates', 'fail', 'Internship dates are incompatible with your availability.');

  if (!i.plan) add('fields', 'No unanswered mandatory fields', 'pending', 'Form not inspected yet.');
  else if (i.plan.complete) add('fields', 'No unanswered mandatory fields', 'ok', `${i.plan.ready} field(s) filled from your data.`);
  else add('fields', 'No unanswered mandatory fields', 'fail', `${i.plan.needsInput.length} question(s) need your answer, ${i.plan.needsConfirmation.length} answer(s) need confirmation.`);

  const invented = (i.resume?.violations ?? 0) + (i.coverLetter?.inventedNumbers.length ?? 0) + (i.coverLetter?.unverifiedClaims.length ?? 0);
  add('truth', 'No invented information', !i.resume ? 'pending' : invented === 0 ? 'ok' : 'fail', invented === 0 ? 'CV passed the truth check; every claim of the letter is backed by your documents.' : 'Unverified claims or figures found: review the documents.');

  add('consistency', 'No contradictory answers', i.contradictions.length ? 'fail' : 'ok', i.contradictions.length ? i.contradictions.join(' ') : 'Answers are consistent with My Profile and Settings.');

  const left = i.dailyLimit.max - i.dailyLimit.submittedToday;
  add('limit', 'Daily application limit', left > 0 ? 'ok' : 'fail', `${i.dailyLimit.submittedToday}/${i.dailyLimit.max} submitted today.`);

  const ready = !items.some((x) => x.status === 'fail' || x.status === 'pending');
  return { items, ready, cleanForAutomation: ready && !items.some((x) => x.status === 'warning') };
}
