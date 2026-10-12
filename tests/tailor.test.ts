import { describe, expect, it } from 'vitest';
import { assembleTailoredCv, keywordStuffing, tailor, type LlmTailoredCv } from '../src/cv/tailor.js';
import { MasterCvContentSchema } from '../src/models/master-cv.js';
import { sampleProfile } from './helpers.js';

const master = MasterCvContentSchema.parse(sampleProfile());

function plan(over: Partial<LlmTailoredCv> = {}): LlmTailoredCv {
  return {
    headline: 'Hospitality & marketing student',
    summary: 'Business school student with front-office and social media experience, available for a 6-month NYC internship.',
    experiences: [
      { index: 1, bullets: [{ text: 'Grew and managed a brand Instagram account (5k followers)', source: 'Managed Instagram account (5k followers)' }] },
      { index: 0, bullets: [{ text: 'Improved guest satisfaction score by 12%', source: 'Raised guest satisfaction score by 12%' }] },
    ],
    education: [{ index: 0 }],
    skills: ['Social media marketing', 'Canva', 'Excel'],
    changes: ['Put marketing experience first.'],
    ...over,
  };
}

describe('tailored CV assembly', () => {
  it('copies facts from the Master CV and keeps the chosen order', () => {
    const { content } = assembleTailoredCv(master, plan());
    expect(content.experiences.map((e) => [e.company, e.startDate, e.endDate])).toEqual([
      ['Brand & Co', '2024-01', '2024-06'],
      ['Hotel Lumière', '2025-06', '2025-11'],
    ]);
    expect(content.personal).toEqual(master.personal);
    expect(content.workAuthorization).toEqual(master.workAuthorization);
    expect(content.skills.find((s) => s.name === 'Excel')?.category).toBe('technical');
    // Languages are kept even when the plan omits them
    expect(content.skills.filter((s) => s.category === 'language').map((s) => s.name)).toEqual(['English', 'French']);
  });

  it('ignores references to experiences that do not exist', () => {
    const { content, warnings } = assembleTailoredCv(master, plan({ experiences: [{ index: 7, bullets: [] }, { index: 0, bullets: [] }, { index: 0, bullets: [] }] }));
    expect(content.experiences).toHaveLength(1);
    expect(warnings).toHaveLength(2);
  });

  it('a clean plan passes the truth guard untouched', () => {
    const r = tailor(master, plan());
    expect(r.repaired).toEqual([]);
    expect(r.violations).toEqual([]);
  });

  it('removes skills copied from the job description', () => {
    const r = tailor(master, plan({ skills: ['Excel', 'Salesforce', 'Python'] }));
    expect(r.content.skills.map((s) => s.name)).toEqual(['Excel', 'English', 'French']);
    expect(r.repaired.map((v) => v.type)).toEqual(['UNKNOWN_SKILL', 'UNKNOWN_SKILL']);
    expect(r.violations).toEqual([]);
  });

  it('replaces bullets with invented figures by the original Master CV bullets', () => {
    const r = tailor(master, plan({ experiences: [{ index: 0, bullets: [{ text: 'Raised guest satisfaction by 40%', source: '' }] }] }));
    expect(r.content.experiences[0]!.achievements).toEqual(master.experiences[0]!.achievements);
    expect(r.repaired[0]!.type).toBe('INVENTED_NUMBER');
    expect(r.violations).toEqual([]);
  });

  it('falls back to the Master CV summary when the summary invents a figure', () => {
    const r = tailor(master, plan({ summary: 'Managed a team of 15 people.' }));
    expect(r.content.summary).toBe(master.summary);
  });

  it('detects keyword stuffing', () => {
    const content = { ...master, summary: 'marketing marketing marketing marketing marketing interest' };
    expect(keywordStuffing(content, ['Marketing', 'SEO'])).toHaveLength(1);
    expect(keywordStuffing(master, ['Marketing'])).toEqual([]);
  });
});
