/**
 * Functions evaluated inside the page (no closures over Node variables).
 * They only READ the page and tag fields with data-nia-id; they never submit anything.
 */

export interface RawField {
  id: string;
  label: string;
  name?: string;
  type: string;
  required: boolean;
  options: string[];
  optionIds: string[];
  autocomplete?: string;
}

export function detectFieldsInPage(): RawField[] {
  const out: RawField[] = [];
  let n = 0;
  const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
  const isVisible = (el: HTMLElement) => {
    if ((el as HTMLInputElement).type === 'file') return true; // often visually hidden behind a custom button
    const st = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return st.display !== 'none' && st.visibility !== 'hidden' && r.width > 0 && r.height > 0;
  };
  const labelOf = (el: HTMLElement): string => {
    const aria = el.getAttribute('aria-label');
    if (aria) return clean(aria);
    const by = el.getAttribute('aria-labelledby');
    if (by) {
      const t = by.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' ');
      if (clean(t)) return clean(t);
    }
    const labels = (el as HTMLInputElement).labels;
    if (labels && labels.length) return clean(labels[0]!.textContent);
    const wrap = el.closest('label');
    if (wrap) return clean(wrap.textContent);
    return clean(el.getAttribute('placeholder') ?? el.getAttribute('name') ?? '');
  };
  const isRequired = (el: HTMLElement, label: string) =>
    (el as HTMLInputElement).required || el.getAttribute('aria-required') === 'true' || /\*\s*$/.test(label);

  const radiosDone = new Set<string>();
  const nodes = Array.from(document.querySelectorAll<HTMLElement>('input, select, textarea'));
  for (const el of nodes) {
    const input = el as HTMLInputElement;
    const tag = el.tagName.toLowerCase();
    const type = tag === 'select' ? 'select' : tag === 'textarea' ? 'textarea' : (input.type || 'text').toLowerCase();
    if (['hidden', 'submit', 'button', 'reset', 'image', 'password', 'search'].includes(type)) continue;
    if (!isVisible(el) || input.disabled) continue;

    if (type === 'radio') {
      const group = input.name || `__radio_${n}`;
      if (radiosDone.has(group)) continue;
      radiosDone.add(group);
      const radios = input.name ? Array.from(document.querySelectorAll<HTMLInputElement>(`input[type=radio][name="${CSS.escape(input.name)}"]`)) : [input];
      const container = input.closest('fieldset, [role=radiogroup], .field, .form-group, li, div');
      const legend = container?.querySelector('legend, [role=heading], label:not(:has(input))');
      const label = clean(container?.getAttribute('aria-label') ?? legend?.textContent ?? input.name);
      const id = `nia-${n++}`;
      const optionIds: string[] = [];
      const options = radios.map((r, i) => {
        const oid = `${id}-o${i}`;
        r.setAttribute('data-nia-id', oid);
        optionIds.push(oid);
        return clean(r.labels?.[0]?.textContent ?? r.value);
      });
      out.push({ id, label, name: input.name, type: 'radio', required: radios.some((r) => r.required) || /\*\s*$/.test(label), options, optionIds });
      continue;
    }

    const id = `nia-${n++}`;
    el.setAttribute('data-nia-id', id);
    const label = labelOf(el);
    const options = tag === 'select' ? Array.from((el as HTMLSelectElement).options).filter((o) => o.value !== '' && !/^(select|choose|--)/i.test(o.text.trim())).map((o) => clean(o.text)) : [];
    out.push({ id, label, name: input.name || undefined, type, required: isRequired(el, label), options, optionIds: [], autocomplete: el.getAttribute('autocomplete') ?? undefined });
  }
  return out;
}

export interface Blocker {
  kind: 'captcha' | 'login' | 'mfa' | 'anti_bot';
  detail: string;
}

/** Detect protections the app must never try to get around. */
export function detectBlockersInPage(): Blocker | null {
  const text = (document.body?.innerText ?? '').slice(0, 20000);
  const frames = Array.from(document.querySelectorAll('iframe')).map((f) => f.getAttribute('src') ?? '');
  if (
    frames.some((s) => /recaptcha|hcaptcha|challenges\.cloudflare|turnstile|arkoselabs|funcaptcha|captcha/i.test(s)) ||
    document.querySelector('.g-recaptcha, .h-captcha, .cf-turnstile, [data-sitekey], #captcha, [id*=captcha i], [class*=captcha i]')
  ) {
    return { kind: 'captcha', detail: 'A CAPTCHA is present on the page.' };
  }
  if (/verify (that )?you are (a )?human|are you a robot|unusual traffic|access denied|request blocked/i.test(text)) {
    return { kind: 'anti_bot', detail: 'The site shows an anti-bot / access check.' };
  }
  if (/(verification|security|one[- ]time|2fa|two[- ]factor) code|authenticator app|multi[- ]factor/i.test(text) && document.querySelector('input')) {
    return { kind: 'mfa', detail: 'The site asks for a verification code (MFA).' };
  }
  const pwd = Array.from(document.querySelectorAll<HTMLInputElement>('input[type=password]')).some((p) => p.getBoundingClientRect().width > 0);
  if (pwd) return { kind: 'login', detail: 'The site asks you to sign in.' };
  return null;
}

/** Visible submit-like button (never clicked in test mode). */
export function findSubmitInPage(): string | null {
  const candidates = Array.from(document.querySelectorAll<HTMLElement>('button, input[type=submit], [role=button]'));
  const label = (el: HTMLElement) => ((el as HTMLInputElement).value || el.textContent || '').replace(/\s+/g, ' ').trim();
  const btn =
    candidates.find((b) => /^(submit|apply|send)\b|submit application|apply now|send application/i.test(label(b))) ??
    candidates.find((b) => (b as HTMLButtonElement).type === 'submit');
  document.querySelectorAll('[data-nia-submit]').forEach((e) => e.removeAttribute('data-nia-submit'));
  if (btn) btn.setAttribute('data-nia-submit', '1');
  return btn ? label(btn) || 'submit' : null;
}

export function pageTextInPage(): string {
  return `${document.title}\n${document.body?.innerText ?? ''}`.slice(0, 60000);
}

/** Read back the value currently in a field, to verify what was filled. */
export function readValueInPage(id: string): string {
  const el = document.querySelector<HTMLElement>(`[data-nia-id="${id}"]`);
  if (!el) {
    const checked = document.querySelector<HTMLInputElement>(`[data-nia-id^="${id}-o"]:checked`);
    return checked ? (checked.labels?.[0]?.textContent ?? checked.value).replace(/\s+/g, ' ').trim() : '';
  }
  if (el instanceof HTMLSelectElement) return el.selectedOptions[0]?.text.trim() ?? '';
  const input = el as HTMLInputElement;
  if (input.type === 'checkbox') return input.checked ? 'Yes' : 'No';
  if (input.type === 'file') return Array.from(input.files ?? []).map((f) => f.name).join(', ');
  return input.value;
}

export interface SubmissionOutcome {
  kind: 'confirmed' | 'form_errors' | 'unconfirmed';
  evidence: string;
}

/** After clicking submit: did the site confirm the submission, show validation errors, or neither? */
export function detectOutcomeInPage(): SubmissionOutcome {
  const text = (document.body?.innerText ?? '').replace(/\s+/g, ' ');
  const ok = text.match(/(thank(s| you)[^.]{0,80}(appl(y|ying|ication)|submission|interest)[^.]{0,120}\.?|(your )?application (has been |was )?(successfully )?(submitted|received|sent)[^.]{0,120}\.?|we(['’]ve| have) received your application[^.]{0,120}\.?)/i);
  if (ok) return { kind: 'confirmed', evidence: ok[0].trim().slice(0, 300) };
  const invalid = Array.from(document.querySelectorAll<HTMLElement>('[aria-invalid="true"], .error, .field-error, .invalid-feedback, [role="alert"]'))
    .map((e) => (e.innerText ?? '').trim())
    .filter((t) => t && /required|invalid|please|must|error/i.test(t));
  if (invalid.length) return { kind: 'form_errors', evidence: invalid.slice(0, 5).join(' | ').slice(0, 300) };
  return { kind: 'unconfirmed', evidence: text.slice(0, 200) };
}
