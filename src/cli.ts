/**
 * Command-line entry point: `npm run <command>`.
 * Commands belonging to later phases are declared here but refuse to run until implemented,
 * so that nothing pretends to work.
 */
import { closeDb, getDb } from './database/client.js';
import { MasterCvService } from './services/master-cv.service.js';
import { ProfileService } from './services/profile.service.js';
import { SettingsService } from './services/settings.service.js';
import { profileCompleteness } from './models/profile.js';
import { generateKey } from './utils/crypto.js';
import { JobSearchService } from './services/job-search.service.js';
import { JobAnalysisService } from './services/job-analysis.service.js';
import { DocumentsService } from './services/documents.service.js';

const PLANNED: Record<string, { phase: number; description: string }> = {
  'dry-run': { phase: 6, description: 'full pipeline with simulated submission (nothing is sent)' },
  apply: { phase: 7, description: 'submit applications (requires validation)' },
};

function status(): void {
  const db = getDb();
  const settings = new SettingsService(db).get();
  const profile = new ProfileService(db).get();
  const master = new MasterCvService(db).latest();
  const c = profileCompleteness(profile);
  console.log('NYC Internship Agent — status');
  console.log(`  Profile completeness : ${c.score}%${c.missing.length ? ` (missing: ${c.missing.join(', ')})` : ''}`);
  console.log(`  Master CV            : ${master ? `v${master.version} (${master.createdAt})` : 'none yet'}`);
  console.log(`  Availability         : ${settings.search.availabilityStart} → ${settings.search.availabilityEnd}`);
  console.log(`  Application mode     : ${settings.automation.applicationMode}`);
  console.log(`  Test mode            : ${settings.automation.testMode ? 'ON (no real submission)' : 'OFF'}`);
  closeDb();
}

const [cmd] = process.argv.slice(2);
switch (cmd) {
  case 'gen-key':
    console.log(generateKey());
    break;
  case 'migrate':
    getDb();
    closeDb();
    console.log('Database migrated.');
    break;
  case 'status':
    status();
    break;
  case 'analyze': {
    const db = getDb();
    const limitArg = process.argv.find((a) => a.startsWith('--limit='));
    const summary = await new JobAnalysisService(db).analyzePending({ limit: limitArg ? Number(limitArg.split('=')[1]) : 50 });
    console.log(JSON.stringify(summary, null, 2));
    closeDb();
    if (summary.errors.length && summary.analyzed === 0) process.exit(1);
    break;
  }
  case 'generate': {
    const db = getDb();
    const limitArg = process.argv.find((a) => a.startsWith('--limit='));
    const summary = await new DocumentsService(db).generatePending({ limit: limitArg ? Number(limitArg.split('=')[1]) : 20 });
    console.log(JSON.stringify(summary, null, 2));
    closeDb();
    if (summary.errors.length && summary.cvs === 0) process.exit(1);
    break;
  }
  case 'search': {
    const db = getDb();
    const svc = new JobSearchService(db);
    if (svc.listBoards().filter((b) => b.enabled).length === 0) {
      console.error('No company board configured. Add Greenhouse/Lever boards in the "Sources" page first.');
      closeDb();
      process.exit(1);
    }
    const res = await svc.run('cli');
    console.log(JSON.stringify(res.stats, null, 2));
    for (const e of res.errors) console.error(`[ERROR] ${e.board}: ${e.reason}`);
    closeDb();
    break;
  }
  default: {
    const planned = cmd ? PLANNED[cmd] : undefined;
    if (planned) {
      console.error(`"${cmd}" (${planned.description}) is not implemented yet — planned for Phase ${planned.phase}.`);
      process.exit(2);
    }
    console.error(`Unknown command "${cmd ?? ''}". Available: gen-key, migrate, status, search, analyze [--limit=N], generate [--limit=N], ${Object.keys(PLANNED).join(', ')}`);
    process.exit(1);
  }
}
