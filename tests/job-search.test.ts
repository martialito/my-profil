import { describe, expect, it } from 'vitest';
import { createApp } from '../src/api/app.js';
import { parseAtsUrl } from '../src/job-search/connectors/index.js';
import { normalizeGreenhouseJob } from '../src/job-search/connectors/greenhouse.js';
import { normalizeLeverPosting } from '../src/job-search/connectors/lever.js';
import { generateSearchQueries } from '../src/job-search/queries.js';
import { defaultSettings } from '../src/models/settings.js';
import { emptyProfile } from '../src/models/profile.js';
import { JobSearchService } from '../src/services/job-search.service.js';
import { JobService } from '../src/services/job.service.js';
import { ProfileService } from '../src/services/profile.service.js';
import request from 'supertest';
import { fakeFetch, greenhouseJobs, leverPostings } from './fixtures/job-boards.js';
import { testDb } from './helpers.js';

describe('connectors normalisation', () => {
  it('Greenhouse: decodes content and extracts literal facts', () => {
    const j = normalizeGreenhouseJob(greenhouseJobs.jobs[0]!, 'hudsonhotels', 'Hudson Hotels Group');
    expect(j).toMatchObject({
      sourceKey: 'greenhouse',
      externalId: 'hudsonhotels:1001',
      company: 'Hudson Hotels Group',
      title: 'Marketing Intern (Spring 2027)',
      location: 'New York, NY',
      employmentType: 'Internship',
      postedDate: '2026-09-28',
      department: 'Marketing',
      salary: '$25 - $28 per hour',
      internshipDuration: '6-month',
      startDate: 'March 2027',
      responsibilities: ['Support social media campaigns', 'Analyze guest feedback'],
      requirements: ['Currently enrolled in a business program', 'Fluent English'],
    });
    expect(j.periodHints).toEqual(['Spring 2027', 'March 2027']);
    expect(j.description).not.toContain('&lt;');
    expect(j.skills).toEqual([]);
  });

  it('Lever: uses lists, commitment and structured salary', () => {
    const j = normalizeLeverPosting(leverPostings[0]!, 'brightmedia', 'Bright Media');
    expect(j).toMatchObject({
      externalId: 'brightmedia:a1b2c3d4-0000-4000-8000-000000000001',
      employmentType: 'Intern',
      location: 'New York City',
      workplaceType: 'hybrid',
      salary: '$22 - $24 per hour wage',
      responsibilities: ['Prospect new clients', 'Prepare sales decks'],
      requirements: ['Excel', 'Strong communication'],
      postedDate: '2026-09-30',
    });
    expect(j.periodHints).toEqual(['March - August 2027']);
  });

  it('parses Greenhouse/Lever URLs and nothing else', () => {
    expect(parseAtsUrl('https://boards.greenhouse.io/acme/jobs/123')).toEqual({ provider: 'greenhouse', token: 'acme', jobId: '123' });
    expect(parseAtsUrl('https://job-boards.greenhouse.io/acme')).toEqual({ provider: 'greenhouse', token: 'acme', jobId: undefined });
    expect(parseAtsUrl('https://jobs.lever.co/acme/uuid-1/apply')).toEqual({ provider: 'lever', token: 'acme', jobId: 'uuid-1' });
    expect(parseAtsUrl('https://www.linkedin.com/jobs/view/123')).toBeUndefined();
  });
});

describe('search query generation', () => {
  it('falls back to the brief examples for an empty profile', () => {
    const q = generateSearchQueries(emptyProfile(), defaultSettings());
    expect(q.map((x) => x.query)).toEqual([
      'marketing intern New York 2027',
      'business intern New York 2027',
      'tourism intern New York 2027',
      'hospitality intern New York 2027',
      'sales intern New York 2027',
      'operations intern New York 2027',
      'communications intern New York 2027',
    ]);
    expect(q[0]!.links.map((l) => l.platform)).toContain('LinkedIn');
  });

  it('derives domains from the profile first', () => {
    const p = emptyProfile();
    p.preferences.preferredJobTitles = ['Event Planning Intern', 'Guest Relations Internship'];
    p.preferences.preferredIndustries = ['Luxury retail'];
    const q = generateSearchQueries(p, defaultSettings());
    expect(q.slice(0, 3).map((x) => x.domain)).toEqual(['event planning', 'guest relations', 'luxury retail']);
  });
});

describe('JobSearchService pipeline', () => {
  async function setup() {
    const db = testDb();
    const fetchJson = fakeFetch();
    const svc = new JobSearchService(db, { fetchJson, delayMs: 0 });
    await svc.addBoard({ url: 'https://job-boards.greenhouse.io/hudsonhotels' });
    await svc.addBoard({ provider: 'lever', token: 'brightmedia', companyName: 'Bright Media' });
    return { db, svc, fetchJson };
  }

  it('validates boards before adding them', async () => {
    const { svc } = await setup();
    expect(svc.listBoards().map((b) => [b.provider, b.companyName, b.lastJobCount])).toEqual([
      ['lever', 'Bright Media', 3],
      ['greenhouse', 'Hudson Hotels Group', 4],
    ]);
    await expect(svc.addBoard({ provider: 'greenhouse', token: 'doesnotexist' })).rejects.toThrow(/Could not reach/);
    await expect(svc.addBoard({ provider: 'greenhouse', token: 'hudsonhotels' })).rejects.toThrow(/already configured/);
    await expect(svc.addBoard({ url: 'https://www.indeed.com/viewjob?jk=1' })).rejects.toThrow(/Only boards/);
  });

  it('fetches, filters internships in NYC and stores them', async () => {
    const { db, svc } = await setup();
    const res = await svc.run('manual');
    expect(res.errors).toEqual([]);
    expect(res.stats).toMatchObject({ boards: 2, fetched: 7, kept: 3, newJobs: 3, filteredNotInternship: 2, filteredNotNyc: 2 });
    const list = new JobService(db).list({ sort: 'company', limit: 100, offset: 0 });
    expect(list.items.map((j) => [j.company, j.title, j.locationMatch, j.source])).toEqual([
      ['Bright Media', 'Sales Intern', 'nyc', 'lever'],
      ['Hudson Hotels Group', 'Hospitality Intern', 'nyc', 'greenhouse'],
      ['Hudson Hotels Group', 'Marketing Intern (Spring 2027)', 'nyc', 'greenhouse'],
    ]);
    // Tracking params are removed from stored URLs
    expect(list.items.find((j) => j.title.startsWith('Marketing'))!.sourceUrl).toBe('https://job-boards.greenhouse.io/hudsonhotels/jobs/1001');
  });

  it('keeps remote internships only if the profile accepts remote work', async () => {
    const { db, svc } = await setup();
    const profile = new ProfileService(db);
    const p = profile.get();
    p.preferences.workModes = ['on-site', 'hybrid', 'remote'];
    profile.save(p);
    const res = await svc.run();
    expect(res.stats.kept).toBe(4);
  });

  it('is idempotent: a second run updates instead of duplicating, and keeps user status', async () => {
    const { db, svc } = await setup();
    await svc.run();
    const jobsSvc = new JobService(db);
    const first = jobsSvc.list({ sort: 'found', limit: 100, offset: 0 }).items[0]!;
    jobsSvc.setStatus(first.id, 'SHORTLISTED');
    const res = await svc.run();
    expect(res.stats).toMatchObject({ newJobs: 0, updated: 3, duplicatesGrouped: 0 });
    expect(jobsSvc.get(first.id).status).toBe('SHORTLISTED');
    expect(jobsSvc.list({ sort: 'found', limit: 100, offset: 0 }).total).toBe(3);
  });

  it('marks offers that disappeared from a board as closed', async () => {
    const db = testDb();
    const shrunk = { ...greenhouseJobs, jobs: greenhouseJobs.jobs.filter((j) => j.id !== 1004) };
    const svc1 = new JobSearchService(db, { fetchJson: fakeFetch(), delayMs: 0 });
    await svc1.addBoard({ provider: 'greenhouse', token: 'hudsonhotels' });
    await svc1.run();
    const svc2 = new JobSearchService(db, {
      fetchJson: fakeFetch({ 'https://boards-api.greenhouse.io/v1/boards/hudsonhotels/jobs?content=true': { status: 200, body: shrunk } }),
      delayMs: 0,
    });
    const res = await svc2.run();
    expect(res.stats.closed).toBe(1);
    const jobsSvc = new JobService(db);
    expect(jobsSvc.list({ sort: 'found', limit: 100, offset: 0 }).total).toBe(1);
    expect(jobsSvc.list({ sort: 'found', limit: 100, offset: 0, includeClosed: true }).total).toBe(2);
  });

  it('records board errors without stopping the run', async () => {
    const db = testDb();
    const svc = new JobSearchService(db, { fetchJson: fakeFetch(), delayMs: 0 });
    await svc.addBoard({ provider: 'greenhouse', token: 'hudsonhotels' });
    const broken = new JobSearchService(db, {
      fetchJson: fakeFetch({ 'https://boards-api.greenhouse.io/v1/boards/hudsonhotels/jobs?content=true': { status: 500, body: 'oops' } }),
      delayMs: 0,
    });
    const res = await broken.run();
    expect(res.errors).toEqual([{ board: 'greenhouse:hudsonhotels', reason: 'Greenhouse API returned HTTP 500' }]);
    expect(broken.listBoards()[0]!.lastError).toMatch(/HTTP 500/);
    expect(broken.runs()[0]!.finishedAt).toBeTruthy();
  });

  it('groups the same offer imported manually from another site', async () => {
    const { db, svc } = await setup();
    await svc.run();
    const gh = greenhouseJobs.jobs[0]!;
    const res = await svc.importManual({
      url: 'https://www.linkedin.com/jobs/view/987654',
      company: 'Hudson Hotels Group',
      title: 'Marketing Internship - Spring 2027',
      location: 'New York, NY',
      description: gh.content.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&'),
    });
    expect(res.kind).toBe('duplicate');
    const jobsSvc = new JobService(db);
    expect(jobsSvc.list({ sort: 'found', limit: 100, offset: 0 }).total).toBe(3);
    const original = jobsSvc.get((res as { of: number }).of);
    expect(original.related.map((r) => r.source)).toEqual(['linkedin']);
  });

  it('manual import: never fetches non-ATS pages, requires pasted content', async () => {
    const { svc } = await setup();
    await expect(svc.importManual({ url: 'https://careers.example.com/job/42' })).rejects.toThrow(/paste the company/);
    const res = await svc.importManual({
      url: 'https://careers.example.com/job/42?utm_source=x',
      company: 'Example Co',
      title: 'Tourism Intern',
      location: 'Queens, NY',
      description: 'Summer 2027 internship, 10 weeks.',
    });
    expect(res.kind).toBe('new');
    expect(res.warnings).toEqual([]);
    const again = await svc.importManual({ url: 'https://careers.example.com/job/42', company: 'Example Co', title: 'Tourism Intern', description: 'x' });
    expect(again.kind).toBe('updated');
  });

  it('manual import of a Greenhouse URL goes through the public API', async () => {
    const { svc } = await setup();
    const res = await svc.importManual({ url: 'https://job-boards.greenhouse.io/hudsonhotels/jobs/1001' });
    expect(res.kind).toBe('new');
  });

  it('warns (but imports) when a manual offer is not an NYC internship', async () => {
    const { svc } = await setup();
    const res = await svc.importManual({ url: 'https://acme.com/j/1', company: 'Acme', title: 'Brand Manager', location: 'Chicago', description: 'Full-time role' });
    expect(res.warnings.join(' ')).toMatch(/does not look like an internship/);
  });
});

describe('jobs & search API', () => {
  it('runs a search and lists jobs with filters', async () => {
    const db = testDb();
    const app = createApp(db, { jobSearch: { fetchJson: fakeFetch(), delayMs: 0 } });
    expect((await request(app).post('/api/search/boards').send({ url: 'https://boards.greenhouse.io/hudsonhotels' })).status).toBe(201);
    const run = await request(app).post('/api/search/run');
    expect(run.body.stats.newJobs).toBe(2);

    const all = await request(app).get('/api/jobs');
    expect(all.body.total).toBe(2);
    expect((await request(app).get('/api/jobs?q=hospitality')).body.total).toBe(1);
    expect((await request(app).get('/api/jobs?startDate=Spring%202027')).body.total).toBe(1);
    expect((await request(app).get('/api/jobs?duration=12')).body.total).toBe(1);
    expect((await request(app).get('/api/jobs?source=lever')).body.total).toBe(0);
    expect((await request(app).get('/api/jobs?minScore=75')).body.total).toBe(0); // nothing scored before Phase 3

    const id = all.body.items[0].id;
    const detail = await request(app).get(`/api/jobs/${id}`);
    expect(detail.body.analysis).toBeNull();
    expect((await request(app).patch(`/api/jobs/${id}/status`).send({ status: 'SKIPPED' })).body.status).toBe('SKIPPED');
    expect((await request(app).patch(`/api/jobs/${id}/status`).send({ status: 'APPLIED' })).status).toBe(422);

    const dash = await request(app).get('/api/dashboard');
    expect(dash.body.stats.totalJobs).toBe(2);
    expect(dash.body.stats.newJobs).toBe(1);
    expect(dash.body.lastSearch.stats.newJobs).toBe(2);

    expect((await request(app).get('/api/search/queries')).body.length).toBeGreaterThan(0);
    expect((await request(app).get('/api/jobs/sources')).body.find((s: { key: string }) => s.key === 'linkedin').automationAllowed).toBe(false);
  });
});
