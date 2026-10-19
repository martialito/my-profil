import { describe, expect, it } from 'vitest';
import { verifyAgainstMaster } from '../src/cv/truth-guard.js';
import { MasterCvContentSchema, type MasterCvContent } from '../src/models/master-cv.js';
import { MasterCvService } from '../src/services/master-cv.service.js';
import { ProfileService } from '../src/services/profile.service.js';
import { sampleProfile, testDb } from './helpers.js';

const master = (): MasterCvContent => MasterCvContentSchema.parse(sampleProfile());
const clone = (m: MasterCvContent): MasterCvContent => structuredClone(m);

describe('Master CV versions', () => {
  it('refuses to snapshot an incomplete profile', () => {
    expect(() => new MasterCvService(testDb()).createSnapshot()).toThrow(/required/);
  });

  it('creates immutable incrementing versions', () => {
    const db = testDb();
    const profiles = new ProfileService(db);
    const svc = new MasterCvService(db);
    profiles.save(sampleProfile());
    const v1 = svc.createSnapshot({ notes: 'initial' });
    expect(v1.version).toBe(1);

    const p = sampleProfile();
    p.summary = 'Updated summary';
    profiles.save(p);
    const v2 = svc.createSnapshot();
    expect(v2.version).toBe(2);

    expect(svc.getVersion(1).content.summary).toBe('Master student looking for a 6-month internship in New York.');
    expect(svc.latest()?.content.summary).toBe('Updated summary');
    expect(svc.list().map((v) => v.version)).toEqual([2, 1]);
    expect('preferences' in svc.latest()!.content).toBe(false);
  });

  it('stores Master CV content encrypted at rest', () => {
    const db = testDb();
    new ProfileService(db).save(sampleProfile());
    new MasterCvService(db).createSnapshot();
    const raw = db.$client.prepare('select content from resumes').get() as { content: string };
    expect(raw.content.startsWith('enc:v1:')).toBe(true);
  });
});

describe('truth guard (tailored CV vs Master CV)', () => {
  it('accepts reordering, selection, shortening and rephrasing', () => {
    const m = master();
    const t = clone(m);
    t.experiences = [t.experiences[1]!, t.experiences[0]!];
    t.experiences[1]!.achievements = ['Improved guest satisfaction by 12%'];
    t.summary = 'Hospitality-minded marketing student available for a 6-month NYC internship.';
    t.skills = t.skills.filter((s) => s.name !== 'Excel');
    expect(verifyAgainstMaster(m, t)).toEqual([]);
  });

  it('rejects an invented experience', () => {
    const t = clone(master());
    t.experiences.push({ company: 'Google', title: 'Marketing Intern', isCurrent: false, achievements: [], technologies: [], skills: [] });
    expect(verifyAgainstMaster(master(), t).map((v) => v.type)).toContain('UNKNOWN_EXPERIENCE');
  });

  it('rejects altered dates', () => {
    const t = clone(master());
    t.experiences[0]!.startDate = '2025-01';
    expect(verifyAgainstMaster(master(), t).map((v) => v.type)).toEqual(['ALTERED_DATES']);
  });

  it('rejects an invented degree', () => {
    const t = clone(master());
    t.education[0]!.degree = 'MBA';
    expect(verifyAgainstMaster(master(), t).map((v) => v.type)).toContain('UNKNOWN_EDUCATION');
  });

  it('rejects a skill copied from a job description', () => {
    const t = clone(master());
    t.skills.push({ category: 'technical', name: 'Salesforce' });
    expect(verifyAgainstMaster(master(), t)).toEqual([
      { type: 'UNKNOWN_SKILL', message: 'Skill "salesforce" is not present in the Master CV' },
    ]);
  });

  it('accepts a skill that appears in an experience technology list', () => {
    const t = clone(master());
    t.skills.push({ category: 'technical', name: 'Canva' });
    expect(verifyAgainstMaster(master(), t)).toEqual([]);
  });

  it('rejects invented figures/results', () => {
    const t = clone(master());
    t.experiences[0]!.achievements = ['Raised guest satisfaction score by 35%'];
    expect(verifyAgainstMaster(master(), t).map((v) => v.type)).toEqual(['INVENTED_NUMBER']);
  });

  it('rejects any change to work authorization', () => {
    const t = clone(master());
    t.workAuthorization = { ...t.workAuthorization, requiresSponsorship: 'no' };
    expect(verifyAgainstMaster(master(), t).map((v) => v.type)).toEqual(['ALTERED_WORK_AUTHORIZATION']);
  });
});
