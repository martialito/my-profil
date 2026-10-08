import { describe, expect, it } from 'vitest';
import { candidateProfiles } from '../src/database/schema.js';
import { profileCompleteness } from '../src/models/profile.js';
import { ProfileService } from '../src/services/profile.service.js';
import { sampleProfile, testDb } from './helpers.js';

describe('candidate profile', () => {
  it('starts empty and incomplete', () => {
    const p = new ProfileService(testDb()).get();
    expect(p.experiences).toEqual([]);
    expect(p.workAuthorization.authorizedToWorkInUS).toBeUndefined();
    expect(profileCompleteness(p).score).toBe(0);
  });

  it('saves and reloads a full profile, preserving order', () => {
    const svc = new ProfileService(testDb());
    const saved = svc.save(sampleProfile());
    expect(saved.personal.email).toBe('alex.martin@example.com');
    expect(saved.experiences.map((e) => e.company)).toEqual(['Hotel Lumière', 'Brand & Co']);
    expect(saved.experiences[0]!.achievements).toHaveLength(2);
    expect(saved.skills.find((s) => s.name === 'English')?.level).toBe('C1');
    expect(saved.preferences.minimumScore).toBe(80);
    expect(saved.workAuthorization.requiresSponsorship).toBe('yes');
    expect(profileCompleteness(saved).score).toBe(100);
  });

  it('encrypts personal information at rest', () => {
    const db = testDb();
    new ProfileService(db).save(sampleProfile());
    const raw = db.$client.prepare('select first_name, email, phone, work_authorization from candidate_profiles').get() as Record<string, string>;
    for (const v of Object.values(raw)) {
      expect(v.startsWith('enc:v1:')).toBe(true);
    }
    expect(JSON.stringify(raw)).not.toContain('alex');
    // Drizzle reads decrypt transparently
    expect(db.select().from(candidateProfiles).get()?.email).toBe('alex.martin@example.com');
  });

  it('replaces sub-lists on save (removal works)', () => {
    const svc = new ProfileService(testDb());
    svc.save(sampleProfile());
    const p = sampleProfile();
    p.experiences = p.experiences!.slice(0, 1);
    expect(svc.save(p).experiences).toHaveLength(1);
  });

  it('rejects invalid data', () => {
    const svc = new ProfileService(testDb());
    expect(() => svc.save({ personal: { email: 'not-an-email' } })).toThrow(/Invalid profile/);
    expect(() => svc.save({ experiences: [{ company: 'X', title: 'Y', startDate: 'March 2027' }] })).toThrow();
    expect(() => svc.save({ experiences: [{ company: '', title: 'Y' }] })).toThrow();
  });

  it('treats empty strings as missing (never stores fake blanks)', () => {
    const p = new ProfileService(testDb()).save({ personal: { firstName: '  ', email: '' }, education: [{ school: 'X', gpa: '' }] });
    expect(p.personal.firstName).toBeUndefined();
    expect(p.personal.email).toBeUndefined();
    expect(p.education[0]!.gpa).toBeUndefined();
  });
});
