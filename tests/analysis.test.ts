import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/api/app.js';
import { isDateCompatible } from '../src/job-analysis/dates.js';
import { computeScore, type ScoringInput } from '../src/job-analysis/scoring.js';
import { setLlmProviderForTests } from '../src/llm/index.js';
import { MasterCvContentSchema } from '../src/models/master-cv.js';
import { defaultSettings } from '../src/models/settings.js';
import { JobAnalysisService } from '../src/services/job-analysis.service.js';
import { JobSearchService } from '../src/services/job-search.service.js';
import { JobService } from '../src/services/job.service.js';
import { MasterCvService } from '../src/services/master-cv.service.js';
import { ProfileService } from '../src/services/profile.service.js';
import { FakeLlm, llmAnalysis } from './fixtures/fake-llm.js';
import { sampleProfile, testDb } from './helpers.js';

const AVAIL = { start: '2027-03-01', end: '2027-08-31', idealDurationMonths: 6 };
const master = MasterCvContentSchema.parse(sampleProfile());
const DESC = 'A 6-month internship starting March 2027. Support social media campaigns. Requirements: Excel, Canva.';

function input(over: Partial<ScoringInput> = {}): ScoringInput {
  const job = { title: 'Marketing Intern', description: DESC, startDate: 'March 2027', internshipDuration: '6-month', periodHints: ['March 2027'] };
  return {
    llm: llmAnalysis(),
    job,
    date: isDateCompatible(job, AVAIL),
    availability: AVAIL,
    locationMatch: 'nyc',
    isInternship: true,
    master,
    requiresSponsorship: 'no',
    classification: defaultSettings().classification,
    ...over,
  };
}

describe('scoring', () => {
  it('computes a weighted, explainable score', () => {
    const r = computeScore(input());
    // 0.3*95 + 0.2*90 + 0.1*95 + 0.15*100 + 0.15*100 + 0.1*90 = 95
    expect(r.overall).toBe(95);
    expect(r.category).toBe('GREEN');
    expect(r.dimensions).toEqual({ skills: 95, experience: 90, education: 95, location: 100, dates: 100, preferences: 90 });
    expect(r.caps).toEqual([]);
  });

  it('removes matched skills that are not in the Master CV (no hallucinated credit)', () => {
    const r = computeScore(input({ llm: llmAnalysis({ matched_skills: [{ skill: 'Excel', evidence: 'Excel' }, { skill: 'Salesforce', evidence: 'used Salesforce daily' }], missing_skills: ['Hootsuite'] }) }));
    expect(r.matchedSkills).toEqual(['Excel']);
    expect(r.dimensions.skills).toBe(33); // 1 verified / (1 + 2 missing)
    expect(r.notes.join(' ')).toMatch(/Salesforce/);
  });

  it('never GREEN when dates are UNKNOWN', () => {
    const job = { title: 'Marketing Intern', description: 'Great internship.' };
    const perfect = llmAnalysis({ skills_match: 100, experience_match: 100, education_match: 100, preferences_match: 100 });
    const r = computeScore(input({ job, date: isDateCompatible(job, AVAIL), llm: perfect }));
    expect(r.date.status).toBe('UNKNOWN');
    expect(r.overall).toBeGreaterThanOrEqual(90);
    expect(r.category).toBe('YELLOW');
  });

  it('caps incompatible dates, non-NYC and non-internship roles', () => {
    const late = { title: 'Intern', description: 'Start date: September 2027', startDate: 'September 2027' };
    expect(computeScore(input({ job: late, date: isDateCompatible(late, AVAIL) })).overall).toBe(40);
    expect(computeScore(input({ locationMatch: 'none' })).category).toBe('RED');
    const ft = computeScore(input({ llm: llmAnalysis({ employment_type: 'full_time' }) }));
    expect(ft.overall).toBe(30);
    expect(ft.redFlags).toContain('Not an internship position.');
  });

  it('applies a sponsorship conflict only when the quote is really in the offer', () => {
    const desc = `${DESC} We are unable to sponsor visas for this role.`;
    const job = { ...input().job, description: desc };
    const conflict = computeScore(input({ job, requiresSponsorship: 'yes', llm: llmAnalysis({ sponsorship: { statement: 'no_sponsorship', evidence: 'unable to sponsor visas' } }) }));
    expect(conflict.overall).toBe(40);
    const invented = computeScore(input({ requiresSponsorship: 'yes', llm: llmAnalysis({ sponsorship: { statement: 'no_sponsorship', evidence: 'no sponsorship available' } }) }));
    expect(invented.overall).toBe(95);
    expect(invented.notes.join(' ')).toMatch(/check manually/);
  });

  it('uses AI-read dates only with a verbatim quote, and never as auto-submit safe', () => {
    const job = { title: 'Marketing Intern', description: 'The program begins on the first Monday of March 2027 and lasts six months.' };
    const det = isDateCompatible({ ...job, periodHints: [] }, AVAIL);
    const good = computeScore(input({ job, date: det, llm: llmAnalysis({ stated_period: { start: '2027-03', end: '2027-08', duration_months: 6, evidence: 'begins on the first Monday of March 2027 and lasts six months' } }) }));
    expect(good.date.status).toBe('COMPATIBLE');
    expect(good.date.autoSubmitSafe).toBe(false);
    const fake = computeScore(input({ job, date: det, llm: llmAnalysis({ stated_period: { start: '2027-03', end: '2027-08', duration_months: 6, evidence: 'from March to August' } }) }));
    expect(fake.date.status).toBe('UNKNOWN');
  });

  it('downgrades to UNKNOWN when AI-read dates contradict the deterministic reading', () => {
    const job = { title: 'Intern', description: 'Start date: March 2027. Actually the cohort starts in October 2027.' , startDate: 'March 2027' };
    const r = computeScore(input({ job, date: isDateCompatible(job, AVAIL), llm: llmAnalysis({ stated_period: { start: '2027-10', end: null, duration_months: null, evidence: 'the cohort starts in October 2027' } }) }));
    expect(r.date.status).toBe('UNKNOWN');
    expect(r.category).not.toBe('GREEN');
  });
});

describe('JobAnalysisService', () => {
  afterEach(() => setLlmProviderForTests(undefined));

  async function setup() {
    const db = testDb();
    new ProfileService(db).save(sampleProfile());
    const search = new JobSearchService(db);
    const a = await search.importManual({ url: 'https://acme.example/jobs/1', company: 'Acme Hotels', title: 'Marketing Intern', location: 'New York, NY', description: DESC });
    const b = await search.importManual({ url: 'https://acme.example/jobs/2', company: 'Acme Hotels', title: 'Finance Intern', location: 'Brooklyn, NY', description: 'Summer 2026 internship in finance. Budget reporting and reconciliations.' });
    return { db, ids: [a.id, b.id] };
  }

  it('requires a Master CV and a configured LLM', async () => {
    const { db, ids } = await setup();
    await expect(new JobAnalysisService(db).analyze(ids[0]!)).rejects.toThrow(/Master CV/);
    new MasterCvService(db).createSnapshot();
    await expect(new JobAnalysisService(db).analyze(ids[0]!)).rejects.toThrow(/ANTHROPIC_API_KEY/);
  });

  it('analyses, stores the explanation and updates the job', async () => {
    const { db, ids } = await setup();
    new MasterCvService(db).createSnapshot();
    const llm = new FakeLlm(() => llmAnalysis());
    setLlmProviderForTests(llm);
    const r = await new JobAnalysisService(db).analyze(ids[0]!);
    expect(r).toMatchObject({ overall: 95, category: 'GREEN' });

    const job = new JobService(db).get(ids[0]!);
    expect(job.status).toBe('ANALYZED');
    expect(job.skills).toEqual(['Excel', 'Social media marketing', 'Canva']);
    expect(job.analysis).toMatchObject({ overallScore: 95, category: 'GREEN', dateStatus: 'COMPATIBLE', skillsMatch: 95, locationCompatibility: 100 });
    expect(job.analysis!.costUsd).toBeGreaterThan(0);

    // Privacy: contact details and work authorization are not sent to the LLM; the CV is sent as cacheable context.
    const req = llm.requests[0]!;
    expect(req.cachedContext).toContain('Hotel Lumière');
    expect(req.cachedContext).not.toContain('alex.martin@example.com');
    expect(req.cachedContext).not.toContain('requiresSponsorship');
    expect(req.prompt).toContain('Marketing Intern');
  });

  it('analyses pending offers in batch and does not override a user decision', async () => {
    const { db, ids } = await setup();
    new MasterCvService(db).createSnapshot();
    new JobService(db).setStatus(ids[1]!, 'SHORTLISTED');
    setLlmProviderForTests(new FakeLlm(() => llmAnalysis()));
    const svc = new JobAnalysisService(db);
    const s = await svc.analyzePending();
    expect(s).toMatchObject({ analyzed: 2, green: 1, red: 1, errors: [] });
    expect(new JobService(db).get(ids[1]!).status).toBe('SHORTLISTED');
    expect(new JobService(db).get(ids[1]!).analysis?.dateStatus).toBe('INCOMPATIBLE');
    expect((await svc.analyzePending()).analyzed).toBe(0); // nothing left
  });

  it('records LLM failures per offer and keeps going', async () => {
    const { db } = await setup();
    new MasterCvService(db).createSnapshot();
    let n = 0;
    setLlmProviderForTests(new FakeLlm(() => (n++ === 0 ? { bad: 'output' } : llmAnalysis())));
    const s = await new JobAnalysisService(db).analyzePending();
    expect(s.analyzed).toBe(1);
    expect(s.errors).toHaveLength(1);
  });

  it('precheck works without any LLM', async () => {
    const { db, ids } = await setup();
    const p = new JobAnalysisService(db).precheck(ids[1]!);
    expect(p).toMatchObject({ locationMatch: 'nyc', internship: { isInternship: true }, date: { status: 'INCOMPATIBLE' } });
  });

  it('API: analyze, list filters by category and date status', async () => {
    const { db, ids } = await setup();
    new MasterCvService(db).createSnapshot();
    setLlmProviderForTests(new FakeLlm(() => llmAnalysis()));
    const app = createApp(db);
    const one = await request(app).post(`/api/jobs/${ids[0]}/analyze`);
    expect(one.body.analysis.category).toBe('GREEN');
    expect((await request(app).get('/api/jobs?category=GREEN')).body.total).toBe(1);
    expect((await request(app).get('/api/jobs?category=NONE')).body.total).toBe(1);
    const run = await request(app).post('/api/analysis/run').send({});
    expect(run.body).toMatchObject({ analyzed: 1, red: 1 });
    expect((await request(app).get('/api/jobs?dateStatus=INCOMPATIBLE')).body.total).toBe(1);
    expect((await request(app).get('/api/jobs?minScore=75&sort=score')).body.items[0].score).toBe(95);
    const dash = await request(app).get('/api/dashboard');
    expect(dash.body.stats).toMatchObject({ matchingJobs: 1, highMatch: 1 });
  });
});
