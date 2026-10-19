/**
 * Application lifecycle (section 15) with explicit allowed transitions.
 *
 * Key rule (section 30): APPLIED means a CONFIRMED submission. It can only be reached with a confirmation:
 * either the site's confirmation (automation, Phase 7) or your own statement that you submitted it yourself
 * (manual mode). Preparing documents or filling a form never makes an application APPLIED.
 */
import { ApplicationStatuses, type ApplicationStatus } from '../models/statuses.js';

const PREPARATION: ApplicationStatus[] = ['FOUND', 'ANALYZED', 'SHORTLISTED', 'CV_CREATED', 'COVER_LETTER_CREATED', 'READY_TO_APPLY'];

export const TRANSITIONS: Record<ApplicationStatus, ApplicationStatus[]> = {
  FOUND: ['ANALYZED', 'SHORTLISTED', 'CV_CREATED', 'WITHDRAWN'],
  ANALYZED: ['SHORTLISTED', 'CV_CREATED', 'WITHDRAWN'],
  SHORTLISTED: ['CV_CREATED', 'COVER_LETTER_CREATED', 'READY_TO_APPLY', 'APPLIED', 'WITHDRAWN'],
  CV_CREATED: ['COVER_LETTER_CREATED', 'READY_TO_APPLY', 'APPLIED', 'WITHDRAWN'],
  COVER_LETTER_CREATED: ['READY_TO_APPLY', 'APPLIED', 'WITHDRAWN'],
  READY_TO_APPLY: ['APPLIED', 'WITHDRAWN'],
  APPLIED: ['INTERVIEW', 'REJECTED', 'OFFER', 'WITHDRAWN'],
  INTERVIEW: ['INTERVIEW', 'OFFER', 'REJECTED', 'WITHDRAWN'],
  OFFER: ['WITHDRAWN'],
  REJECTED: [],
  WITHDRAWN: [],
};

export interface TransitionContext {
  hasResume: boolean;
  hasCoverLetter: boolean;
  isSimulation: boolean;
  /** For APPLIED: who confirms the submission. */
  confirmation?: { source: 'site' | 'user'; text?: string; url?: string };
}

export class TransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransitionError';
  }
}

export function canTransition(from: ApplicationStatus, to: ApplicationStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Throws a TransitionError explaining why the transition is not allowed. */
export function assertTransition(from: ApplicationStatus, to: ApplicationStatus, ctx: TransitionContext): void {
  if (!canTransition(from, to)) {
    throw new TransitionError(`Cannot move an application from ${from} to ${to}.`);
  }
  if (to === 'READY_TO_APPLY' && !(ctx.hasResume && ctx.hasCoverLetter)) {
    throw new TransitionError('READY_TO_APPLY requires a tailored CV and a cover letter.');
  }
  if (to === 'APPLIED') {
    if (!ctx.confirmation) throw new TransitionError('APPLIED requires a confirmed submission (site confirmation or your own confirmation that you submitted it).');
    if (ctx.confirmation.source === 'site' && ctx.isSimulation) throw new TransitionError('A simulated (test mode) submission can never be marked APPLIED.');
    if (ctx.confirmation.source === 'site' && !ctx.confirmation.text && !ctx.confirmation.url) {
      throw new TransitionError('A site confirmation needs the confirmation text or URL as proof.');
    }
  }
}

export const isPreparation = (s: ApplicationStatus) => PREPARATION.includes(s);
export const isResponse = (s: ApplicationStatus) => s === 'INTERVIEW' || s === 'OFFER' || s === 'REJECTED';
export const isFinal = (s: ApplicationStatus) => TRANSITIONS[s].length === 0;

/** Forward-only move used by automatic preparation steps (never jumps to APPLIED or beyond). */
export function preparationTarget(current: ApplicationStatus, wanted: ApplicationStatus): ApplicationStatus {
  if (!isPreparation(wanted) || !isPreparation(current)) return current;
  return ApplicationStatuses.indexOf(wanted) > ApplicationStatuses.indexOf(current) ? wanted : current;
}

/** Follow-up date: application date + N days (YYYY-MM-DD). */
export function followUpDate(applicationDate: string, days: number): string {
  const d = new Date(`${applicationDate.slice(0, 10)}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
