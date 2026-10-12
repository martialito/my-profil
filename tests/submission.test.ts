import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetEnvCache } from '../src/config/env.js';
import { jobs } from '../src/database/schema.js';
import { setLlmProviderForTests } from '../src/llm/index.js';
import { ApplicationEngineService } from '../src/services/application-engine.service.js';
import { ApplicationService } from '../src/services/application.service.js';
import { DocumentsService } from '../src/services/documents.service.js';
import { JobAnalysisService } from '../src/services/job-analysis.service.js';
import { JobSearchService } from '../src/services/job-search.service.js';
import { MasterCvService } from '../src/services/master-cv.service.js';
import { ProfileService } from '../src/services/profile.service.js';
import { SettingsService } from '../src/services/settings.service.js';
import { NotificationService } from '../src/notifications/notification.service.js';
import { FakeLlm, llmAnalysis } from './fixtures/fake-llm.js';
import { sampleProfile, testDb } from './helpers.js';
import { eq } from 'drizzle-orm';

const exe = process.env.BROWSER_EXECUTABLE_PATH;
const browserAvailable = (exe && fs.existsSync(exe)) || fs.existsSync(chromium.executablePath());
const FORM = (f: string) => `file://${path.resolve('tests/fixtures/forms', f)}`;

async function prepared(form = 'apply-ok.html') {
  const db = testDb();
  new ProfileService(db).save(sampleProfile());
  new MasterCvService(db).createSnapshot();
  const job = await new JobSearchService(db).importManual({
    url: 'https://hudson.example/jobs/1',
    applicationUrl: FORM(form),
    company: 'Hudson Hotels',
    title: 'Marketing Intern',
    location: 'New York, NY',
    description: 'Start date: March 2027. End date: August 2027.',
  });
  setLlmProviderForTests(
    new FakeLlm((req) => {
      if (req.prompt.includes('Tailor the candidate')) return { headline: 'H', summary: 'Business school student.', experiences: [{ index: 0, bullets: [{ text: 'Raised guest satisfaction score by 12%', source: '' }] }], education: [{ index: 0 }], skills: ['Excel'], changes: [] };
      if (req.prompt.includes('Write a cover letter')) return { greeting: 'Dear Hiring Team,', paragraphs: ['Hudson Hotels social media campaigns rely on guest feedback, the core of my work at Hotel Lumière. '.repeat(14)], sign_off: 'Best regards,', claims: [] };
      return llmAnalysis();
    }),
  );
  await new JobAnalysisService(db).analyze(job.id);
  await new DocumentsService(db).generateForJob(job.id);
  const app = new ApplicationService(db).forJob(job.id);
  return { db, appId: app.id, jobId: job.id, engine: new ApplicationEngineService(db) };
}

function allowRealSubmission(db: ReturnType<typeof testDb>) {
  process.env.TEST_MODE = 'false';
  resetEnvCache();
  new SettingsService(db).update('automation', { testMode: false });
}

describe.skipIf(!browserAvailable)('Phase 7 — guarded real submission (local fake sites)', () => {
  beforeEach(() => {
    process.env.TEST_MODE = 'true';
    resetEnvCache();
  });
  afterEach(() => {
    process.env.TEST_MODE = 'true';
    resetEnvCache();
    setLlmProviderForTests(undefined);
  });

  it('is refused while test mode is on (env or settings) and in MANUAL mode', async () => {
    const { db, appId, engine } = await prepared();
    expect(engine.submissionBlocker(appId)).toMatch(/TEST_MODE=true/);
    process.env.TEST_MODE = 'false';
    resetEnvCache();
    expect(engine.submissionBlocker(appId)).toMatch(/Test mode is ON in Settings/);
    new SettingsService(db).update('automation', { testMode: false });
    expect(engine.submissionBlocker(appId)).toBeNull();
    engine.setMode(appId, 'MANUAL');
    expect(engine.submissionBlocker(appId)).toMatch(/MANUAL/);
    await expect(engine.submit(appId, { expectedDigest: '0123456789abcdef' })).rejects.toThrow(/MANUAL/);
  });

  it('submits after review, detects the confirmation and records APPLIED with proof', async () => {
    const { db, appId, engine } = await prepared();
    allowRealSubmission(db);
    const sim = await engine.simulate(appId);
    expect(sim.result.status).toBe('simulated');
    expect(sim.submissionBlocker).toBeNull();

    const { result, application } = await engine.submit(appId, { expectedDigest: sim.report.digest! });
    expect(result.status).toBe('submitted');
    expect(result.submission?.outcome.kind).toBe('confirmed');
    expect(application).toMatchObject({ status: 'APPLIED', confirmationSource: 'site', isSimulation: false });
    expect(application.confirmationText).toMatch(/Thank you for applying to Hudson Hotels/);
    expect(application.confirmationUrl).toMatch(/thanks\.html$/);
    expect(application.followUpDate).toBeTruthy();
    expect(new NotificationService(db).list().some((n) => n.type === 'submitted')).toBe(true);
    // Never twice
    expect(engine.submissionBlocker(appId)).toMatch(/already been submitted/);
    expect(engine.dailyLimit().submittedToday).toBe(1);
  });

  it('aborts without clicking when the reviewed values changed', async () => {
    const { db, appId, engine } = await prepared();
    allowRealSubmission(db);
    const sim = await engine.simulate(appId);
    new ProfileService(db).save({ ...sampleProfile(), personal: { ...sampleProfile().personal, firstName: 'Alexandre' } });
    const { result, application } = await engine.submit(appId, { expectedDigest: sim.report.digest! });
    expect(result.status).toBe('aborted');
    expect(result.abortReason).toMatch(/changed since you reviewed/);
    expect(result.submission).toBeUndefined();
    expect(application.status).not.toBe('APPLIED');
  });

  it('aborts when the final check fails on the live page (wrong company)', async () => {
    const { db, appId, jobId, engine } = await prepared();
    allowRealSubmission(db);
    const sim = await engine.simulate(appId);
    db.update(jobs).set({ company: 'Another Company' }).where(eq(jobs.id, jobId)).run();
    const { result } = await engine.submit(appId, { expectedDigest: sim.report.digest! });
    expect(result.status).toBe('aborted');
    expect(result.abortReason).toMatch(/Correct company/);
  });

  it('a form error after the click is NOT counted as applied', async () => {
    const { db, appId, engine } = await prepared('apply-error.html');
    allowRealSubmission(db);
    const sim = await engine.simulate(appId);
    const { result, application } = await engine.submit(appId, { expectedDigest: sim.report.digest! });
    expect(result.status).toBe('form_errors');
    expect(application.status).not.toBe('APPLIED');
    expect(application.submittedAt).toBeNull();
  });

  it('no visible confirmation → unconfirmed, NOT applied, you are notified', async () => {
    const { db, appId, engine } = await prepared('apply-silent.html');
    allowRealSubmission(db);
    const sim = await engine.simulate(appId);
    const { result, application } = await engine.submit(appId, { expectedDigest: sim.report.digest! });
    expect(result.status).toBe('unconfirmed');
    expect(application.status).not.toBe('APPLIED');
    expect(new NotificationService(db).list()[0]).toMatchObject({ level: 'action_required' });
  });

  it('respects the daily limit', async () => {
    const { db, appId, engine } = await prepared();
    allowRealSubmission(db);
    new SettingsService(db).update('automation', { maxApplicationsPerDay: 0 });
    expect(engine.submissionBlocker(appId)).toMatch(/Daily limit/);
  });
});
