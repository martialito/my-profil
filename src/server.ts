import path from 'node:path';
import { createApp } from './api/app.js';
import { env } from './config/env.js';
import { getDb } from './database/client.js';
import { ensureDefaultUser } from './services/user.service.js';
import { encrypt } from './utils/crypto.js';
import { logger } from './utils/logger.js';

// Fail fast with a clear message if ENCRYPTION_KEY is missing or malformed.
encrypt('startup-check');

const db = getDb();
ensureDefaultUser(db);
const app = createApp(db, { staticDir: path.resolve('dist/frontend') });
const { HOST, PORT, TEST_MODE } = env();

app.listen(PORT, HOST, () => {
  logger.info(`API listening on http://${HOST}:${PORT}${TEST_MODE ? ' (TEST MODE: no application will ever be submitted)' : ''}`);
});
