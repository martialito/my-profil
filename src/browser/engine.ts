import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import type { FillPlan, FormField, FieldType } from '../application/form-plan.js';
import { env } from '../config/env.js';
import crypto from 'node:crypto';
import { detectBlockersInPage, detectFieldsInPage, detectOutcomeInPage, findSubmitInPage, pageTextInPage, readValueInPage, type Blocker, type RawField, type SubmissionOutcome } from './page-scripts.js';

/**
 * Controlled browser for application pages (section 11).
 * Phase 6 only SIMULATES: it opens the page, fills what is known, uploads the documents, takes a screenshot
 * and reports exactly what would be sent. It never clicks the submit button.
 * It stops on CAPTCHA, anti-bot pages, sign-in and MFA and asks you to intervene — never tries to get around them.
 */

export interface BrowserOptions {
  headless: boolean;
  persistentProfileDir?: string;
  slowMoMs: number;
  timeoutMs: number;
}

export interface FilledField {
  fieldId: string;
  label: string;
  intended: string;
  actual: string;
  source: string;
  verified: boolean;
}

export interface SimulationResult {
  status: 'blocked' | 'needs_input' | 'simulated' | 'error' | 'aborted' | 'submitted' | 'form_errors' | 'unconfirmed';
  /** Fingerprint of exactly what was filled (labels + values read back). Submission requires the one you reviewed. */
  digest?: string;
  /** Set only when the submit button was actually clicked. */
  submission?: { clickedAt: string; outcome: SubmissionOutcome; confirmationUrl: string; afterScreenshotPath?: string };
  abortReason?: string;
  url: string;
  finalUrl?: string;
  blocker?: Blocker;
  error?: string;
  fields: FormField[];
  plan?: FillPlan;
  filled: FilledField[];
  submitButton?: string | null;
  screenshotPath?: string;
  pageText?: string;
  durationMs: number;
}

/**
 * Run a page script. TypeScript/esbuild may add a `__name` helper to compiled functions, which does not exist
 * inside the page: the function is therefore sent as source code with a no-op shim.
 */
function inPage<R>(page: Page, fn: (...args: never[]) => R, arg?: unknown): Promise<R> {
  const call = arg === undefined ? '()' : `(${JSON.stringify(arg)})`;
  return page.evaluate(`(() => { const __name = (f) => f; return (${fn.toString()})${call}; })()`) as Promise<R>;
}

const FIELD_TYPES: FieldType[] = ['text', 'email', 'tel', 'url', 'number', 'date', 'textarea', 'select', 'radio', 'checkbox', 'file'];

function toFormField(r: RawField): FormField & { optionIds: string[] } {
  return { id: r.id, label: r.label, name: r.name, type: (FIELD_TYPES as string[]).includes(r.type) ? (r.type as FieldType) : 'text', required: r.required, options: r.options, optionIds: r.optionIds, autocomplete: r.autocomplete };
}

async function open(opts: BrowserOptions): Promise<{ context: BrowserContext; browser?: Browser }> {
  const executablePath = env().BROWSER_EXECUTABLE_PATH || undefined;
  if (opts.persistentProfileDir) {
    fs.mkdirSync(opts.persistentProfileDir, { recursive: true, mode: 0o700 });
    const context = await chromium.launchPersistentContext(opts.persistentProfileDir, { headless: opts.headless, executablePath, slowMo: opts.slowMoMs });
    return { context };
  }
  const browser = await chromium.launch({ headless: opts.headless, executablePath, slowMo: opts.slowMoMs });
  return { context: await browser.newContext(), browser };
}

async function applyItem(page: Page, field: FormField & { optionIds: string[] }, value: string): Promise<void> {
  const loc = page.locator(`[data-nia-id="${field.id}"]`);
  switch (field.type) {
    case 'select':
      await loc.selectOption({ label: value });
      return;
    case 'radio': {
      const idx = field.options.indexOf(value);
      if (idx < 0) throw new Error(`Option "${value}" not found`);
      await page.locator(`[data-nia-id="${field.optionIds[idx]}"]`).check();
      return;
    }
    case 'checkbox':
      if (/^yes$/i.test(value)) await loc.check();
      else await loc.uncheck();
      return;
    case 'file':
      await loc.setInputFiles(value);
      return;
    default:
      await loc.fill(value);
  }
}

export function fillDigest(filled: FilledField[]): string {
  const canonical = filled.map((f) => [f.label, f.actual]).sort((a, b) => a[0]!.localeCompare(b[0]!));
  return crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex').slice(0, 16);
}

/**
 * Real submission parameters (Phase 7). The button is clicked ONLY if every guard passes:
 * complete plan, every value read back identical, same digest as the one you reviewed, and the final check.
 */
export interface SubmitGuard {
  expectedDigest: string;
  /** Final check computed on the live page; must return null to allow the click, or the reason to abort. */
  beforeClick: (plan: FillPlan, pageText: string) => string | null;
  afterScreenshotPath: string;
}

export async function simulateApplication(params: {
  url: string;
  plan: (fields: FormField[]) => FillPlan;
  screenshotPath: string;
  options: BrowserOptions;
  submit?: SubmitGuard;
}): Promise<SimulationResult> {
  const started = Date.now();
  const result: SimulationResult = { status: 'error', url: params.url, fields: [], filled: [], durationMs: 0 };
  let session: { context: BrowserContext; browser?: Browser } | undefined;
  try {
    session = await open(params.options);
    const page = session.context.pages()[0] ?? (await session.context.newPage());
    page.setDefaultTimeout(params.options.timeoutMs);
    await page.goto(params.url, { waitUntil: 'domcontentloaded', timeout: params.options.timeoutMs });
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
    result.finalUrl = page.url();

    const blocker = await inPage(page, detectBlockersInPage);
    result.pageText = await inPage(page, pageTextInPage);
    if (blocker) {
      result.status = 'blocked';
      result.blocker = blocker;
      await page.screenshot({ path: params.screenshotPath, fullPage: true }).then(() => (result.screenshotPath = params.screenshotPath)).catch(() => undefined);
      return result;
    }

    const fields = (await inPage(page, detectFieldsInPage)).map(toFormField);
    result.fields = fields.map(({ optionIds: _o, ...f }) => f);
    const plan = params.plan(result.fields);
    result.plan = plan;

    for (const item of plan.items) {
      if (item.status !== 'ready' || item.value === undefined) continue;
      const field = fields.find((f) => f.id === item.field.id)!;
      try {
        await applyItem(page, field, item.value);
        const actual = await inPage(page, readValueInPage as (...args: never[]) => string, field.id);
        const expected = field.type === 'file' ? path.basename(item.value) : field.type === 'checkbox' ? (/^yes$/i.test(item.value) ? 'Yes' : 'No') : item.value;
        result.filled.push({ fieldId: field.id, label: field.label, intended: item.value, actual, source: item.source, verified: actual.trim() === expected.trim() });
      } catch (err) {
        result.filled.push({ fieldId: field.id, label: field.label, intended: item.value, actual: '', source: item.source, verified: false });
        item.status = 'needs_input';
        item.reason = `Could not fill this field automatically: ${(err as Error).message.split('\n')[0]}`;
        plan.needsInput.push(item);
        plan.complete = false;
      }
    }

    result.submitButton = await inPage(page, findSubmitInPage);
    result.digest = fillDigest(result.filled);
    fs.mkdirSync(path.dirname(params.screenshotPath), { recursive: true });
    await page.screenshot({ path: params.screenshotPath, fullPage: true });
    result.screenshotPath = params.screenshotPath;
    result.status = plan.complete ? 'simulated' : 'needs_input';
    if (!params.submit || result.status !== 'simulated') return result;

    // ── Phase 7: guarded real submission ──
    const abort = (reason: string) => {
      result.status = 'aborted';
      result.abortReason = reason;
      return result;
    };
    if (!result.submitButton) return abort('No submit button found on the page.');
    if (result.filled.some((f) => !f.verified)) return abort('A field did not keep the intended value (read-back check failed).');
    if (result.digest !== params.submit.expectedDigest) return abort('The form or the values changed since you reviewed the simulation: please review again.');
    const blockedNow = await inPage(page, detectBlockersInPage);
    if (blockedNow) return abort(blockedNow.detail);
    const guard = params.submit.beforeClick(plan, await inPage(page, pageTextInPage));
    if (guard) return abort(guard);

    const clickedAt = new Date().toISOString();
    await page.locator('[data-nia-submit="1"]').first().click();
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
    await page.waitForTimeout(1500);
    const after = await inPage(page, detectBlockersInPage);
    const outcome: SubmissionOutcome = after ? { kind: 'unconfirmed', evidence: after.detail } : await inPage(page, detectOutcomeInPage);
    await page.screenshot({ path: params.submit.afterScreenshotPath, fullPage: true }).catch(() => undefined);
    result.submission = { clickedAt, outcome, confirmationUrl: page.url(), afterScreenshotPath: params.submit.afterScreenshotPath };
    result.finalUrl = page.url();
    result.status = outcome.kind === 'confirmed' ? 'submitted' : outcome.kind === 'form_errors' ? 'form_errors' : 'unconfirmed';
    return result;
  } catch (err) {
    result.status = 'error';
    result.error = (err as Error).message.split('\n')[0];
    return result;
  } finally {
    result.durationMs = Date.now() - started;
    await session?.context.close().catch(() => undefined);
    await session?.browser?.close().catch(() => undefined);
  }
}
