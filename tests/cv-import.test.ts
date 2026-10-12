import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { findDateRange, parseCvDate } from '../src/cv/date-parsing.js';
import { extractProfileHeuristically } from '../src/cv/heuristic-extractor.js';
import { detectCvFileType, extractText } from '../src/cv/text-extraction.js';
import { CvImportService } from '../src/services/cv-import.service.js';
import { SAMPLE_CV_LINES, sampleDocx, samplePdf } from './fixtures/sample-cv.js';
import { testDb } from './helpers.js';

describe('CV date parsing', () => {
  it.each([
    ['Jun 2025', '2025-06'],
    ['juin 2025', '2025-06'],
    ['Février 2024', '2024-02'],
    ['09/2024', '2024-09'],
    ['2023', '2023'],
    ['2024-3', '2024-03'],
    ['Summer 2025', undefined],
  ])('parseCvDate(%s) = %s', (input, expected) => {
    expect(parseCvDate(input)).toBe(expected);
  });

  it('detects ranges including "present"', () => {
    expect(findDateRange('Sep 2023 – Present')).toMatchObject({ startDate: '2023-09', isCurrent: true });
    expect(findDateRange('Janvier 2024 à juin 2024')).toMatchObject({ startDate: '2024-01', endDate: '2024-06' });
    expect(findDateRange('No dates here')).toBeUndefined();
  });
});

describe('heuristic CV extraction', () => {
  const draft = extractProfileHeuristically(SAMPLE_CV_LINES.join('\n'));

  it('extracts contact details', () => {
    expect(draft.personal).toMatchObject({
      firstName: 'Alex',
      lastName: 'Martin',
      email: 'alex.martin@example.com',
      phone: '+33 6 12 34 56 78',
      linkedin: 'linkedin.com/in/alex-martin-example',
    });
    expect(draft.headline).toBe('Marketing & Hospitality Student');
  });

  it('extracts experiences with real dates and bullets only', () => {
    expect(draft.experiences).toHaveLength(2);
    expect(draft.experiences[0]).toMatchObject({
      title: 'Front Office Intern',
      company: 'Hotel Lumière',
      startDate: '2025-06',
      endDate: '2025-11',
      achievements: ['Raised guest satisfaction score by 12%', 'Handled 40 check-ins per day'],
    });
    expect(draft.experiences[1]).toMatchObject({ company: 'Brand & Co', startDate: '2024-01', endDate: '2024-06' });
  });

  it('extracts education, skills and languages', () => {
    expect(draft.education[0]).toMatchObject({ school: 'ESSEC Business School', degree: 'Master in Management', startDate: '2024-09', endDate: '2027-12' });
    expect(draft.skills.filter((s) => s.category === 'technical').map((s) => s.name)).toEqual(['Excel', 'Google Analytics', 'Canva']);
    expect(draft.skills.filter((s) => s.category === 'language').map((s) => s.name)).toEqual(['English (C1)', 'French (Native)']);
  });

  it('never fabricates work authorization and always asks for review', () => {
    expect(draft).not.toHaveProperty('workAuthorization');
    expect(draft.warnings.at(-1)).toMatch(/review every field/i);
  });
});

describe('file text extraction', () => {
  it('reads DOCX', async () => {
    const buf = await sampleDocx();
    expect(detectCvFileType(buf)).toBe('docx');
    const text = await extractText(buf, 'docx');
    expect(text).toContain('Hotel Lumière');
    expect(text).toContain('alex.martin@example.com');
  });

  it('reads PDF', async () => {
    const buf = await samplePdf();
    expect(detectCvFileType(buf)).toBe('pdf');
    const text = await extractText(buf, 'pdf');
    expect(text).toContain('Front Office Intern');
    expect(text).toContain('alex.martin@example.com');
  });

  it('rejects other file types by content, not extension', () => {
    expect(detectCvFileType(Buffer.from('hello world'))).toBeUndefined();
  });
});

describe('CvImportService', () => {
  it('stores the original intact, read-only, and returns a draft (profile untouched)', async () => {
    const db = testDb();
    const svc = new CvImportService(db);
    const buf = await samplePdf();
    const before = Buffer.from(buf);
    const res = await svc.import({ buffer: buf, originalname: 'my-cv.pdf' }, { useLlm: false });

    expect(res.method).toBe('heuristic');
    // PDF text loses blank lines: entries must still be split correctly
    expect(res.draft.experiences.map((e) => [e.company, e.startDate, e.endDate])).toEqual([
      ['Hotel Lumière', '2025-06', '2025-11'],
      ['Brand & Co', '2024-01', '2024-06'],
    ]);
    const stored = svc.originalFile(res.id);
    expect(fs.readFileSync(stored.absPath).equals(before)).toBe(true);
    expect(fs.statSync(stored.absPath).mode & 0o222).toBe(0);
    expect(svc.verifyIntegrity(res.id).intact).toBe(true);
    expect(path.basename(stored.absPath)).toBe(`${res.sha256}.pdf`);
    // extracted text is encrypted at rest
    const raw = db.$client.prepare('select extracted_text from cv_documents').get() as { extracted_text: string };
    expect(raw.extracted_text.startsWith('enc:v1:')).toBe(true);
  });

  it('refuses LLM extraction when no API key is configured', async () => {
    const svc = new CvImportService(testDb());
    await expect(svc.import({ buffer: await sampleDocx(), originalname: 'cv.docx' }, { useLlm: true })).rejects.toThrow(/ANTHROPIC_API_KEY/);
  });

  it('rejects unsupported files', async () => {
    const svc = new CvImportService(testDb());
    await expect(svc.import({ buffer: Buffer.from('not a cv at all'), originalname: 'cv.pdf' }, { useLlm: false })).rejects.toThrow(/only PDF and DOCX/);
  });
});
