import 'dotenv/config';
import path from 'node:path';
import { z } from 'zod';

const booleanString = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().positive().default(3001),
  DATABASE_URL: z.string().default('./data/app.db'),
  ENCRYPTION_KEY: z.string().optional(),
  LLM_PROVIDER: z.enum(['anthropic']).default('anthropic'),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().optional(),
  DATA_DIR: z.string().default('./data'),
  GENERATED_DIR: z.string().default('./generated'),
  LOG_DIR: z.string().default('./logs'),
  TEST_MODE: booleanString.default(true),
  /** Optional: use a specific Chromium binary instead of the one installed by `npx playwright install chromium`. */
  BROWSER_EXECUTABLE_PATH: z.string().optional(),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | undefined;

/** Parsed, validated environment. Values are read once and cached. */
export function env(): Env {
  if (!cached) {
    const parsed = EnvSchema.safeParse(process.env);
    if (!parsed.success) {
      throw new Error(`Invalid environment configuration:\n${z.prettifyError(parsed.error)}`);
    }
    cached = parsed.data;
  }
  return cached;
}

/** Test helper: forget the cached env so changes to process.env are picked up. */
export function resetEnvCache(): void {
  cached = undefined;
}

export const PROJECT_ROOT = process.cwd();

export function resolveFromRoot(p: string): string {
  return path.isAbsolute(p) ? p : path.resolve(PROJECT_ROOT, p);
}

export const paths = {
  data: () => resolveFromRoot(env().DATA_DIR),
  uploads: () => path.join(resolveFromRoot(env().DATA_DIR), 'uploads'),
  generated: () => resolveFromRoot(env().GENERATED_DIR),
  logs: () => resolveFromRoot(env().LOG_DIR),
  browserProfile: () => resolveFromRoot('browser-profile'),
  prompts: () => resolveFromRoot('prompts'),
  migrations: () => resolveFromRoot('src/database/migrations'),
};
