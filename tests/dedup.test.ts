import { describe, expect, it } from 'vitest';
import { canonicalizeUrl, compareJobs, findDuplicate, normalizeCompany } from '../src/job-search/dedup.js';

const DESC = 'Join our brand team for a six month internship supporting social media campaigns, analysing guest feedback and preparing weekly reports for the marketing director in our Manhattan office.';

describe('URL canonicalization', () => {
  it('removes tracking params, fragments, www, trailing slash and /apply', () => {
    expect(canonicalizeUrl('http://www.Example.com/jobs/123/?utm_source=x&gh_src=y#apply')).toBe('https://example.com/jobs/123');
    expect(canonicalizeUrl('https://jobs.lever.co/acme/abc/apply?lever-source=LinkedIn')).toBe('https://jobs.lever.co/acme/abc');
    expect(canonicalizeUrl('https://acme.com/job?id=5&b=2&utm_medium=z')).toBe('https://acme.com/job?b=2&id=5');
  });
});

describe('fuzzy duplicate detection', () => {
  it('normalizes company names', () => {
    expect(normalizeCompany('Hudson Hotels, Inc.')).toBe(normalizeCompany('hudson hotels'));
    expect(normalizeCompany('Ben & Jerry’s LLC')).toBe('ben and jerry s');
  });

  it('flags the same offer posted on two sites', () => {
    const a = { company: 'Hudson Hotels Inc.', title: 'Marketing Intern - Spring 2027', location: 'New York, NY', locationMatch: 'nyc', description: DESC };
    const b = { company: 'Hudson Hotels', title: 'Marketing Internship (Spring 2027)', location: 'Manhattan', locationMatch: 'nyc', description: DESC + ' Apply now!' };
    expect(compareJobs(a, b).isDuplicate).toBe(true);
  });

  it('keeps different roles of the same company apart', () => {
    const a = { company: 'Hudson Hotels', title: 'Marketing Intern', location: 'New York, NY', locationMatch: 'nyc', description: DESC };
    const b = { company: 'Hudson Hotels', title: 'Finance Intern', location: 'New York, NY', locationMatch: 'nyc', description: 'Support the finance team with month-end closing, reconciliations and budget reporting for all properties.' };
    expect(compareJobs(a, b).isDuplicate).toBe(false);
  });

  it('keeps same title in different cities apart', () => {
    const a = { company: 'Hudson Hotels', title: 'Marketing Intern', location: 'New York, NY', locationMatch: 'nyc', description: DESC };
    const b = { company: 'Hudson Hotels', title: 'Marketing Intern', location: 'Miami, FL', locationMatch: 'none', description: DESC };
    expect(compareJobs(a, b).isDuplicate).toBe(false);
  });

  it('never merges different companies', () => {
    const a = { company: 'Hudson Hotels', title: 'Marketing Intern', description: DESC };
    expect(compareJobs(a, { ...a, company: 'Bright Media' }).isDuplicate).toBe(false);
  });

  it('requires an identical title when descriptions are missing', () => {
    const base = { company: 'Acme', location: 'NYC', locationMatch: 'nyc' };
    expect(compareJobs({ ...base, title: 'Sales Intern' }, { ...base, title: 'Sales Intern' }).isDuplicate).toBe(true);
    expect(compareJobs({ ...base, title: 'Sales Intern' }, { ...base, title: 'Sales Intern Paris' }).isDuplicate).toBe(false);
  });

  it('findDuplicate returns the best candidate', () => {
    const job = { company: 'Acme', title: 'Sales Intern', location: 'NYC', locationMatch: 'nyc' };
    expect(findDuplicate(job, [{ id: 1, company: 'Acme', title: 'Marketing Intern', locationMatch: 'nyc' }, { id: 2, ...job }])?.id).toBe(2);
    expect(findDuplicate(job, [])).toBeUndefined();
  });
});
