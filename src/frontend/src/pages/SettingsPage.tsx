import { useEffect, useState, type ReactNode } from 'react';
import type { Settings, SettingsSection } from '../../../models/settings';
import { ApplicationModes } from '../../../models/common';
import { api } from '../api';
import { Card, CsvInput, Field, Notice } from '../components';

export function SettingsPage() {
  const [s, setS] = useState<Settings>();
  const [envInfo, setEnvInfo] = useState<{ testModeForced: boolean; llmConfigured: boolean }>();
  const [msg, setMsg] = useState<{ kind: 'error' | 'success'; text: string }>();

  useEffect(() => {
    api.getSettings()
      .then((r) => {
        setS(r.settings);
        setEnvInfo(r.env);
      })
      .catch((e: Error) => setMsg({ kind: 'error', text: e.message }));
  }, []);

  if (!s) return msg ? <Notice kind="error">{msg.text}</Notice> : <p>Loading…</p>;

  const patch = <K extends SettingsSection>(k: K, v: Partial<Settings[K]>) => setS({ ...s, [k]: { ...s[k], ...v } });
  const save = async (k: SettingsSection) => {
    setMsg(undefined);
    try {
      const r = await api.saveSettings(k, s[k]);
      setS(r.settings);
      setMsg({ kind: 'success', text: `${k} settings saved.` });
    } catch (e) {
      setMsg({ kind: 'error', text: (e as Error).message });
    }
  };
  const reset = async (k: SettingsSection) => {
    const r = await api.resetSettings(k);
    setS(r.settings);
    setMsg({ kind: 'success', text: `${k} settings reset to defaults.` });
  };
  const actions = (k: SettingsSection): ReactNode => (
    <>
      <button className="secondary" onClick={() => reset(k)}>Reset</button>
      <button onClick={() => save(k)}>Save</button>
    </>
  );
  const num = (v: string) => Number(v);

  return (
    <>
      <h1>Settings</h1>
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}

      <Card title="Search" actions={actions('search')}>
        <div className="grid">
          <Field label="Locations" wide><CsvInput value={s.search.locations} onChange={(v) => patch('search', { locations: v })} /></Field>
          <Field label="Availability start" hint="YYYY-MM-DD"><input value={s.search.availabilityStart} onChange={(e) => patch('search', { availabilityStart: e.target.value })} /></Field>
          <Field label="Availability end" hint="YYYY-MM-DD"><input value={s.search.availabilityEnd} onChange={(e) => patch('search', { availabilityEnd: e.target.value })} /></Field>
          <Field label="Minimum duration (months)"><input type="number" value={s.search.minimumDurationMonths} onChange={(e) => patch('search', { minimumDurationMonths: num(e.target.value) })} /></Field>
          <Field label="Ideal duration (months)"><input type="number" value={s.search.idealDurationMonths} onChange={(e) => patch('search', { idealDurationMonths: num(e.target.value) })} /></Field>
          <Field label="Industries"><CsvInput value={s.search.industries} onChange={(v) => patch('search', { industries: v })} placeholder="Marketing, Hospitality, Tourism" /></Field>
          <Field label="Job titles"><CsvInput value={s.search.jobTitles} onChange={(v) => patch('search', { jobTitles: v })} placeholder="Marketing Intern, Operations Intern" /></Field>
          <Field label="Minimum score"><input type="number" min={0} max={100} value={s.search.minimumScore} onChange={(e) => patch('search', { minimumScore: num(e.target.value) })} /></Field>
          <Field label="Internships only" hint="Never apply to full-time/permanent/senior/manager roles">
            <input type="checkbox" checked={s.search.internshipOnly} onChange={(e) => patch('search', { internshipOnly: e.target.checked })} />
          </Field>
        </div>
      </Card>

      <Card title="Classification thresholds" actions={actions('classification')}>
        <div className="grid">
          <Field label="GREEN from score" hint="Auto-apply allowed (if mode permits)"><input type="number" value={s.classification.greenMin} onChange={(e) => patch('classification', { greenMin: num(e.target.value) })} /></Field>
          <Field label="YELLOW from score" hint="Prepare, then ask for validation"><input type="number" value={s.classification.yellowMin} onChange={(e) => patch('classification', { yellowMin: num(e.target.value) })} /></Field>
        </div>
        <p className="muted">Below YELLOW → RED: no application is prepared automatically.</p>
      </Card>

      <Card title="Automation" actions={actions('automation')}>
        {envInfo?.testModeForced && <Notice kind="info">TEST_MODE=true in .env: test mode is forced ON whatever the setting below.</Notice>}
        <div className="grid">
          <Field label="Application mode" hint="FULL_AUTO is not activated in this version: it behaves like SEMI_AUTO (your click is always required).">
            <select value={s.automation.applicationMode} onChange={(e) => patch('automation', { applicationMode: e.target.value as Settings['automation']['applicationMode'] })}>
              {ApplicationModes.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </Field>
          <Field label="Auto-submit threshold"><input type="number" value={s.automation.autoSubmitThreshold} onChange={(e) => patch('automation', { autoSubmitThreshold: num(e.target.value) })} /></Field>
          <Field label="Daily search time" hint="Scheduler arrives in a later phase"><input type="time" value={s.automation.dailySearchTime} onChange={(e) => patch('automation', { dailySearchTime: e.target.value })} /></Field>
          <Field label="Daily automation enabled"><input type="checkbox" checked={s.automation.dailyAutomationEnabled} onChange={(e) => patch('automation', { dailyAutomationEnabled: e.target.checked })} /></Field>
          <Field label="Max applications per day"><input type="number" value={s.automation.maxApplicationsPerDay} onChange={(e) => patch('automation', { maxApplicationsPerDay: num(e.target.value) })} /></Field>
          <Field label="Follow-up after (days)"><input type="number" value={s.automation.followUpDays} onChange={(e) => patch('automation', { followUpDays: num(e.target.value) })} /></Field>
          <Field label="Test mode (simulate submissions)" hint="Real submission needs BOTH: TEST_MODE=false in .env and this switch off."><input type="checkbox" checked={s.automation.testMode} onChange={(e) => patch('automation', { testMode: e.target.checked })} /></Field>
        </div>
      </Card>

      <Card title="LLM" actions={actions('llm')}>
        {!envInfo?.llmConfigured && <Notice kind="info">ANTHROPIC_API_KEY is not set in .env — LLM features are disabled.</Notice>}
        <div className="grid">
          <Field label="Provider"><select value={s.llm.provider} disabled><option value="anthropic">Anthropic (Claude)</option></select></Field>
          <Field label="Model"><input value={s.llm.model} onChange={(e) => patch('llm', { model: e.target.value })} /></Field>
          <Field label="Effort"><select value={s.llm.effort} onChange={(e) => patch('llm', { effort: e.target.value as Settings['llm']['effort'] })}>
            {['low', 'medium', 'high', 'xhigh', 'max'].map((x) => <option key={x}>{x}</option>)}
          </select></Field>
          <Field label="Temperature" hint="Empty = model default. Ignored by models that don't accept it (Claude Opus 5.x).">
            <input type="number" step="0.1" min={0} max={1} value={s.llm.temperature ?? ''} onChange={(e) => patch('llm', { temperature: e.target.value === '' ? null : num(e.target.value) })} />
          </Field>
          <Field label="Max tokens"><input type="number" value={s.llm.maxTokens} onChange={(e) => patch('llm', { maxTokens: num(e.target.value) })} /></Field>
          <Field label="Refusal fallback (server-side)"><input type="checkbox" checked={s.llm.refusalFallback} onChange={(e) => patch('llm', { refusalFallback: e.target.checked })} /></Field>
        </div>
      </Card>

      <Card title="Documents" actions={actions('documents')}>
        <div className="grid">
          <Field label="Cover letter language"><input value={s.documents.letterLanguage} onChange={(e) => patch('documents', { letterLanguage: e.target.value })} /></Field>
          <Field label="Generate CV + letter automatically for">
            <div className="row">
              {(['GREEN', 'YELLOW'] as const).map((c) => (
                <label key={c} className="inline">
                  <input type="checkbox" checked={s.documents.autoGenerateFor.includes(c)} onChange={(e) => patch('documents', { autoGenerateFor: e.target.checked ? [...s.documents.autoGenerateFor, c] : s.documents.autoGenerateFor.filter((x) => x !== c) })} />
                  {c}
                </label>
              ))}
            </div>
          </Field>
        </div>
        <p className="muted">RED offers never get documents automatically; you can still force it on the offer page.</p>
      </Card>

      <Card title="Browser (application simulation)" actions={actions('browser')}>
        <div className="grid">
          <Field label="Headless (no window)" hint="Turn off to watch the form being filled"><input type="checkbox" checked={s.browser.headless} onChange={(e) => patch('browser', { headless: e.target.checked })} /></Field>
          <Field label="Keep my browser session" hint="Cookies kept in browser-profile/ so you sign in once yourself. Passwords are never typed or stored."><input type="checkbox" checked={s.browser.persistentProfile} onChange={(e) => patch('browser', { persistentProfile: e.target.checked })} /></Field>
          <Field label="Delay between actions (ms)"><input type="number" value={s.browser.slowMoMs} onChange={(e) => patch('browser', { slowMoMs: num(e.target.value) })} /></Field>
          <Field label="Page timeout (s)"><input type="number" value={s.browser.timeoutSeconds} onChange={(e) => patch('browser', { timeoutSeconds: num(e.target.value) })} /></Field>
        </div>
      </Card>

      <Card title="Notifications" actions={actions('notifications')}>
        <p className="muted">Dashboard notifications are always on. Email / Telegram / Discord channels are not implemented yet.</p>
      </Card>
    </>
  );
}
