import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/api/app.js';
import { assertTransition, canTransition, followUpDate, preparationTarget, TRANSITIONS } from '../src/application/state-machine.js';
import { setLlmProviderForTests } from '../src/llm/index.js';
import { ApplicationStatuses } from '../src/models/statuses.js';
import { NotificationService } from '../src/notifications/notification.service.js';
import { ApplicationService } from '../src/services/application.service.js';
import { JobAnalysisService } from '../src/services/job-analysis.service.js';
import { JobSearchService } from '../src/services/job-search.service.js';
import { MasterCvService } from '../src/services/master-cv.service.js';
import { ProfileService } from '../src/services/profile.service.js';
import { FakeLlm, llmAnalysis } from './fixtures/fake-llm.js';
import { sampleProfile, testDb } from './helpers.js';

const ctx = { hasResume: true, hasCoverLetter: true, isSimulation: true };

describe('application state machine', () => {
  it('covers every status', () => {
    expect(Object.keys(TRANSITIONS).sort()).toEqual([...ApplicationStatuses].sort());
  });

  it('allows the normal path and forbids going back', () => {
    expect(canTransition('SHORTLISTED', 'CV_CREATED')).toBe(true);
    expect(canTransition('APPLIED', 'INTERVIEW')).toBe(true);
    expect(canTransition('INTERVIEW', 'OFFER')).toBe(true);
    expect(canTransition('APPLIED', 'CV_CREATED')).toBe(false);
    expect(canTransition('REJECTED', 'INTERVIEW')).toBe(false);
    expect(canTransition('FOUND', 'APPLIED')).toBe(false);
    expect(canTransition('ANALYZED', 'INTERVIEW')).toBe(false);
  });

  it('APPLIED always needs a confirmation; a simulated submission never counts', () => {
    expect(() => assertTransition('READY_TO_APPLY', 'APPLIED', ctx)).toThrow(/confirmed submission/);
    expect(() => assertTransition('READY_TO_APPLY', 'APPLIED', { ...ctx, confirmation: { source: 'site', text: 'Thanks for applying' } })).toThrow(/simulated/);
    expect(() => assertTransition('READY_TO_APPLY', 'APPLIED', { ...ctx, isSimulation: false, confirmation: { source: 'site' } })).toThrow(/proof/);
    expect(() => assertTransition('READY_TO_APPLY', 'APPLIED', { ...ctx, confirmation: { source: 'user' } })).not.toThrow();
  });

  it('READY_TO_APPLY needs both documents', () => {
    expect(() => assertTransition('CV_CREATED', 'READY_TO_APPLY', { ...ctx, hasCoverLetter: false })).toThrow(/cover letter/);
  });

  it('preparation steps only move forward and never past READY_TO_APPLY', () => {
    expect(preparationTarget('SHORTLISTED', 'CV_CREATED')).toBe('CV_CREATED');
    expect(preparationTarget('COVER_LETTER_CREATED', 'CV_CREATED')).toBe('COVER_LETTER_CREATED');
    expect(preparationTarget('APPLIED', 'CV_CREATED')).toBe('APPLIED');
    expect(preparationTarget('INTERVIEW', 'COVER_LETTER_CREATED')).toBe('INTERVIEW');
  });

  it('computes follow-up dates (8 Oct 2026 + 7 days = 15 Oct 2026)', () => {
    expect(followUpDate('2026-10-08', 7)).toBe('2026-10-15');
    expect(followUpDate('2026-12-28', 7)).toBe('2027-01-04');
  });
});

describe('ApplicationService & notifications', () => {
  afterEach(() => setLlmProviderForTests(undefined));

  async function setup() {
    const db = testDb();
    const job = await new JobSearchService(db).importManual({ url: 'https://acme.example/1', company: 'Acme Hotels', title: 'Marketing Intern', location: 'New York, NY', description: 'Start date: March 2027. 6 months.' });
    return { db, jobId: job.id, svc: new ApplicationService(db) };
  }

  it('creates one application per job and records events', async () => {
    const { svc, jobId } = await setup();
    const a = svc.forJob(jobId);
    expect(svc.forJob(jobId).id).toBe(a.id);
    expect(svc.get(a.id)).toMatchObject({ status: 'SHORTLISTED', isSimulation: true, submittedAt: null });
    expect(svc.get(a.id).events.map((e) => e.type)).toEqual(['created']);
  });

  it('marking as applied (manual) sets dates, confirmation source and follow-up', async () => {
    const { svc, jobId } = await setup();
    const a = svc.forJob(jobId);
    const applied = svc.transition(a.id, { to: 'APPLIED', applicationDate: '2026-10-08', confirmationText: 'Thank you for applying to Acme Hotels' });
    expect(applied).toMatchObject({ status: 'APPLIED', applicationDate: '2026-10-08', followUpDate: '2026-10-15', confirmationSource: 'user', isSimulation: false });
    expect(applied.submittedAt).toBeTruthy();
    expect(applied.events.at(-1)).toMatchObject({ fromStatus: 'SHORTLISTED', toStatus: 'APPLIED' });
  });

  it('refuses invalid transitions with a clear error', async () => {
    const { svc, jobId } = await setup();
    const a = svc.forJob(jobId);
    expect(() => svc.transition(a.id, { to: 'INTERVIEW' })).toThrow(/Cannot move/);
    expect(() => svc.transition(a.id, { to: 'READY_TO_APPLY' })).toThrow(/requires a tailored CV/);
    expect(() => svc.transition(a.id, { to: 'APPLIED', applicationDate: '8/10/2026' })).toThrow(/YYYY-MM-DD/);
  });

  it('a response cancels the follow-up; notes and follow-up edits are logged', async () => {
    const { svc, jobId } = await setup();
    const a = svc.forJob(jobId);
    svc.transition(a.id, { to: 'APPLIED', applicationDate: '2026-10-08' });
    svc.update(a.id, { notes: 'Recruiter: Jane', followUpDate: '2026-10-20' });
    const i = svc.transition(a.id, { to: 'INTERVIEW', note: 'Phone screen on Oct 22' });
    expect(i.followUpDate).toBeNull();
    expect(i.notes).toBe('Recruiter: Jane');
    expect(i.events.map((e) => e.type)).toEqual(['created', 'status', 'follow_up', 'note', 'status']);
  });

  it('creates follow-up reminders once, only when due', async () => {
    const { db, svc, jobId } = await setup();
    const a = svc.forJob(jobId);
    svc.transition(a.id, { to: 'APPLIED', applicationDate: '2026-10-08' });
    const n = new NotificationService(db);
    expect(n.checkFollowUps('2026-10-14')).toBe(0);
    expect(n.checkFollowUps('2026-10-15')).toBe(1);
    expect(n.checkFollowUps('2026-10-16')).toBe(0); // deduplicated
    const [reminder] = n.list();
    expect(reminder).toMatchObject({ type: 'follow_up', level: 'action_required', title: 'Follow up: Marketing Intern at Acme Hotels' });
    expect(n.counts()).toEqual({ unread: 1, actionRequired: 1 });
    n.markAllRead();
    expect(n.counts().unread).toBe(0);
  });

  it('notifies on high matches and prepared documents', async () => {
    const { db, jobId } = await setup();
    new ProfileService(db).save(sampleProfile());
    new MasterCvService(db).createSnapshot();
    setLlmProviderForTests(new FakeLlm(() => llmAnalysis()));
    await new JobAnalysisService(db).analyze(jobId);
    await new JobAnalysisService(db).analyze(jobId); // re-analysis does not duplicate the notification
    const n = new NotificationService(db).list();
    expect(n.filter((x) => x.type === 'high_match')).toHaveLength(1);
  });

});

describe('tracker & dashboard API', () => {
  it('full manual flow through the API', async () => {
    const db = testDb();
    const app = createApp(db);
    const job = await new JobSearchService(db).importManual({ url: 'https://acme.example/2', company: 'Acme Hotels', title: 'Sales Intern', location: 'Brooklyn', description: 'Summer 2027 internship.' });
    const created = await request(app).post(`/api/applications/for-job/${job.id}`);
    expect(created.status).toBe(201);
    const id = created.body.id;
    const bad = await request(app).post(`/api/applications/${id}/transition`).send({ to: 'OFFER' });
    expect(bad.status).toBe(409);
    expect(bad.body.error.code).toBe('INVALID_TRANSITION');
    const ok = await request(app).post(`/api/applications/${id}/transition`).send({ to: 'APPLIED', applicationDate: '2026-10-08', confirmationUrl: 'https://acme.example/thanks' });
    expect(ok.body).toMatchObject({ status: 'APPLIED', followUpDate: '2026-10-15', confirmationUrl: 'https://acme.example/thanks' });
    expect((await request(app).get('/api/applications?status=APPLIED')).body).toHaveLength(1);
    expect((await request(app).patch(`/api/applications/${id}`).send({ notes: 'Sent via careers site' })).body.notes).toBe('Sent via careers site');

    const dash = await request(app).get('/api/dashboard');
    expect(dash.body.stats).toMatchObject({ totalJobs: 1, applications: 1, applicationsSubmitted: 1, responses: 0 });
    expect(dash.body.topJobs[0]).toMatchObject({ company: 'Acme Hotels', applicationStatus: 'APPLIED' });
    expect(dash.body.recentEvents.length).toBeGreaterThan(0);
    const notifs = await request(app).get('/api/notifications');
    expect(notifs.body).toHaveProperty('counts');
  });
});
