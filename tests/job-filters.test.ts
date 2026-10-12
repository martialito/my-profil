import { describe, expect, it } from 'vitest';
import { extractDuration, extractPeriodHints, extractSalary, extractStartEnd } from '../src/job-search/extract.js';
import { checkInternship, matchLocation } from '../src/job-search/filters.js';
import { extractSections, htmlToText } from '../src/job-search/text.js';

describe('NYC location matching', () => {
  it.each([
    ['New York, NY', 'nyc'],
    ['New York, New York, United States', 'nyc'],
    ['New York City', 'nyc'],
    ['NYC (Hybrid)', 'nyc'],
    ['Manhattan', 'nyc'],
    ['Brooklyn, NY', 'nyc'],
    ['Long Island City, Queens', 'nyc'],
    ['San Francisco, CA; New York, NY', 'nyc'],
    ['Jersey City, NJ', 'near'],
    ['Hoboken', 'near'],
    ['Remote - US', 'remote'],
    ['Albany, NY', 'none'],
    ['New York State', 'none'],
    ['Miami, FL', 'none'],
    ['Paris, France', 'none'],
  ])('%s → %s', (loc, expected) => {
    expect(matchLocation(loc)).toBe(expected);
  });
});

describe('internship detection (internship only)', () => {
  it.each([
    ['Marketing Intern', undefined, true],
    ['Summer Internship 2027 - Hospitality', undefined, true],
    ['Product Manager Intern', undefined, true],
    ['Business Analyst', 'Intern', true],
    ['Co-op, Operations', undefined, true],
    ['Senior Marketing Manager', undefined, false],
    ['Marketing Coordinator', 'Full-time', false],
    ['Sales Associate', undefined, false],
    ['Stage Manager', undefined, false],
  ])('%s (%s) → %s', (title, employmentType, expected) => {
    expect(checkInternship({ title, employmentType }).isInternship).toBe(expected);
  });
});

describe('literal extraction from offers', () => {
  it('extracts salary only when written', () => {
    expect(extractSalary('Pay: $25 - $28 per hour.')).toBe('$25 - $28 per hour');
    expect(extractSalary('Compensation: $60,000 to $70,000 a year')).toBe('$60,000 to $70,000 a year');
    expect(extractSalary('Competitive pay')).toBeUndefined();
  });

  it('extracts durations', () => {
    expect(extractDuration('a 6-month internship')).toBe('6-month');
    expect(extractDuration('12 weeks program')).toBe('12 weeks');
    expect(extractDuration('six months, full time')).toBe('six months');
    expect(extractDuration('no duration')).toBeUndefined();
  });

  it('collects period hints for Phase 3 date logic', () => {
    expect(extractPeriodHints('Spring 2027 internship, March - August 2027, starting March 2027')).toEqual([
      'March - August 2027',
      'Spring 2027',
      'March 2027',
    ]);
    expect(extractPeriodHints('Summer 2027 Analyst')).toEqual(['Summer 2027']);
    expect(extractPeriodHints('no dates')).toEqual([]);
  });

  it('reads explicit start/end dates', () => {
    expect(extractStartEnd('Start date: March 2027. End date: August 31, 2027')).toEqual({ startDate: 'March 2027', endDate: 'August 31, 2027' });
    expect(extractStartEnd('Internship starting in Summer 2027')).toEqual({ startDate: 'Summer 2027', endDate: undefined });
  });

  it('converts escaped HTML and finds sections', () => {
    const text = htmlToText('&lt;h3&gt;What you&#39;ll do&lt;/h3&gt;&lt;ul&gt;&lt;li&gt;Run campaigns&lt;/li&gt;&lt;/ul&gt;&lt;h3&gt;Requirements&lt;/h3&gt;&lt;ul&gt;&lt;li&gt;Excel &amp;amp; Canva&lt;/li&gt;&lt;/ul&gt;');
    expect(text).toContain('• Run campaigns');
    expect(extractSections(text)).toEqual({ responsibilities: ['Run campaigns'], requirements: ['Excel & Canva'] });
  });
});
