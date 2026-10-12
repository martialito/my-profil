import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/api/app.js';
import { paths } from '../src/config/env.js';
import { resumeToDocx, resumeToPdf, resumeToText } from '../src/cv/render.js';
import { extractText } from '../src/cv/text-extraction.js';
import { applications } from '../src/database/schema.js';
import { setLlmProviderForTests } from '../src/llm/index.js';
import { MasterCvContentSchema } from '../src/models/master-cv.js';
import { DocumentsService } from '../src/services/documents.service.js';
import { JobAnalysisService } from '../src/services/job-analysis.service.js';
import { JobSearchService } from '../src/services/job-search.service.js';
import { MasterCvService } from '../src/services/master-cv.service.js';
import { ProfileService } from '../src/services/profile.service.js';
import { FakeLlm, llmAnalysis } from './fixtures/fake-llm.js';
import { sampleProfile, testDb } from './helpers.js';

const master = MasterCvContentSchema.parse(sampleProfile());
const DESC = 'Hudson Hotels is hiring a Marketing Intern for a 6-month internship starting March 2027. Support social media campaigns and guest feedback analysis. Requirements: Excel, Canva.';

const tailoredPlan = (skills = ['Social media marketing', 'Canva', 'Excel']) => ({
  headline: 'Marketing & hospitality student',
  summary: 'Business school student with hotel front-office and social media experience.',
  experiences: [
    { index: 1, bullets: [{ text: 'Managed the brand Instagram account (5k followers)', source: 'Managed Instagram account (5k followers)' }] },
    { index: 0, bullets: [{ text: 'Raised guest satisfaction score by 12%', source: 'Raised guest satisfaction score by 12%' }] },
  ],
  education: [{ index: 0 }],
  skills,
  changes: ['Marketing experience first.'],
});

const PARAGRAPH = 'Hudson Hotels builds its social media campaigns on guest feedback, which is exactly what I worked with at Hotel Lumière, where I raised guest satisfaction score by 12% while handling front-office operations. ';
const letter = (opening = 'Your Marketing Intern role caught my attention because it sits between guests and brand.') => ({
  greeting: 'Dear Hiring Team,',
  paragraphs: [opening, PARAGRAPH.repeat(4), 'At Brand & Co I managed an Instagram account (5k followers) using Canva. I am available from 2027-03-01 to 2027-08-31 for the full six months.', 'I would welcome the chance to discuss how I can support your marketing team.'],
  sign_off: 'Best regards,',
  claims: [{ statement: 'raised satisfaction', source: 'master_cv' as const, quote: 'Raised guest satisfaction score by 12%' }],
});

function fakeLlm(over: { plan?: unknown; letters?: unknown[] } = {}) {
  const letters = [...(over.letters ?? [letter()])];
  return new FakeLlm((req) => {
    if (req.prompt.includes('Tailor the candidate')) return over.plan ?? tailoredPlan();
    if (req.prompt.includes('Write a cover letter')) return letters.length > 1 ? letters.shift() : letters[0];
    return llmAnalysis();
  });
}

describe('document rendering', () => {
  it('PDF and DOCX resumes contain real, extractable text (ATS)', async () => {
    const pdfText = await extractText(await resumeToPdf(master), 'pdf');
    const docxText = await extractText(await resumeToDocx(master), 'docx');
    for (const t of [pdfText, docxText]) {
      expect(t).toContain('Alex Martin');
      expect(t).toContain('Hotel Lumière');
      expect(t).toContain('Jun 2025');
      expect(t).toContain('ESSEC Business School');
      expect(t).toContain('EXPERIENCE');
    }
    expect(resumeToText(master)).toContain('• Raised guest satisfaction score by 12%');
  });
});

describe('DocumentsService', () => {
  afterEach(() => setLlmProviderForTests(undefined));

  async function setup(analysisCategory: 'GREEN' | 'RED' = 'GREEN') {
    const db = testDb();
    const p = sampleProfile();
    p.motivations = 'I want to learn how large hotel groups run marketing in New York.';
    new ProfileService(db).save(p);
    new MasterCvService(db).createSnapshot();
    const job = await new JobSearchService(db).importManual({ url: 'https://hudson.example/jobs/1', company: 'Hudson Hotels', title: 'Marketing Intern', location: 'New York, NY', description: DESC });
    setLlmProviderForTests(new FakeLlm(() => (analysisCategory === 'GREEN' ? llmAnalysis() : llmAnalysis({ employment_type: 'full_time' }))));
    await new JobAnalysisService(db).analyze(job.id);
    return { db, jobId: job.id };
  }

  it('generates a tailored CV and a cover letter with files and metadata', async () => {
    const { db, jobId } = await setup();
    setLlmProviderForTests(fakeLlm());
    const svc = new DocumentsService(db);
    const { resume, letter: l } = await svc.generateForJob(jobId);

    expect(resume.version).toBe(1);
    expect(resume.checks.violations).toEqual([]);
    const cvDir = path.join(paths.generated(), 'cv', String(jobId));
    for (const f of ['resume.pdf', 'resume.docx', 'metadata.json']) expect(fs.existsSync(path.join(cvDir, f))).toBe(true);
    const meta = JSON.parse(fs.readFileSync(path.join(cvDir, 'metadata.json'), 'utf8'));
    expect(meta).toMatchObject({ jobId, version: 1, masterCvVersion: 1, truthCheck: 'passed' });
    expect(JSON.stringify(meta)).not.toContain('alex.martin@example.com');

    const letterDir = path.join(paths.generated(), 'cover-letters', String(jobId));
    for (const f of ['cover-letter.pdf', 'cover-letter.docx', 'cover-letter.txt']) expect(fs.existsSync(path.join(letterDir, f))).toBe(true);
    expect(l.text).toMatch(/^Dear Hiring Team,/);
    expect(l.text.trim().endsWith('Alex Martin')).toBe(true);
    expect(l.checks.issues).toEqual([]);
    const pdfText = await extractText(fs.readFileSync(path.join(letterDir, 'cover-letter.pdf')), 'pdf');
    expect(pdfText).toContain('Hudson Hotels');

    const app = db.select().from(applications).get()!;
    expect(app).toMatchObject({ status: 'COVER_LETTER_CREATED', resumeId: resume.id, coverLetterId: l.id, isSimulation: true, submittedAt: null });
  });

  it('removes skills taken from the job description before rendering', async () => {
    const { db, jobId } = await setup();
    setLlmProviderForTests(fakeLlm({ plan: tailoredPlan(['Excel', 'Salesforce']) }));
    const r = await new DocumentsService(db).generateResume(jobId);
    expect(r.content.skills.map((s) => s.name)).toEqual(['Excel', 'English', 'French']);
    expect(r.checks.repaired[0]!.type).toBe('UNKNOWN_SKILL');
  });

  it('rewrites a generic letter once, and flags it if still generic', async () => {
    const { db, jobId } = await setup();
    const generic = letter('I am writing to express my keen interest in the Marketing Intern position.');
    const llm = fakeLlm({ letters: [generic, letter()] });
    setLlmProviderForTests(llm);
    const ok = await new DocumentsService(db).generateCoverLetter(jobId);
    expect(ok.checks.stockPhrases).toEqual([]);
    expect(llm.requests.at(-1)!.prompt).toMatch(/previous draft had problems/);

    setLlmProviderForTests(fakeLlm({ letters: [generic, generic] }));
    const bad = await new DocumentsService(db).generateCoverLetter(jobId);
    expect(bad.version).toBe(2);
    expect(bad.checks.needsReview).toBe(true);
  });

  it('refuses RED offers unless forced, and requires an analysis', async () => {
    const { db, jobId } = await setup('RED');
    setLlmProviderForTests(fakeLlm());
    const svc = new DocumentsService(db);
    await expect(svc.generateResume(jobId)).rejects.toThrow(/RED/);
    expect((await svc.generateResume(jobId, { force: true })).version).toBe(1);
  });

  it('saves a letter edited by the user as a new version and re-checks it', async () => {
    const { db, jobId } = await setup();
    setLlmProviderForTests(fakeLlm());
    const svc = new DocumentsService(db);
    await svc.generateCoverLetter(jobId);
    const edited = await svc.saveEditedLetter(jobId, `Dear Hiring Team,\n\nHudson Hotels… I increased revenue by 300%.\n\n${PARAGRAPH.repeat(3)}\n\nBest regards,\nAlex Martin`);
    expect(edited.version).toBe(2);
    expect(edited.checks.inventedNumbers).toContain('300%');
    expect(svc.latest(jobId).coverLetter).toMatchObject({ version: 2, editedByUser: true });
  });

  it('generatePending only handles GREEN/YELLOW offers without documents', async () => {
    const { db } = await setup();
    setLlmProviderForTests(fakeLlm());
    const svc = new DocumentsService(db);
    expect(await svc.generatePending()).toMatchObject({ cvs: 1, letters: 1, errors: [] });
    expect(await svc.generatePending()).toMatchObject({ cvs: 0, letters: 0 });
  });

  it('API: generate, list and download', async () => {
    const { db, jobId } = await setup();
    setLlmProviderForTests(fakeLlm());
    const app = createApp(db);
    const gen = await request(app).post(`/api/jobs/${jobId}/documents`).send({ what: 'all', guidance: 'Emphasise hospitality' });
    expect(gen.status).toBe(201);
    expect(gen.body.resume.version).toBe(1);
    const pdf = await request(app).get(`/api/documents/resume/${gen.body.resume.id}/pdf`);
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-disposition']).toMatch(/resume-Hudson-Hotels-Marketing-Intern\.pdf/);
    expect((await request(app).get(`/api/documents/cover-letter/${gen.body.coverLetter.id}/txt`)).text).toMatch(/Dear Hiring Team/);
    expect((await request(app).get(`/api/documents/resume/${gen.body.resume.id}/txt`)).status).toBe(404);
    expect((await request(app).get('/api/documents/../../etc/passwd/pdf')).status).toBe(404);
    const put = await request(app).put(`/api/jobs/${jobId}/documents/cover-letter`).send({ text: `Dear Hiring Team,\n\n${PARAGRAPH.repeat(4)}\n\nBest regards,\nAlex Martin` });
    expect(put.body.coverLetter.version).toBe(2);
  });
});
