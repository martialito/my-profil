import { useEffect, useState } from 'react';
import { api, type BankEntry, type DemoSimulation, type MatchResult } from '../api';
import { Card, Field, Notice } from '../components';

type Draft = Omit<BankEntry, 'id'>;
const empty: Draft = { question: '', answer: '', aliases: [], category: null, requiresConfirmation: false };

export function AnswerBankPage() {
  const [entries, setEntries] = useState<BankEntry[]>([]);
  const [editing, setEditing] = useState<{ id?: number; d: Draft }>();
  const [error, setError] = useState<string>();
  const [test, setTest] = useState('');
  const [match, setMatch] = useState<MatchResult>();
  const [demo, setDemo] = useState<DemoSimulation & { at: number }>();
  const [busy, setBusy] = useState(false);

  const load = () => api.answers().then(setEntries).catch((e: Error) => setError(e.message));
  useEffect(() => {
    api.answers().then(setEntries).catch((e: Error) => setError(e.message));
  }, []);

  const save = async () => {
    if (!editing) return;
    setError(undefined);
    try {
      const d = { ...editing.d, answer: editing.d.answer || null, aliases: editing.d.aliases.filter(Boolean) };
      if (editing.id) await api.updateAnswer(editing.id, d);
      else await api.createAnswer(d);
      setEditing(undefined);
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const runDemo = async () => {
    setBusy(true);
    setError(undefined);
    try {
      setDemo({ ...(await api.simulateDemo()), at: Date.now() });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="page-head">
        <h1>Application Answer Bank</h1>
        <button onClick={() => setEditing({ d: { ...empty } })}>+ Add a question</button>
      </div>
      <p className="muted">
        Your standard answers to application questions. Similar wordings are recognised; when a question is ambiguous, or has no
        configured answer, the app stops and asks you. Empty answers are never filled in for you. Work authorization and
        sponsorship fall back to My Profile when left empty here.
      </p>
      {error && <Notice kind="error">{error}</Notice>}

      {editing && (
        <Card title={editing.id ? 'Edit answer' : 'New question'}>
          <div className="grid">
            <Field label="Question" wide><input value={editing.d.question} onChange={(e) => setEditing({ ...editing, d: { ...editing.d, question: e.target.value } })} /></Field>
            <Field label="Your answer (leave empty if you want to be asked each time)" wide><textarea rows={2} value={editing.d.answer ?? ''} onChange={(e) => setEditing({ ...editing, d: { ...editing.d, answer: e.target.value } })} /></Field>
            <Field label="Other wordings (one per line)" wide><textarea rows={3} value={editing.d.aliases.join('\n')} onChange={(e) => setEditing({ ...editing, d: { ...editing.d, aliases: e.target.value.split('\n') } })} /></Field>
            <Field label="Always ask me to confirm"><input type="checkbox" checked={editing.d.requiresConfirmation} onChange={(e) => setEditing({ ...editing, d: { ...editing.d, requiresConfirmation: e.target.checked } })} /></Field>
          </div>
          <div className="row"><button onClick={save}>Save</button><button className="secondary" onClick={() => setEditing(undefined)}>Cancel</button></div>
        </Card>
      )}

      <Card>
        <table className="table">
          <thead><tr><th>Question</th><th>Answer</th><th>Other wordings</th><th /></tr></thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id}>
                <td>{e.question}{e.requiresConfirmation && <small className="muted"> · always confirm</small>}</td>
                <td>{e.answer ?? <span className="muted">{e.category === 'work_authorization' || e.category === 'sponsorship' ? 'from My Profile' : 'not set — you will be asked'}</span>}</td>
                <td className="muted small">{e.aliases.join(' · ')}</td>
                <td className="nowrap">
                  <button className="secondary small" onClick={() => setEditing({ id: e.id, d: { question: e.question, answer: e.answer, aliases: e.aliases, category: e.category, requiresConfirmation: e.requiresConfirmation } })}>Edit</button>{' '}
                  <button className="danger small" onClick={async () => { await api.deleteAnswer(e.id); await load(); }}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <div className="two-col even">
        <Card title="Test a question">
          <div className="row">
            <input placeholder="e.g. Are you legally eligible to work in the U.S.?" value={test} onChange={(e) => setTest(e.target.value)} />
            <button disabled={test.length < 3} onClick={async () => setMatch(await api.matchAnswer(test))}>Test</button>
          </div>
          {match && (
            <Notice kind={match.status === 'matched' ? 'success' : match.status === 'unknown' ? 'error' : 'warning'}>
              <strong>{match.status.replace('_', ' ')}</strong>{match.answer && <> → “{match.answer}”</>}<div>{match.reason}</div>
            </Notice>
          )}
        </Card>
        <Card title="Try the form filler (demo form)">
          <p className="muted">Runs the real browser automation on a local, fictional application form with your profile and answers. Nothing is sent anywhere.</p>
          <div className="row">
            <button onClick={runDemo} disabled={busy}>{busy ? 'Running…' : 'Run on the demo form'}</button>
            <a href="/demo/application-form" target="_blank" rel="noreferrer">Open the demo form</a>
          </div>
          {demo && (
            <>
              <p><strong>Result:</strong> {demo.status}{demo.blocker ? ` — ${demo.blocker.detail}` : ''}{demo.error ? ` — ${demo.error}` : ''} · submit button “{demo.submitButton ?? 'not found'}” <strong>not clicked</strong></p>
              <ul className="small">
                {demo.filled.map((f) => <li key={f.label}>✓ {f.label}: {f.actual} <span className="muted">({f.source})</span></li>)}
                {demo.plan?.needsInput.map((i) => <li key={i.field.id} className="error-text">? {i.field.label} — {i.reason}</li>)}
                {demo.plan?.needsConfirmation.map((i) => <li key={i.field.id}>⚠ {i.field.label}: {i.value} — {i.reason}</li>)}
              </ul>
              {demo.screenshotUrl && <img className="shot" src={`${demo.screenshotUrl}?t=${demo.at}`} alt="Simulation screenshot" />}
            </>
          )}
        </Card>
      </div>
    </>
  );
}
