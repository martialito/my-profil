import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/api/app.js';
import { planForm } from '../src/application/form-plan.js';
import { simulateApplication } from '../src/browser/engine.js';
import { paths } from '../src/config/env.js';
import { setLlmProviderForTests } from '../src/llm/index.js';
import { CandidateProfileSchema } from '../src/models/profile.js';
import { AnswerBankService } from '../src/services/answer-bank.service.js';
import { ApplicationEngineService } from '../src/services/application-engine.service.js';
import { ApplicationService } from '../src/services/application.service.js';
import { DocumentsService } from '../src/services/documents.service.js';
import { dryRun } from '../src/services/dry-run.service.js';
import { JobAnalysisService } from '../src/services/job-analysis.service.js';
import { JobSearchService } from '../src/services/job-search.service.js';
import { MasterCvService } from '../src/services/master-cv.service.js';
import { ProfileService } from '../src/services/profile.service.js';
import { FakeLlm, llmAnalysis } from './fixtures/fake-llm.js';
import { sampleProfile, testDb } from './helpers.js';

const exe = process.env.BROWSER_EXECUTABLE_PATH;
const browserAvailable = (exe && fs.existsSync(exe)) || fs.existsSync(chromium.executablePath());
const DEMO = `file://${path.resolve('src/browser/demo-form.html')}`;
const FORMS = (f: string) => `file://${path.resolve('tests/fixtures/forms', f)}`;
const profile = CandidateProfileSchema.parse(sampleProfile());
const opts = { headless: true, slowMoMs: 0, timeoutMs: 20_000 };
const tmp = () => path.join(paths.generated(), `shot-${Math.random().toString(36).slice(2)}.png`);

describe.skipIf(!browserAvailable)('browser engine (real Chromium, local pages)', () => {
  it('fills known fields, uploads the CV, never clicks submit and stops on unknown questions', async () => {
    const r = await simulateApplication({
      url: DEMO,
      screenshotPath: tmp(),
      plan: (fields) => planForm(fields, { profile, bank: [{ id: 1, question: 'Will you require visa sponsorship?', aliases: [], answer: 'Yes', requiresConfirmation: false, category: 'sponsorship' }], resumePath: path.resolve('package.json') }),
      options: opts,
    });
    expect(r.status).toBe('needs_input');
    expect(r.fields).toHaveLength(12);
    expect(r.filled.map((f) => [f.label.replace(' *', ''), f.actual, f.verified])).toEqual([
      ['First Name', 'Alex', true],
      ['Last Name', 'Martin', true],
      ['Email', 'alex.martin@example.com', true],
      ['Phone', '+33 6 12 34 56 78', true],
      ['LinkedIn Profile', 'https://linkedin.com/in/alex-martin-example', true],
      ['Resume/CV', 'package.json', true],
      ['Will you require visa sponsorship?', 'Yes', true],
    ]);
    expect(r.plan!.needsInput.map((i) => i.field.label)).toEqual([
      'Are you legally authorized to work in the United States? *',
      'What is your earliest start date? *',
      'Why do you want to join Hudson Hotels? *',
    ]);
    expect(r.plan!.skipped.map((i) => i.field.label)).toEqual(['Cover Letter', 'Gender (voluntary)']);
    expect(r.submitButton).toBe('Submit application');
    expect(r.pageText).not.toContain('NOT sent anywhere'); // the submit handler never ran
    expect(fs.existsSync(r.screenshotPath!)).toBe(true);
  });

  it('completes when you provide the missing answers (radio + text)', async () => {
    const r = await simulateApplication({
      url: DEMO,
      screenshotPath: tmp(),
      plan: (fields) =>
        planForm(fields, {
          profile,
          bank: [{ id: 1, question: 'Will you require visa sponsorship?', aliases: [], answer: 'Yes', requiresConfirmation: false, category: 'sponsorship' }],
          resumePath: path.resolve('package.json'),
          userAnswers: { 'Are you legally authorized to work in the United States? *': 'No', 'What is your earliest start date? *': 'March 2027', 'Why do you want to join Hudson Hotels? *': 'Because…' },
        }),
      options: opts,
    });
    expect(r.status).toBe('simulated');
    expect(r.filled.find((f) => f.label.startsWith('Are you legally'))).toMatchObject({ actual: 'No', verified: true });
  });

  it('stops on a CAPTCHA without touching it', async () => {
    const r = await simulateApplication({ url: FORMS('captcha.html'), screenshotPath: tmp(), plan: (f) => planForm(f, { profile, bank: [] }), options: opts });
    expect(r).toMatchObject({ status: 'blocked', blocker: { kind: 'captcha' }, filled: [] });
  });

  it('stops on a sign-in page (never types passwords)', async () => {
    const r = await simulateApplication({ url: FORMS('login.html'), screenshotPath: tmp(), plan: (f) => planForm(f, { profile, bank: [] }), options: opts });
    expect(r).toMatchObject({ status: 'blocked', blocker: { kind: 'login' } });
  });

  it('reports unreachable pages as errors', async () => {
    const r = await simulateApplication({ url: FORMS('does-not-exist.html'), screenshotPath: tmp(), plan: (f) => planForm(f, { profile, bank: [] }), options: opts });
    expect(r.status).toBe('error');
  });
});

describe.skipIf(!browserAvailable)('ApplicationEngineService (test mode)', () => {
  afterEach(() => setLlmProviderForTests(undefined));

  async function prepared() {
    const db = testDb();
    new ProfileService(db).save(sampleProfile());
    new MasterCvService(db).createSnapshot();
    const job = await new JobSearchService(db).importManual({
      url: DEMO.replace('file://', 'https://example.com'),
      applicationUrl: DEMO,
      company: 'Hudson Hotels',
      title: 'Marketing Intern',
      location: 'New York, NY',
      description: 'Start date: March 2027. End date: August 2027. Support social media campaigns.',
    });
    setLlmProviderForTests(
      new FakeLlm((req) => {
        if (req.prompt.includes('Tailor the candidate')) return { headline: 'H', summary: 'Business school student.', experiences: [{ index: 0, bullets: [{ text: 'Raised guest satisfaction score by 12%', source: '' }] }], education: [{ index: 0 }], skills: ['Excel'], changes: [] };
        if (req.prompt.includes('Write a cover letter'))
          return { greeting: 'Dear Hiring Team,', paragraphs: ['Hudson Hotels social media campaigns rely on guest feedback, the core of my work at Hotel Lumière. '.repeat(12)], sign_off: 'Best regards,', claims: [] };
        return llmAnalysis();
      }),
    );
    await new JobAnalysisService(db).analyze(job.id);
    await new DocumentsService(db).generateForJob(job.id);
    const app = new ApplicationService(db).forJob(job.id);
    return { db, app, engine: new ApplicationEngineService(db) };
  }

  it('final check before inspecting the page: pending items, documents verified', async () => {
    const { app, engine } = await prepared();
    const c = engine.check(app.id);
    const status = Object.fromEntries(c.items.map((i) => [i.key, i.status]));
    expect(status).toMatchObject({ company: 'pending', job: 'pending', location: 'ok', cv: 'ok', letter: 'ok', candidate: 'ok', dates: 'ok', fields: 'pending', truth: 'ok', consistency: 'ok', limit: 'ok' });
    expect(c.ready).toBe(false);
    expect(c.summary).toMatchObject({ Company: 'Hudson Hotels', Position: 'Marketing Intern', 'Start date': '2027-03', 'End date': '2027-08', Score: 95, CV: 'resume.pdf (v1)' });
  });

  it('simulates on the demo form, uploads the tailored PDFs, saves a report and never submits', async () => {
    const { db, app, engine } = await prepared();
    const answers = { 'Are you legally authorized to work in the United States? *': 'No', 'What is your earliest start date? *': 'March 2027', 'Why do you want to join Hudson Hotels? *': 'Your guest-first marketing.' };
    // The authorization answer comes from My Profile (No) — the start date from the Answer Bank seeds.
    const { result, report, check } = await engine.simulate(app.id, { url: DEMO, answers, saveToBank: ['Why do you want to join Hudson Hotels? *'] });
    expect(result.status).toBe('simulated');
    expect(report.submitted).toBe(false);
    expect(report.wouldFill.find((f) => f.label === 'Resume/CV *')?.actual).toBe('resume.pdf');
    expect(report.wouldFill.find((f) => f.label === 'Cover Letter')?.actual).toBe('cover-letter.pdf');
    expect(check.items.find((i) => i.key === 'fields')?.status).toBe('ok');
    expect(check.items.find((i) => i.key === 'company')?.status).toBe('ok');
    const a = new ApplicationService(db).get(app.id);
    expect(a.status).not.toBe('APPLIED');
    expect(a.submittedAt).toBeNull();
    expect(a.events.at(-1)?.type).toBe('simulation');
    expect(new AnswerBankService(db).list().some((e) => e.question === 'Why do you want to join Hudson Hotels?')).toBe(true);
    expect(fs.readdirSync(path.join(paths.generated(), 'applications', String(a.jobId))).some((f) => f.endsWith('.json'))).toBe(true);
  });

  it('flags contradictions between the Answer Bank and My Profile', async () => {
    const { db, app, engine } = await prepared();
    const bank = new AnswerBankService(db);
    const e = bank.list().find((x) => x.category === 'sponsorship')!;
    bank.update(e.id, { ...e, answer: 'No' }); // profile says sponsorship: yes
    expect(engine.check(app.id).items.find((i) => i.key === 'consistency')?.status).toBe('fail');
  });

  it('API: per-application mode, check, and submission refused (Phase 7)', async () => {
    const { db, app } = await prepared();
    const api = createApp(db);
    expect((await request(api).put(`/api/applications/${app.id}/mode`).send({ mode: 'MANUAL' })).body.mode).toBe('MANUAL');
    expect((await request(api).get(`/api/applications/${app.id}/check`)).body.mode).toBe('MANUAL');
    const sub = await request(api).post(`/api/applications/${app.id}/submit`).send({ confirm: true, expectedDigest: '0123456789abcdef' });
    expect(sub.status).toBe(409); // test mode is on
    expect((await request(api).post(`/api/applications/${app.id}/submit`).send({ expectedDigest: '0123456789abcdef' })).status).toBe(422); // no explicit confirmation
    expect((await request(api).get('/demo/application-form')).text).toContain('DEMO FORM');
    expect((await request(api).post('/api/answers/match').send({ question: 'When can you start?' })).body.status).toBe('matched');
  });

  it('dry run: every step reported, nothing submitted', async () => {
    const { db } = await prepared();
    const lines: string[] = [];
    const steps = await dryRun(db, { log: (l) => lines.push(l) });
    expect(steps[0]).toMatchObject({ step: '1. Search', status: 'skipped' });
    expect(steps.at(-1)).toMatchObject({ step: '7. Submission', status: 'skipped', detail: 'Dry run: nothing was submitted.' });
    const sim = steps.find((s) => s.step.startsWith('6.'))!;
    expect(sim.status).toBe('done');
    expect(sim.detail).toMatch(/NOT clicked/);
  });
});
