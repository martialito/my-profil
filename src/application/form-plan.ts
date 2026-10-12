/**
 * Build a filling plan for an application form. Pure logic: the browser layer detects fields and applies the plan.
 * Every value has a traceable source; anything without a trustworthy source is left for you to answer.
 */
import type { CandidateProfile } from '../models/profile.js';
import { fitToOptions, matchQuestion, type BankEntry, type MatchResult } from './answer-matching.js';

export type FieldType = 'text' | 'email' | 'tel' | 'url' | 'number' | 'date' | 'textarea' | 'select' | 'radio' | 'checkbox' | 'file';

export interface FormField {
  id: string;
  label: string;
  name?: string;
  type: FieldType;
  required: boolean;
  options: string[];
  autocomplete?: string;
}

export type PlanStatus = 'ready' | 'needs_input' | 'needs_confirmation' | 'skipped';
export type ValueSource = 'profile' | 'answer_bank' | 'resume' | 'cover_letter' | 'user' | 'none';

export interface PlanItem {
  field: FormField;
  status: PlanStatus;
  value?: string;
  source: ValueSource;
  reason: string;
  match?: Pick<MatchResult, 'status' | 'similarity'> & { entryId?: number; entryQuestion?: string };
}

export interface PlanContext {
  profile: CandidateProfile;
  bank: BankEntry[];
  resumePath?: string;
  coverLetterPath?: string;
  coverLetterText?: string;
  /** Answers you gave for this application (field id or exact label → value). */
  userAnswers?: Record<string, string>;
}

const norm = (s: string) => s.toLowerCase().replace(/[*:]/g, ' ').replace(/\s+/g, ' ').trim();

/** Profile fields recognised by label / name / autocomplete. Order matters (most specific first). */
const PROFILE_RULES: Array<{ re: RegExp; ac?: string; value: (p: CandidateProfile) => string | undefined; label: string }> = [
  { re: /\b(first|given) ?name\b|\bprenom\b/, ac: 'given-name', value: (p) => p.personal.firstName, label: 'First name' },
  { re: /\b(last|family|sur) ?name\b|\bnom de famille\b/, ac: 'family-name', value: (p) => p.personal.lastName, label: 'Last name' },
  { re: /^(full )?name$|\bfull name\b|\blegal name\b/, ac: 'name', value: (p) => [p.personal.firstName, p.personal.lastName].filter(Boolean).join(' ') || undefined, label: 'Full name' },
  { re: /\be-?mail\b/, ac: 'email', value: (p) => p.personal.email, label: 'Email' },
  { re: /\b(phone|mobile|telephone|cell)\b/, ac: 'tel', value: (p) => p.personal.phone, label: 'Phone' },
  { re: /\blinkedin\b/, value: (p) => p.personal.linkedin, label: 'LinkedIn' },
  { re: /\b(portfolio|github)\b/, value: (p) => p.personal.portfolio, label: 'Portfolio' },
  { re: /\b(website|personal site|url)\b/, ac: 'url', value: (p) => p.personal.website ?? p.personal.portfolio, label: 'Website' },
  { re: /\b(current )?(location|city|address)\b/, value: (p) => p.personal.currentLocation, label: 'Location' },
  { re: /\b(school|university|college)\b/, value: (p) => p.education[0]?.school, label: 'School' },
  { re: /\bdegree\b/, value: (p) => p.education[0]?.degree, label: 'Degree' },
  { re: /\b(major|field of study|discipline)\b/, value: (p) => p.education[0]?.field, label: 'Field of study' },
];

/** Voluntary self-identification questions: never answered automatically unless your Answer Bank says so. */
const EEO_RE = /\b(gender|sex|race|ethnicity|hispanic|latino|veteran|disability|disabled|sexual orientation|pronouns)\b/;

function profileValue(field: FormField, profile: CandidateProfile): { value?: string; label: string } | undefined {
  const l = norm(`${field.label} ${field.name ?? ''}`);
  for (const r of PROFILE_RULES) {
    if ((r.ac && field.autocomplete === r.ac) || r.re.test(l)) return { value: r.value(profile), label: r.label };
  }
  return undefined;
}

function itemFromMatch(field: FormField, m: MatchResult): PlanItem {
  const match = { status: m.status, similarity: Math.round(m.similarity * 100) / 100, entryId: m.entry?.id, entryQuestion: m.entry?.question };
  if (m.status === 'unknown') {
    return { field, status: field.required ? 'needs_input' : 'skipped', source: 'none', reason: field.required ? 'Unknown question: your answer is needed.' : 'Optional question with no known answer: left empty.', match };
  }
  if (m.status === 'unanswered') return { field, status: field.required ? 'needs_input' : 'skipped', source: 'none', reason: m.reason, match };
  let value = m.answer!;
  if (field.type === 'select' || field.type === 'radio') {
    const fitted = fitToOptions(value, field.options);
    if (!fitted) return { field, status: 'needs_confirmation', value, source: 'answer_bank', reason: `Your answer "${value}" does not match the options (${field.options.join(' / ')}).`, match };
    value = fitted;
  }
  if (field.type === 'checkbox') {
    if (!/^(yes|no)$/i.test(value)) return { field, status: 'needs_confirmation', value, source: 'answer_bank', reason: 'Checkbox needs a yes/no answer.', match };
  }
  return { field, status: m.status === 'matched' ? 'ready' : 'needs_confirmation', value, source: 'answer_bank', reason: m.reason, match };
}

export function planField(field: FormField, ctx: PlanContext): PlanItem {
  const label = norm(field.label);
  const user = ctx.userAnswers?.[field.id] ?? ctx.userAnswers?.[field.label];
  if (user !== undefined && user !== '') {
    if ((field.type === 'select' || field.type === 'radio') && !field.options.includes(user)) {
      return { field, status: 'needs_input', value: user, source: 'user', reason: 'Your answer is not one of the options.' };
    }
    return { field, status: 'ready', value: user, source: 'user', reason: 'Answered by you for this application.' };
  }

  if (field.type === 'file') {
    if (/\b(resume|cv|curriculum)\b/.test(label)) {
      return ctx.resumePath
        ? { field, status: 'ready', value: ctx.resumePath, source: 'resume', reason: 'Tailored CV for this offer.' }
        : { field, status: 'needs_input', source: 'none', reason: 'No tailored CV generated for this offer.' };
    }
    if (/\bcover ?letter\b|\bmotivation\b/.test(label)) {
      return ctx.coverLetterPath
        ? { field, status: 'ready', value: ctx.coverLetterPath, source: 'cover_letter', reason: 'Cover letter for this offer.' }
        : { field, status: field.required ? 'needs_input' : 'skipped', source: 'none', reason: 'No cover letter generated for this offer.' };
    }
    return { field, status: field.required ? 'needs_input' : 'skipped', source: 'none', reason: 'Unknown file upload: tell me which document to attach.' };
  }

  if (field.type === 'textarea' && /\bcover ?letter\b/.test(label)) {
    return ctx.coverLetterText
      ? { field, status: 'ready', value: ctx.coverLetterText, source: 'cover_letter', reason: 'Text of the cover letter for this offer.' }
      : { field, status: field.required ? 'needs_input' : 'skipped', source: 'none', reason: 'No cover letter generated for this offer.' };
  }

  if (EEO_RE.test(label)) {
    const m = matchQuestion(field.label, ctx.bank);
    if (m.status === 'matched' || m.status === 'needs_confirmation') return itemFromMatch(field, m);
    return { field, status: field.required ? 'needs_input' : 'skipped', source: 'none', reason: 'Voluntary self-identification: never answered for you.' };
  }

  // Short identity fields come from the profile; questions go through the Answer Bank.
  const looksLikeQuestion = field.label.trim().endsWith('?') || field.label.split(/\s+/).length > 6;
  if (!looksLikeQuestion && field.type !== 'select' && field.type !== 'radio' && field.type !== 'checkbox') {
    const pv = profileValue(field, ctx.profile);
    if (pv) {
      return pv.value
        ? { field, status: 'ready', value: pv.value, source: 'profile', reason: `${pv.label} from My Profile.` }
        : { field, status: field.required ? 'needs_input' : 'skipped', source: 'none', reason: `${pv.label} is empty in My Profile.` };
    }
  }
  return itemFromMatch(field, matchQuestion(field.label, ctx.bank));
}

export interface FillPlan {
  items: PlanItem[];
  ready: number;
  needsInput: PlanItem[];
  needsConfirmation: PlanItem[];
  skipped: PlanItem[];
  /** True when every required field has a confirmed value. */
  complete: boolean;
}

export function planForm(fields: FormField[], ctx: PlanContext): FillPlan {
  const items = fields.map((f) => planField(f, ctx));
  const needsInput = items.filter((i) => i.status === 'needs_input');
  const needsConfirmation = items.filter((i) => i.status === 'needs_confirmation');
  return {
    items,
    ready: items.filter((i) => i.status === 'ready').length,
    needsInput,
    needsConfirmation,
    skipped: items.filter((i) => i.status === 'skipped'),
    complete: needsInput.length === 0 && needsConfirmation.length === 0,
  };
}
