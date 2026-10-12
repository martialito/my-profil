import fs from 'node:fs';
import path from 'node:path';
import { paths } from '../config/env.js';

/** Prompts live in /prompts/*.txt so they can be edited without touching code. */
export function loadPrompt(name: string): string {
  if (!/^[a-z0-9-]+$/.test(name)) throw new Error(`Invalid prompt name "${name}"`);
  return fs.readFileSync(path.join(paths.prompts(), `${name}.txt`), 'utf8');
}

/** Replace {{var}} placeholders. Throws if a placeholder has no value (avoids silent empty prompts). */
export function renderPrompt(template: string, vars: Record<string, string | number>): string {
  const missing = new Set<string>();
  const out = template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key: string) => {
    if (!(key in vars)) {
      missing.add(key);
      return '';
    }
    return String(vars[key]);
  });
  if (missing.size) throw new Error(`Missing prompt variables: ${[...missing].join(', ')}`);
  return out;
}
