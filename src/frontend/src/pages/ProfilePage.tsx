import { useEffect, useRef, useState } from 'react';
import type { CandidateProfile, Education, Experience, Skill, SkillCategory } from '../../../models/profile';
import { SkillCategories } from '../../../models/profile';
import { WorkModes } from '../../../models/common';
import { api, ApiError, type Completeness, type CvImportResult, type CvImportRow } from '../api';
import { Card, CsvInput, Field, LinesInput, Notice } from '../components';

const emptyExperience = (): Experience => ({ company: '', title: '', isCurrent: false, achievements: [], technologies: [], skills: [] });
const emptyEducation = (): Education => ({ school: '' });

function describeError(e: unknown): string {
  if (e instanceof ApiError && Array.isArray(e.details)) {
    return `${e.message}: ${(e.details as Array<{ path: unknown[]; message: string }>).map((d) => `${d.path.join('.')} — ${d.message}`).join('; ')}`;
  }
  return (e as Error).message;
}

export function ProfilePage() {
  const [p, setP] = useState<CandidateProfile>();
  const [completeness, setCompleteness] = useState<Completeness>();
  const [msg, setMsg] = useState<{ kind: 'error' | 'success' | 'warning' | 'info'; text: string }>();
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    api.getProfile()
      .then((r) => {
        setP(r.profile);
        setCompleteness(r.completeness);
      })
      .catch((e: Error) => setMsg({ kind: 'error', text: e.message }));
  }, []);

  if (!p) return msg ? <Notice kind={msg.kind}>{msg.text}</Notice> : <p>Loading…</p>;

  const update = (patch: Partial<CandidateProfile>) => {
    setP({ ...p, ...patch });
    setDirty(true);
  };
  const setPersonal = (k: keyof CandidateProfile['personal'], v: string) => update({ personal: { ...p.personal, [k]: v } });
  const setExp = (i: number, patch: Partial<Experience>) => update({ experiences: p.experiences.map((e, j) => (j === i ? { ...e, ...patch } : e)) });
  const setEdu = (i: number, patch: Partial<Education>) => update({ education: p.education.map((e, j) => (j === i ? { ...e, ...patch } : e)) });
  const setSkill = (i: number, patch: Partial<Skill>) => update({ skills: p.skills.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  const move = <T,>(list: T[], i: number, d: -1 | 1): T[] => {
    const out = [...list];
    const j = i + d;
    if (j < 0 || j >= out.length) return out;
    [out[i], out[j]] = [out[j]!, out[i]!];
    return out;
  };

  const save = async () => {
    setMsg(undefined);
    try {
      const r = await api.saveProfile(p);
      setP(r.profile);
      setCompleteness(r.completeness);
      setDirty(false);
      setMsg({ kind: 'success', text: 'Profile saved. Remember to create a new Master CV version if the CV content changed.' });
    } catch (e) {
      setMsg({ kind: 'error', text: describeError(e) });
    }
  };

  const applyDraft = (r: CvImportResult) => {
    const d = r.draft;
    setP({
      ...p,
      personal: { ...p.personal, ...Object.fromEntries(Object.entries(d.personal).filter(([, v]) => v)) },
      headline: d.headline ?? p.headline,
      summary: d.summary ?? p.summary,
      education: d.education,
      experiences: d.experiences,
      skills: d.skills,
    });
    setDirty(true);
    setMsg({ kind: 'warning', text: `Draft from "${r.originalFilename}" loaded into the form. Nothing is saved yet: review every field, then click Save.` });
  };

  const val = (v: string | undefined) => v ?? '';

  return (
    <>
      <div className="page-head">
        <h1>My Profile</h1>
        <div className="actions">
          {completeness && <span className="badge">Completeness {completeness.score}%</span>}
          <button onClick={save} disabled={!dirty}>Save profile</button>
        </div>
      </div>
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}

      <CvImportCard onApply={applyDraft} />

      <Card title="Personal information">
        <div className="grid">
          <Field label="First name"><input value={val(p.personal.firstName)} onChange={(e) => setPersonal('firstName', e.target.value)} /></Field>
          <Field label="Last name"><input value={val(p.personal.lastName)} onChange={(e) => setPersonal('lastName', e.target.value)} /></Field>
          <Field label="Email"><input type="email" value={val(p.personal.email)} onChange={(e) => setPersonal('email', e.target.value)} /></Field>
          <Field label="Phone"><input value={val(p.personal.phone)} onChange={(e) => setPersonal('phone', e.target.value)} /></Field>
          <Field label="Current location"><input value={val(p.personal.currentLocation)} onChange={(e) => setPersonal('currentLocation', e.target.value)} /></Field>
          <Field label="LinkedIn"><input value={val(p.personal.linkedin)} onChange={(e) => setPersonal('linkedin', e.target.value)} /></Field>
          <Field label="Portfolio"><input value={val(p.personal.portfolio)} onChange={(e) => setPersonal('portfolio', e.target.value)} /></Field>
          <Field label="Website"><input value={val(p.personal.website)} onChange={(e) => setPersonal('website', e.target.value)} /></Field>
          <Field label="Headline" wide><input value={val(p.headline)} onChange={(e) => update({ headline: e.target.value })} /></Field>
          <Field label="Summary" wide><textarea rows={3} value={val(p.summary)} onChange={(e) => update({ summary: e.target.value })} /></Field>
        </div>
      </Card>

      <Card title="Work authorization (US)">
        <p className="muted">These answers are never guessed. Until you fill them in, the app will stop and ask you whenever an application asks about them.</p>
        <div className="grid">
          <Field label="Authorized to work in the US?">
            <select value={val(p.workAuthorization.authorizedToWorkInUS)} onChange={(e) => update({ workAuthorization: { ...p.workAuthorization, authorizedToWorkInUS: (e.target.value || undefined) as 'yes' | 'no' | undefined } })}>
              <option value="">— not set —</option><option value="yes">Yes</option><option value="no">No</option>
            </select>
          </Field>
          <Field label="Will require sponsorship?">
            <select value={val(p.workAuthorization.requiresSponsorship)} onChange={(e) => update({ workAuthorization: { ...p.workAuthorization, requiresSponsorship: (e.target.value || undefined) as 'yes' | 'no' | undefined } })}>
              <option value="">— not set —</option><option value="yes">Yes</option><option value="no">No</option>
            </select>
          </Field>
          <Field label="Visa status (e.g. J-1 to obtain)"><input value={val(p.workAuthorization.visaStatus)} onChange={(e) => update({ workAuthorization: { ...p.workAuthorization, visaStatus: e.target.value } })} /></Field>
          <Field label="Notes"><input value={val(p.workAuthorization.notes)} onChange={(e) => update({ workAuthorization: { ...p.workAuthorization, notes: e.target.value } })} /></Field>
        </div>
      </Card>

      <Card title="Education" actions={<button className="secondary" onClick={() => update({ education: [...p.education, emptyEducation()] })}>+ Add</button>}>
        {p.education.length === 0 && <p className="muted">No education yet.</p>}
        {p.education.map((e, i) => (
          <div className="entry" key={i}>
            <div className="grid">
              <Field label="School *"><input value={e.school} onChange={(ev) => setEdu(i, { school: ev.target.value })} /></Field>
              <Field label="Degree"><input value={val(e.degree)} onChange={(ev) => setEdu(i, { degree: ev.target.value })} /></Field>
              <Field label="Field"><input value={val(e.field)} onChange={(ev) => setEdu(i, { field: ev.target.value })} /></Field>
              <Field label="GPA (if relevant)"><input value={val(e.gpa)} onChange={(ev) => setEdu(i, { gpa: ev.target.value })} /></Field>
              <Field label="Start" hint="YYYY or YYYY-MM"><input value={val(e.startDate)} placeholder="2024-09" onChange={(ev) => setEdu(i, { startDate: ev.target.value })} /></Field>
              <Field label="End" hint="YYYY or YYYY-MM"><input value={val(e.endDate)} placeholder="2027-06" onChange={(ev) => setEdu(i, { endDate: ev.target.value })} /></Field>
              <Field label="Description" wide><textarea rows={2} value={val(e.description)} onChange={(ev) => setEdu(i, { description: ev.target.value })} /></Field>
            </div>
            <EntryButtons onUp={() => update({ education: move(p.education, i, -1) })} onDown={() => update({ education: move(p.education, i, 1) })} onRemove={() => update({ education: p.education.filter((_, j) => j !== i) })} />
          </div>
        ))}
      </Card>

      <Card title="Experience" actions={<button className="secondary" onClick={() => update({ experiences: [...p.experiences, emptyExperience()] })}>+ Add</button>}>
        {p.experiences.length === 0 && <p className="muted">No experience yet.</p>}
        {p.experiences.map((e, i) => (
          <div className="entry" key={i}>
            <div className="grid">
              <Field label="Company *"><input value={e.company} onChange={(ev) => setExp(i, { company: ev.target.value })} /></Field>
              <Field label="Title *"><input value={e.title} onChange={(ev) => setExp(i, { title: ev.target.value })} /></Field>
              <Field label="Location"><input value={val(e.location)} onChange={(ev) => setExp(i, { location: ev.target.value })} /></Field>
              <Field label="Current position">
                <input type="checkbox" checked={e.isCurrent} onChange={(ev) => setExp(i, { isCurrent: ev.target.checked, endDate: ev.target.checked ? undefined : e.endDate })} />
              </Field>
              <Field label="Start" hint="YYYY or YYYY-MM"><input value={val(e.startDate)} onChange={(ev) => setExp(i, { startDate: ev.target.value })} /></Field>
              <Field label="End" hint="YYYY or YYYY-MM"><input value={val(e.endDate)} disabled={e.isCurrent} onChange={(ev) => setExp(i, { endDate: ev.target.value })} /></Field>
              <Field label="Description" wide><textarea rows={2} value={val(e.description)} onChange={(ev) => setExp(i, { description: ev.target.value })} /></Field>
              <Field label="Achievements (one per line)" wide><LinesInput value={e.achievements} onChange={(v) => setExp(i, { achievements: v })} /></Field>
              <Field label="Technologies (comma-separated)"><CsvInput value={e.technologies} onChange={(v) => setExp(i, { technologies: v })} /></Field>
              <Field label="Skills (comma-separated)"><CsvInput value={e.skills} onChange={(v) => setExp(i, { skills: v })} /></Field>
            </div>
            <EntryButtons onUp={() => update({ experiences: move(p.experiences, i, -1) })} onDown={() => update({ experiences: move(p.experiences, i, 1) })} onRemove={() => update({ experiences: p.experiences.filter((_, j) => j !== i) })} />
          </div>
        ))}
      </Card>

      <Card title="Skills" actions={<button className="secondary" onClick={() => update({ skills: [...p.skills, { category: 'technical', name: '' }] })}>+ Add</button>}>
        {p.skills.length === 0 && <p className="muted">No skills yet.</p>}
        <table className="table">
          <thead><tr><th>Category</th><th>Name</th><th>Level</th><th /></tr></thead>
          <tbody>
            {p.skills.map((s, i) => (
              <tr key={i}>
                <td>
                  <select value={s.category} onChange={(e) => setSkill(i, { category: e.target.value as SkillCategory })}>
                    {SkillCategories.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </td>
                <td><input value={s.name} onChange={(e) => setSkill(i, { name: e.target.value })} /></td>
                <td><input value={val(s.level)} placeholder="e.g. C1, Advanced" onChange={(e) => setSkill(i, { level: e.target.value })} /></td>
                <td><button className="danger small" onClick={() => update({ skills: p.skills.filter((_, j) => j !== i) })}>Remove</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card title="Preferences">
        <div className="grid">
          <Field label="Preferred industries"><CsvInput value={p.preferences.preferredIndustries} onChange={(v) => update({ preferences: { ...p.preferences, preferredIndustries: v } })} placeholder="Hospitality, Marketing" /></Field>
          <Field label="Preferred job titles"><CsvInput value={p.preferences.preferredJobTitles} onChange={(v) => update({ preferences: { ...p.preferences, preferredJobTitles: v } })} placeholder="Marketing Intern" /></Field>
          <Field label="Preferred companies"><CsvInput value={p.preferences.preferredCompanies} onChange={(v) => update({ preferences: { ...p.preferences, preferredCompanies: v } })} /></Field>
          <Field label="Preferred locations"><CsvInput value={p.preferences.preferredLocations} onChange={(v) => update({ preferences: { ...p.preferences, preferredLocations: v } })} placeholder="Manhattan, Brooklyn" /></Field>
          <Field label="Minimum score (0-100)"><input type="number" min={0} max={100} value={p.preferences.minimumScore} onChange={(e) => update({ preferences: { ...p.preferences, minimumScore: Number(e.target.value) } })} /></Field>
          <Field label="Minimum duration (months)"><input type="number" min={0} max={24} value={p.preferences.minimumDurationMonths} onChange={(e) => update({ preferences: { ...p.preferences, minimumDurationMonths: Number(e.target.value) } })} /></Field>
          <Field label="Work modes" wide>
            <div className="row">
              {WorkModes.map((m) => (
                <label key={m} className="inline">
                  <input
                    type="checkbox"
                    checked={p.preferences.workModes.includes(m)}
                    onChange={(e) => update({ preferences: { ...p.preferences, workModes: e.target.checked ? [...p.preferences.workModes, m] : p.preferences.workModes.filter((x) => x !== m) } })}
                  />
                  {m}
                </label>
              ))}
            </div>
          </Field>
        </div>
      </Card>

      <div className="sticky-save">
        <button onClick={save} disabled={!dirty}>{dirty ? 'Save profile' : 'Saved'}</button>
      </div>
    </>
  );
}

function EntryButtons(props: { onUp: () => void; onDown: () => void; onRemove: () => void }) {
  return (
    <div className="entry-buttons">
      <button className="secondary small" onClick={props.onUp}>↑</button>
      <button className="secondary small" onClick={props.onDown}>↓</button>
      <button className="danger small" onClick={props.onRemove}>Remove</button>
    </div>
  );
}

function CvImportCard({ onApply }: { onApply: (r: CvImportResult) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [useLlm, setUseLlm] = useState(false);
  const [llmConfigured, setLlmConfigured] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CvImportResult>();
  const [history, setHistory] = useState<CvImportRow[]>([]);
  const [error, setError] = useState<string>();

  useEffect(() => {
    api.cvImports().then(setHistory).catch(() => undefined);
    api.getSettings().then((s) => setLlmConfigured(s.env.llmConfigured)).catch(() => undefined);
  }, []);

  const upload = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    setBusy(true);
    setError(undefined);
    try {
      const r = await api.importCv(file, useLlm);
      setResult(r);
      setHistory(await api.cvImports());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Import my CV (PDF or DOCX)">
      <p className="muted">
        The original file is stored unchanged (read-only, SHA-256 verified). The extracted data is only a <strong>draft</strong>: you review it
        before anything is saved. Work authorization is never extracted.
      </p>
      <div className="row">
        <input ref={fileRef} type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" />
        <label className="inline" title={llmConfigured ? '' : 'Set ANTHROPIC_API_KEY in .env to enable'}>
          <input type="checkbox" checked={useLlm} disabled={!llmConfigured} onChange={(e) => setUseLlm(e.target.checked)} />
          Use Claude for better extraction (sends the CV text to Anthropic)
        </label>
        <button onClick={upload} disabled={busy}>{busy ? 'Extracting…' : 'Import'}</button>
      </div>
      {error && <Notice kind="error">{error}</Notice>}
      {result && (
        <div className="draft">
          <h3>Extracted draft ({result.method})</h3>
          <ul className="muted">
            <li>Name: {[result.draft.personal.firstName, result.draft.personal.lastName].filter(Boolean).join(' ') || '—'}</li>
            <li>Email: {result.draft.personal.email ?? '—'} · Phone: {result.draft.personal.phone ?? '—'}</li>
            <li>{result.draft.experiences.length} experience(s), {result.draft.education.length} education entr(y/ies), {result.draft.skills.length} skill(s)</li>
          </ul>
          {result.draft.warnings.length > 0 && (
            <Notice kind="warning">
              <ul>{result.draft.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
            </Notice>
          )}
          <button onClick={() => onApply(result)}>Load draft into the form (replaces education, experience and skills)</button>
        </div>
      )}
      {history.length > 0 && (
        <details>
          <summary>Previous imports ({history.length})</summary>
          <table className="table">
            <thead><tr><th>File</th><th>Date</th><th>Status</th><th>Method</th><th /></tr></thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.id}>
                  <td><a href={`/api/cv/imports/${h.id}/original`}>{h.originalFilename}</a></td>
                  <td>{new Date(h.createdAt).toLocaleString()}</td>
                  <td>{h.status}{h.error ? ` — ${h.error}` : ''}</td>
                  <td>{h.extractionMethod ?? '—'}</td>
                  <td>
                    <button className="secondary small" onClick={async () => alert((await api.verifyCv(h.id)).intact ? 'Original file intact (SHA-256 matches).' : 'WARNING: original file missing or modified!')}>
                      Verify original
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </Card>
  );
}
