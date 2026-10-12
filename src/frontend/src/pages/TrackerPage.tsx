import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, type ApplicationDetail, type ApplicationRow } from '../api';
import { Card, Field, Notice } from '../components';
import { ScoreBadge, startLabel } from './JobsPage';

const STATUSES = ['FOUND', 'ANALYZED', 'SHORTLISTED', 'CV_CREATED', 'COVER_LETTER_CREATED', 'READY_TO_APPLY', 'APPLIED', 'INTERVIEW', 'OFFER', 'REJECTED', 'WITHDRAWN'];
const NEXT: Record<string, string[]> = {
  FOUND: ['WITHDRAWN'], ANALYZED: ['WITHDRAWN'],
  SHORTLISTED: ['READY_TO_APPLY', 'APPLIED', 'WITHDRAWN'],
  CV_CREATED: ['READY_TO_APPLY', 'APPLIED', 'WITHDRAWN'],
  COVER_LETTER_CREATED: ['READY_TO_APPLY', 'APPLIED', 'WITHDRAWN'],
  READY_TO_APPLY: ['APPLIED', 'WITHDRAWN'],
  APPLIED: ['INTERVIEW', 'REJECTED', 'OFFER', 'WITHDRAWN'],
  INTERVIEW: ['INTERVIEW', 'OFFER', 'REJECTED', 'WITHDRAWN'],
  OFFER: ['WITHDRAWN'], REJECTED: [], WITHDRAWN: [],
};
const LABEL: Record<string, string> = { READY_TO_APPLY: 'Mark ready', APPLIED: 'I submitted it', INTERVIEW: 'Interview', OFFER: 'Offer received', REJECTED: 'Rejected', WITHDRAWN: 'Withdraw' };
const today = () => new Date().toISOString().slice(0, 10);

function Detail({ id, onChange }: { id: number; onChange: () => void }) {
  const [a, setA] = useState<ApplicationDetail>();
  const [error, setError] = useState<string>();
  const [params] = useSearchParams();
  const [confirming, setConfirming] = useState(params.get('confirm') === '1');
  const [conf, setConf] = useState({ applicationDate: today(), confirmationText: '', confirmationUrl: '' });
  const [note, setNote] = useState('');
  const [notes, setNotes] = useState<string>();

  useEffect(() => {
    api.application(id).then(setA).catch((e: Error) => setError(e.message));
  }, [id]);

  const run = async (fn: () => Promise<ApplicationDetail>) => {
    setError(undefined);
    try {
      setA(await fn());
      onChange();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  if (!a) return error ? <Notice kind="error">{error}</Notice> : <p>Loading…</p>;

  const move = (to: string) => {
    if (to === 'APPLIED') return setConfirming(true);
    return run(() => api.transition(a.id, { to, note: note || undefined }).then((r) => (setNote(''), r)));
  };

  return (
    <Card title={`${a.title} — ${a.company}`} actions={<Link to={`/jobs/${a.jobId}`}>Offer →</Link>}>
      {error && <Notice kind="error">{error}</Notice>}
      <dl className="facts">
        <div><dt>Status</dt><dd><span className="status">{a.status}</span> {a.isSimulation && !a.submittedAt && <small className="muted">(not submitted)</small>}</dd></div>
        <div><dt>Applied on</dt><dd>{a.applicationDate ?? '—'}{a.confirmationSource && <small className="muted"> · confirmed by {a.confirmationSource === 'user' ? 'you' : 'the website'}</small>}</dd></div>
        {(a.confirmationText || a.confirmationUrl) && <div><dt>Proof</dt><dd>{a.confirmationText}{a.confirmationUrl && <> <a href={a.confirmationUrl} target="_blank" rel="noreferrer noopener">link</a></>}</dd></div>}
        <div><dt>CV / letter</dt><dd>{a.resumeVersion ? `CV v${a.resumeVersion}` : 'no CV'} · {a.letterVersion ? `letter v${a.letterVersion}` : 'no letter'}</dd></div>
        <div><dt>Start</dt><dd>{startLabel(a)}</dd></div>
      </dl>

      {confirming ? (
        <div className="confirm-box">
          <h3>Confirm your submission</h3>
          <p className="muted">Only confirm once you have really submitted the application on the website. The confirmation e-mail or page is useful proof.</p>
          <div className="grid">
            <Field label="Date submitted"><input type="date" value={conf.applicationDate} onChange={(e) => setConf({ ...conf, applicationDate: e.target.value })} /></Field>
            <Field label="Confirmation URL (optional)"><input value={conf.confirmationUrl} onChange={(e) => setConf({ ...conf, confirmationUrl: e.target.value })} /></Field>
            <Field label="Confirmation message (optional)" wide><input value={conf.confirmationText} placeholder="e.g. “Thank you for applying to …”" onChange={(e) => setConf({ ...conf, confirmationText: e.target.value })} /></Field>
          </div>
          <div className="row">
            <button onClick={() => run(() => api.transition(a.id, { to: 'APPLIED', applicationDate: conf.applicationDate, confirmationText: conf.confirmationText || undefined, confirmationUrl: conf.confirmationUrl || undefined })).then(() => setConfirming(false))}>Yes, I submitted it</button>
            <button className="secondary" onClick={() => setConfirming(false)}>Not yet</button>
            {a.applicationUrl && <a href={a.applicationUrl} target="_blank" rel="noreferrer noopener">Open application page</a>}
          </div>
        </div>
      ) : (
        NEXT[a.status]!.length > 0 && (
          <div className="row">
            <input placeholder="Note for this change (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
            {NEXT[a.status]!.map((s) => <button key={s} className={s === 'WITHDRAWN' || s === 'REJECTED' ? 'danger small' : 'small'} onClick={() => move(s)}>{LABEL[s] ?? s}</button>)}
          </div>
        )
      )}

      <div className="grid" style={{ marginTop: 12 }}>
        <Field label="Follow-up date">
          <input type="date" value={a.followUpDate ?? ''} onChange={(e) => run(() => api.updateApplication(a.id, { followUpDate: e.target.value || null }))} />
        </Field>
        <Field label="Notes" wide>
          <textarea rows={3} value={notes ?? a.notes ?? ''} onChange={(e) => setNotes(e.target.value)} onBlur={() => notes !== undefined && notes !== (a.notes ?? '') && run(() => api.updateApplication(a.id, { notes: notes || null }))} />
        </Field>
      </div>

      <h3>Timeline</h3>
      <ul className="timeline">
        {a.events.map((e) => (
          <li key={e.id}>
            <small className="muted">{new Date(e.createdAt).toLocaleString()}</small>{' '}
            {e.toStatus && e.fromStatus !== e.toStatus && <span className="status">{e.toStatus}</span>} {e.message}
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function TrackerPage() {
  const [params, setParams] = useSearchParams();
  const [rows, setRows] = useState<ApplicationRow[]>([]);
  const [error, setError] = useState<string>();
  const status = params.get('status') ?? '';
  const selected = params.get('app') ? Number(params.get('app')) : undefined;

  const load = useCallback(() => {
    api.applications(status ? { status } : {}).then(setRows).catch((e: Error) => setError(e.message));
  }, [status]);
  useEffect(() => {
    load();
  }, [load]);

  const set = (k: string, v?: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    next.delete('confirm');
    setParams(next, { replace: true });
  };

  return (
    <>
      <h1>Application Tracker</h1>
      {error && <Notice kind="error">{error}</Notice>}
      <div className="row" style={{ marginBottom: 12 }}>
        <select value={status} onChange={(e) => set('status', e.target.value)} style={{ maxWidth: 260 }}>
          <option value="">All statuses</option>
          {STATUSES.map((s) => <option key={s}>{s}</option>)}
        </select>
        <small className="muted">An application is APPLIED only once its submission is confirmed. Preparing documents never counts as applying.</small>
      </div>
      <div className={selected ? 'two-col tracker' : ''}>
        <Card>
          {rows.length === 0 ? <p className="muted">No applications yet. Shortlist offers or generate documents to start tracking them.</p> : (
            <div className="table-wrap">
              <table className="table jobs">
                <thead><tr><th>Company</th><th>Position</th><th>Score</th><th>Status</th><th>Applied</th><th>Follow-up</th><th>Docs</th></tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className={r.id === selected ? 'selected' : ''} onClick={() => set('app', String(r.id))} style={{ cursor: 'pointer' }}>
                      <td>{r.company}</td>
                      <td>{r.title}</td>
                      <td>{r.score !== null ? <ScoreBadge score={r.score} category={r.category} /> : '—'}</td>
                      <td><span className="status">{r.status}</span></td>
                      <td>{r.applicationDate ?? '—'}</td>
                      <td className={r.followUpDate && r.followUpDate <= new Date().toISOString().slice(0, 10) && r.status === 'APPLIED' ? 'error-text' : ''}>{r.followUpDate ?? '—'}</td>
                      <td>{r.resumeVersion ? `CV v${r.resumeVersion}` : '—'}{r.letterVersion ? ` · L v${r.letterVersion}` : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        {selected && <Detail key={selected} id={selected} onChange={load} />}
      </div>
    </>
  );
}
