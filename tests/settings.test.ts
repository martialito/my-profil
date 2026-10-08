import { describe, expect, it } from 'vitest';
import { classifyScore, defaultSettings } from '../src/models/settings.js';
import { SettingsService } from '../src/services/settings.service.js';
import { testDb } from './helpers.js';

describe('settings', () => {
  it('has safe defaults matching the brief', () => {
    const s = defaultSettings();
    expect(s.search.availabilityStart).toBe('2027-03-01');
    expect(s.search.availabilityEnd).toBe('2027-08-31');
    expect(s.search.internshipOnly).toBe(true);
    expect(s.classification).toEqual({ greenMin: 90, yellowMin: 75 });
    expect(s.automation.applicationMode).toBe('SEMI_AUTO');
    expect(s.automation.testMode).toBe(true);
    expect(s.automation.maxApplicationsPerDay).toBe(20);
    expect(s.automation.dailySearchTime).toBe('08:00');
  });

  it('classifies scores with configurable thresholds', () => {
    const c = defaultSettings().classification;
    expect(classifyScore(95, c)).toBe('GREEN');
    expect(classifyScore(90, c)).toBe('GREEN');
    expect(classifyScore(89, c)).toBe('YELLOW');
    expect(classifyScore(75, c)).toBe('YELLOW');
    expect(classifyScore(74, c)).toBe('RED');
    expect(classifyScore(85, { greenMin: 85, yellowMin: 60 })).toBe('GREEN');
  });

  it('persists partial updates per section and validates them', () => {
    const svc = new SettingsService(testDb());
    svc.update('classification', { greenMin: 92 });
    expect(svc.get().classification).toEqual({ greenMin: 92, yellowMin: 75 });
    expect(() => svc.update('classification', { greenMin: 50 })).toThrow(/Invalid classification/);
    expect(() => svc.update('automation', { dailySearchTime: '25:00' })).toThrow();
    svc.update('automation', { maxApplicationsPerDay: 5 });
    expect(svc.get().automation.maxApplicationsPerDay).toBe(5);
    svc.reset('automation');
    expect(svc.get().automation.maxApplicationsPerDay).toBe(20);
  });

  it('forces test mode on while TEST_MODE env is true', () => {
    const svc = new SettingsService(testDb());
    svc.update('automation', { testMode: false });
    expect(svc.get().automation.testMode).toBe(true);
  });
});
