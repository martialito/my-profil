import { describe, expect, it } from 'vitest';
import { isDateCompatible, parseDurationMonths, parsePeriod } from '../src/job-analysis/dates.js';
import { extractDuration, extractPeriodHints, extractStartEnd } from '../src/job-search/extract.js';

const AVAIL = { start: '2027-03-01', end: '2027-08-31', idealDurationMonths: 6 };

/** Build the input exactly as the job-search extraction would from an offer's text. */
function fromText(title: string, description = '') {
  const text = `${title}\n${description}`;
  return { title, description, periodHints: extractPeriodHints(text), internshipDuration: extractDuration(text), ...extractStartEnd(text) };
}
const check = (title: string, description = '') => isDateCompatible(fromText(title, description), AVAIL);

describe('isDateCompatible — examples from the brief', () => {
  it.each([
    ['Marketing Intern', 'Internship starting March 2027.', 'COMPATIBLE'],
    ['Marketing Intern', 'Start date: April 2027', 'COMPATIBLE'],
    ['Summer 2027 Internship', '', 'COMPATIBLE'],
    ['Marketing Intern', 'This internship runs March-August 2027.', 'COMPATIBLE'],
    ['Marketing Intern', 'Program dates: January-February 2027.', 'INCOMPATIBLE'],
    ['Marketing Intern', 'Start date: September 2027', 'INCOMPATIBLE'],
    ['Marketing Intern', '12 months starting June 2027', 'INCOMPATIBLE'],
  ])('%s / "%s" → %s', (title, desc, expected) => {
    expect(check(title, desc).status).toBe(expected);
  });
});

describe('isDateCompatible — other cases', () => {
  it('exact range inside availability scores 100 and is auto-submit safe', () => {
    const r = check('Intern', 'Start date: March 2027. End date: August 2027.');
    expect(r).toMatchObject({ status: 'COMPATIBLE', score: 100, precision: 'month', autoSubmitSafe: true, period: { start: '2027-03', end: '2027-08' } });
  });

  it('6-month internship starting March 2027 → March-August, compatible', () => {
    const r = check('Intern', 'A 6-month internship starting March 2027.');
    expect(r).toMatchObject({ status: 'COMPATIBLE', period: { start: '2027-03', end: '2027-08', durationMonths: 6 } });
  });

  it('6-month internship starting April 2027 → ends September → incompatible', () => {
    expect(check('Intern', '6-month internship starting April 2027').status).toBe('INCOMPATIBLE');
  });

  it('duration only → UNKNOWN (never guessed)', () => {
    const r = check('Marketing Intern', 'This is a 6-month internship.');
    expect(r).toMatchObject({ status: 'UNKNOWN', score: null, precision: 'duration-only', autoSubmitSafe: false });
  });

  it('duration longer than availability → INCOMPATIBLE even without dates', () => {
    expect(check('Intern', 'A 12-month internship.').status).toBe('INCOMPATIBLE');
  });

  it('no dates → UNKNOWN', () => {
    expect(check('Marketing Intern', 'Great team, great culture.')).toMatchObject({ status: 'UNKNOWN', precision: 'none' });
  });

  it('Spring 2027 (often January–May in the US) → UNKNOWN, must be confirmed', () => {
    const r = check('Spring 2027 Marketing Intern');
    expect(r.status).toBe('UNKNOWN');
    expect(r.reasons.join(' ')).toMatch(/must be confirmed/);
  });

  it('Summer 2027 is compatible but season-level (not auto-submit safe)', () => {
    expect(check('Summer 2027 Analyst')).toMatchObject({ status: 'COMPATIBLE', precision: 'season', autoSubmitSafe: false });
  });

  it('Fall 2027 and Summer 2026 are incompatible', () => {
    expect(check('Fall 2027 Intern').status).toBe('INCOMPATIBLE');
    expect(check('Summer 2026 Intern').status).toBe('INCOMPATIBLE');
  });

  it('flexible start before availability → UNKNOWN instead of INCOMPATIBLE', () => {
    expect(check('Intern', 'Starting February 2027, flexible start date.').status).toBe('UNKNOWN');
    expect(check('Intern', 'Starting February 2027.').status).toBe('INCOMPATIBLE');
  });

  it('conflicting seasons → UNKNOWN', () => {
    expect(check('Intern', 'We hire for Summer 2027 and Fall 2027 cohorts.').status).toBe('UNKNOWN');
  });

  it('respects the minimum duration preference', () => {
    const r = isDateCompatible(fromText('Intern', '10 weeks, Summer 2027'), { ...AVAIL, minimumDurationMonths: 5 });
    expect(r.status).toBe('INCOMPATIBLE');
  });

  it('a short internship within the window is compatible with a lower score', () => {
    const r = check('Intern', 'June 2027 - August 2027');
    expect(r).toMatchObject({ status: 'COMPATIBLE', score: 90 });
  });
});

describe('parsers', () => {
  it('parsePeriod', () => {
    expect(parsePeriod('March - August 2027')).toMatchObject({ kind: 'range', precision: 'month' });
    expect(parsePeriod('November 2026 - February 2027')?.start).toBe(2026 * 12 + 10);
    expect(parsePeriod('Spring/Summer 2027')).toMatchObject({ kind: 'season', start: 2027 * 12, end: 2027 * 12 + 7 });
    expect(parsePeriod('03/15/2027')).toMatchObject({ kind: 'point', precision: 'exact', start: 2027 * 12 + 2 });
    expect(parsePeriod('nothing')).toBeUndefined();
  });
  it('parseDurationMonths', () => {
    expect(parseDurationMonths('6-month')).toBe(6);
    expect(parseDurationMonths('12 weeks')).toBe(3);
    expect(parseDurationMonths('10 weeks')).toBe(3);
    expect(parseDurationMonths('3-6 months')).toBe(6);
    expect(parseDurationMonths('six months')).toBe(6);
    expect(parseDurationMonths(undefined)).toBeUndefined();
  });
});
