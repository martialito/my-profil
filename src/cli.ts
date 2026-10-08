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

const PLANNED: Record<string, { phase: number; description: string }> = {
  search: { phase: 2, description: 'search new internship offers from enabled sources' },
  analyze: { phase: 3, description: 'score jobs against the Master CV with Claude' },
  generate: { phase: 4, description: 'generate tailored CVs and cover letters' },
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
  default: {
    const planned = cmd ? PLANNED[cmd] : undefined;
    if (planned) {
      console.error(`"${cmd}" (${planned.description}) is not implemented yet — planned for Phase ${planned.phase}.`);
      process.exit(2);
    }
    console.error(`Unknown command "${cmd ?? ''}". Available: gen-key, migrate, status, ${Object.keys(PLANNED).join(', ')}`);
    process.exit(1);
  }
}
