import { Router } from 'express';
import { count, eq, inArray, isNotNull } from 'drizzle-orm';
import type { Db } from '../../database/client.js';
import { applications, jobAnalysis, jobs, notifications } from '../../database/schema.js';
import { profileCompleteness } from '../../models/profile.js';
import { MasterCvService } from '../../services/master-cv.service.js';
import { ProfileService } from '../../services/profile.service.js';
import { SettingsService } from '../../services/settings.service.js';

/** Real counts from the database. Phases not built yet simply report 0. */
export function dashboardRoutes(db: Db): Router {
  const r = Router();
  r.get('/', (_req, res) => {
    const c = (q: { count: number } | undefined) => q?.count ?? 0;
    const settings = new SettingsService(db).get();
    const profile = new ProfileService(db).get();
    const master = new MasterCvService(db).latest();
    res.json({
      stats: {
        totalJobs: c(db.select({ count: count() }).from(jobs).get()),
        newJobs: c(db.select({ count: count() }).from(jobs).where(eq(jobs.status, 'FOUND')).get()),
        matchingJobs: c(db.select({ count: count() }).from(jobAnalysis).where(inArray(jobAnalysis.category, ['GREEN', 'YELLOW'])).get()),
        highMatch: c(db.select({ count: count() }).from(jobAnalysis).where(eq(jobAnalysis.category, 'GREEN')).get()),
        applicationsPrepared: c(db.select({ count: count() }).from(applications).where(eq(applications.status, 'READY_TO_APPLY')).get()),
        applicationsSubmitted: c(db.select({ count: count() }).from(applications).where(isNotNull(applications.submittedAt)).get()),
        needsValidation: c(db.select({ count: count() }).from(notifications).where(eq(notifications.level, 'action_required')).get()),
        interviews: c(db.select({ count: count() }).from(applications).where(eq(applications.status, 'INTERVIEW')).get()),
        offers: c(db.select({ count: count() }).from(applications).where(eq(applications.status, 'OFFER')).get()),
        rejected: c(db.select({ count: count() }).from(applications).where(eq(applications.status, 'REJECTED')).get()),
      },
      profile: profileCompleteness(profile),
      masterCv: master ? { version: master.version, createdAt: master.createdAt } : null,
      testMode: settings.automation.testMode,
      applicationMode: settings.automation.applicationMode,
    });
  });
  return r;
}
