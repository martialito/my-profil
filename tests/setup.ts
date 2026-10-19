import crypto from 'node:crypto';
import fs from 'node:fs';
import { afterAll } from 'vitest';
import { resetEnvCache } from '../src/config/env.js';
import { setLlmProviderForTests } from '../src/llm/index.js';
import { setEncryptionKeyForTests } from '../src/utils/crypto.js';

// Each test file gets its own scratch directory (files run in parallel workers).
const tmp = `tests/.tmp/${process.pid}-${crypto.randomUUID()}`;
process.env.DATA_DIR = `${tmp}/data`;
process.env.LOG_DIR = `${tmp}/logs`;
process.env.GENERATED_DIR = `${tmp}/generated`;
// Tests must never call a real LLM.
process.env.ANTHROPIC_API_KEY = '';
// Use the pre-installed Chromium when available (CI / cloud sandbox).
if (!process.env.BROWSER_EXECUTABLE_PATH && fs.existsSync('/opt/pw-browsers/chromium')) process.env.BROWSER_EXECUTABLE_PATH = '/opt/pw-browsers/chromium';
resetEnvCache();

setEncryptionKeyForTests(crypto.randomBytes(32));
setLlmProviderForTests(undefined);

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});
