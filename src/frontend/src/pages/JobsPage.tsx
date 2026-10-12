import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, type JobRow, type JobSource } from '../api';
import { Card, Notice } from '../components';

const STATUSES = ['FOUND', 'ANALYZED', 'SHORTLISTED', 'SKIPPED'];
const FILTER_KEYS = ['q', 'minScore', 'category', 'dateStatus', 'location', 'locationMatch', 'duration', 'startDate', 'source', 'status', 'sort', 'includeClosed'] as const;

export function startLabel(j: Pick<JobRow, 'startDate' | 'periodHints'>): string {
  return j.startDate ?? (j.periodHints.length ? j.periodHints.join(', ') : '—');
}

export function ScoreBadge({ score, category }: { score: number; category: string | null }) {
  return <span className={`score c-${(category ?? '').toLowerCase()}`}>{score}</span>;
}

export function DateBadge({ status }: { status: string }) {
  const label = status === 'COMPATIBLE' ? 'dates OK' : status === 'INCOMPATIBLE' ? 'dates ✗' : 'dates ?';
  return <small className={`date-badge d-${status.toLowerCase()}`}>{label}</small>;
}

export function JobsPage() {
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState<{ total: number; items: JobRow[] }>();
  const [sources, setSources] = useState<JobSource[]>([]);
  const [error, setError] = useState<string>();
  const [reload, setReload] = useState(0);

  const filters = Object.fromEntries(FILTER_KEYS.map((k) => [k, params.get(k) ?? ''])) as Record<(typeof FILTER_KEYS)[number], string>;
  const query = Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== ''));
  const queryKey = JSON.stringify(query);

  useEffect(() => {
    api.jobs(JSON.parse(queryKey) as Record<string, string>).then(setData).catch((e: Error) => setError(e.message));
  }, [queryKey, reload]);
  useEffect(() => {
    api.jobSources().then(setSources).catch(() => undefined);
  }, []);

  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'success' | 'warning' | 'error'; text: string }>();
  const analyzeAll = async () => {
    setBusy(true);
    setMsg(undefined);
    try {
      const r = await api.analyzePending(50);
      if (r.analyzed === 0 && r.errors.length === 0) {
        setMsg({ kind: 'success', text: 'No new offer to analyse.' });
        return;
      }
      setMsg({
        kind: r.errors.length ? 'warning' : 'success',
        text: `${r.analyzed} offer(s) analysed: ${r.green} GREEN, ${r.yellow} YELLOW, ${r.red} RED (≈ $${r.costUsd.toFixed(2)}).` + (r.errors.length ? ` ${r.errors.length} error(s): ${r.errors[0]!.reason}` : ''),
      });
      setReload((n) => n + 1);
    } catch (e) {
      setMsg({ kind: 'error', text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  const generateAll = async () => {
    setBusy(true);
    setMsg(undefined);
    try {
      const r = await api.generatePending(20);
      setMsg({
        kind: r.errors.length ? 'warning' : 'success',
        text: r.cvs === 0 && !r.errors.length ? 'No GREEN/YELLOW offer is waiting for documents.' : `${r.cvs} CV(s) and ${r.letters} cover letter(s) generated.` + (r.errors.length ? ` ${r.errors.length} error(s): ${r.errors[0]!.reason}` : ''),
      });
    } catch (e) {
      setMsg({ kind: 'error', text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  const status = async (id: number, s: string) => {
    await api.setJobStatus(id, s);
    setReload((n) => n + 1);
  };

  return (
    <>
      <div className="page-head">
        <h1>Job Search</h1>
        <div className="actions">
          <button onClick={analyzeAll} disabled={busy}>{busy ? 'Working…' : 'Analyse new offers'}</button>
          <button className="secondary" onClick={generateAll} disabled={busy}>Generate CVs & letters</button>
          <Link to="/sources" className="button-link">Sources & search</Link>
        </div>
      </div>
      <Card>
        <div className="filters">
          <input placeholder="Search title, company, department…" defaultValue={filters.q} onBlur={(e) => set('q', e.target.value)} onKeyDown={(e) => e.key === 'Enter' && set('q', e.currentTarget.value)} />
          <input type="number" min={0} max={100} placeholder="Min score" defaultValue={filters.minScore} onBlur={(e) => set('minScore', e.target.value)} />
          <select value={filters.category} onChange={(e) => set('category', e.target.value)}>
            <option value="">All matches</option><option value="GREEN">GREEN</option><option value="YELLOW">YELLOW</option><option value="RED">RED</option><option value="NONE">Not analysed</option>
          </select>
          <select value={filters.dateStatus} onChange={(e) => set('dateStatus', e.target.value)}>
            <option value="">All dates</option><option value="COMPATIBLE">Dates compatible</option><option value="UNKNOWN">Dates unknown</option><option value="INCOMPATIBLE">Dates incompatible</option>
          </select>
          <select value={filters.locationMatch} onChange={(e) => set('locationMatch', e.target.value)}>
            <option value="">All areas</option><option value="nyc">NYC</option><option value="near">Near NYC</option><option value="remote">Remote</option>
          </select>
          <input placeholder="Location contains" defaultValue={filters.location} onBlur={(e) => set('location', e.target.value)} />
          <input placeholder="Duration (e.g. 6)" defaultValue={filters.duration} onBlur={(e) => set('duration', e.target.value)} />
          <input placeholder="Start (e.g. 2027)" defaultValue={filters.startDate} onBlur={(e) => set('startDate', e.target.value)} />
          <select value={filters.source} onChange={(e) => set('source', e.target.value)}>
            <option value="">All sources</option>
            {sources.map((s) => <option key={s.key} value={s.key}>{s.name}</option>)}
          </select>
          <select value={filters.status} onChange={(e) => set('status', e.target.value)}>
            <option value="">All statuses</option>
            {STATUSES.map((s) => <option key={s}>{s}</option>)}
          </select>
          <select value={filters.sort || 'found'} onChange={(e) => set('sort', e.target.value)}>
            <option value="found">Newest found</option><option value="posted">Posted date</option><option value="company">Company</option><option value="score">Score</option>
          </select>
          <label className="inline"><input type="checkbox" checked={filters.includeClosed === 'true'} onChange={(e) => set('includeClosed', e.target.checked ? 'true' : '')} /> closed offers</label>
        </div>
      </Card>
      {error && <Notice kind="error">{error}</Notice>}
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
      {data && data.total === 0 && (
        <Notice kind="info">No offers yet. Add company boards or import offers manually in <Link to="/sources">Sources</Link>, then run a search.</Notice>
      )}
      {data && data.total > 0 && (
        <Card title={`${data.total} offer${data.total > 1 ? 's' : ''}`}>
          <div className="table-wrap">
            <table className="table jobs">
              <thead>
                <tr><th>Company</th><th>Position</th><th>Location</th><th>Salary</th><th>Posted</th><th>Start</th><th>Duration</th><th>Source</th><th>Score</th><th>Status</th><th>Actions</th></tr>
              </thead>
              <tbody>
                {data.items.map((j) => (
                  <tr key={j.id} className={j.closedAt ? 'closed' : ''}>
                    <td>{j.company}</td>
                    <td>
                      <Link to={`/jobs/${j.id}`}>{j.title}</Link>
                      {j.duplicates > 0 && <small className="muted"> (+{j.duplicates} other source{j.duplicates > 1 ? 's' : ''})</small>}
                      {j.closedAt && <small className="muted"> — closed</small>}
                    </td>
                    <td>{j.location ?? '—'}{j.locationMatch === 'near' && <small className="muted"> (near NYC)</small>}</td>
                    <td>{j.salary ?? '—'}</td>
                    <td>{j.postedDate ?? '—'}</td>
                    <td>{startLabel(j)}{j.dateStatus && <div><DateBadge status={j.dateStatus} /></div>}</td>
                    <td>{j.internshipDuration ?? '—'}</td>
                    <td><a href={j.sourceUrl} target="_blank" rel="noreferrer noopener">{j.source ?? '—'}</a></td>
                    <td>{j.score !== null ? <ScoreBadge score={j.score} category={j.category} /> : <span className="muted" title="Not analysed yet">—</span>}</td>
                    <td><span className={`status s-${j.status.toLowerCase()}`}>{j.status}</span></td>
                    <td className="nowrap">
                      <Link to={`/jobs/${j.id}`}>View</Link>{' '}
                      {j.status !== 'SHORTLISTED' && <button className="secondary small" onClick={() => status(j.id, 'SHORTLISTED')}>Shortlist</button>}{' '}
                      {j.status !== 'SKIPPED' && <button className="danger small" onClick={() => status(j.id, 'SKIPPED')}>Skip</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}
