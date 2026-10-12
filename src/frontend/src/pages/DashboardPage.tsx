import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, type DashboardData, type TopJob } from '../api';
import { Card, Notice } from '../components';
import { DateBadge, ScoreBadge, startLabel } from './JobsPage';

const MAIN: Array<{ key: keyof DashboardData['stats']; label: string; to: string }> = [
  { key: 'totalJobs', label: 'Total jobs', to: '/jobs' },
  { key: 'matchingJobs', label: 'Relevant', to: '/jobs?sort=score&minScore=1' },
  { key: 'highMatch', label: 'High match', to: '/jobs?category=GREEN' },
  { key: 'applications', label: 'Applications', to: '/tracker' },
  { key: 'interviews', label: 'Interviews', to: '/tracker?status=INTERVIEW' },
  { key: 'offers', label: 'Offers', to: '/tracker?status=OFFER' },
];
const SECONDARY: Array<{ key: keyof DashboardData['stats']; label: string }> = [
  { key: 'newJobs', label: 'new offers' },
  { key: 'applicationsPrepared', label: 'prepared' },
  { key: 'needsValidation', label: 'need your validation' },
  { key: 'applicationsSubmitted', label: 'submitted (confirmed)' },
  { key: 'responses', label: 'responses received' },
];

export function DashboardPage() {
  const [data, setData] = useState<DashboardData>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState<string>();
  const navigate = useNavigate();

  const load = useCallback(() => api.dashboard().then(setData).catch((e: Error) => setError(e.message)), []);
  useEffect(() => {
    load();
  }, [load]);

  const act = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setError(undefined);
    try {
      await fn();
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(undefined);
    }
  };

  /** MANUAL mode apply: open the offer, then confirm in the tracker once you have submitted it yourself. */
  const apply = async (j: TopJob) => {
    window.open(j.applicationUrl ?? j.sourceUrl, '_blank', 'noopener,noreferrer');
    const app = await api.applicationForJob(j.id);
    navigate(`/tracker?app=${app.id}&confirm=1`);
  };

  if (!data) return error ? <Notice kind="error">Cannot reach the API: {error}</Notice> : <p>Loading…</p>;

  return (
    <>
      <h1>Dashboard</h1>
      {data.testMode && (
        <Notice kind="info">
          <strong>TEST MODE is ON</strong> — the app never submits anything by itself. Mode: {data.applicationMode}.
        </Notice>
      )}
      {error && <Notice kind="error">{error}</Notice>}
      <div className="stats">
        {MAIN.map((c) => (
          <Link className="stat" key={c.key} to={c.to}>
            <div className="stat-value">{data.stats[c.key]}</div>
            <div className="stat-label">{c.label}</div>
          </Link>
        ))}
      </div>
      <p className="muted secondary-stats">
        {SECONDARY.map((c) => (
          <span key={c.key}><strong>{data.stats[c.key]}</strong> {c.label}</span>
        ))}
      </p>
      {data.notifications.actionRequired > 0 && (
        <Notice kind="warning">
          {data.notifications.actionRequired} item(s) need your attention. <Link to="/notifications">Open notifications</Link>
        </Notice>
      )}

      <Card title="Best offers" actions={<Link to="/jobs?sort=score">All offers →</Link>}>
        {data.topJobs.length === 0 ? (
          <p className="muted">No offers yet. <Link to="/sources">Add sources or import offers</Link>.</p>
        ) : (
          <div className="table-wrap">
            <table className="table jobs">
              <thead><tr><th>Company</th><th>Position</th><th>Score</th><th>Start</th><th>Status</th><th>Action</th></tr></thead>
              <tbody>
                {data.topJobs.map((j) => (
                  <tr key={j.id}>
                    <td>{j.company}</td>
                    <td><Link to={`/jobs/${j.id}`}>{j.title}</Link></td>
                    <td>{j.score !== null ? <ScoreBadge score={j.score} category={j.category} /> : <span className="muted">—</span>}</td>
                    <td>{startLabel(j)}{j.dateStatus && <div><DateBadge status={j.dateStatus} /></div>}</td>
                    <td><span className="status">{j.applicationStatus ?? j.jobStatus}</span></td>
                    <td className="nowrap actions-cell">
                      <Link to={`/jobs/${j.id}`}>View</Link>
                      <button className="secondary small" disabled={!!busy} onClick={() => act(`a${j.id}`, () => api.analyzeJob(j.id))}>{busy === `a${j.id}` ? '…' : 'Analyze'}</button>
                      {j.score !== null && (
                        <>
                          <button className="secondary small" disabled={!!busy} onClick={() => act(`c${j.id}`, () => api.generateDocuments(j.id, { what: 'resume', force: j.category === 'RED' }))}>{busy === `c${j.id}` ? '…' : 'Generate CV'}</button>
                          <button className="secondary small" disabled={!!busy} onClick={() => act(`l${j.id}`, () => api.generateDocuments(j.id, { what: 'cover-letter', force: j.category === 'RED' }))}>{busy === `l${j.id}` ? '…' : 'Generate Letter'}</button>
                        </>
                      )}
                      {!['APPLIED', 'INTERVIEW', 'OFFER', 'REJECTED', 'WITHDRAWN'].includes(j.applicationStatus ?? '') && (
                        <button className="small" disabled={!j.hasResume || !j.hasLetter} title={j.hasResume && j.hasLetter ? 'Open the offer and confirm once you have submitted it' : 'Generate the CV and the letter first'} onClick={() => apply(j)}>Apply</button>
                      )}
                      <button className="danger small" disabled={!!busy} onClick={() => act(`s${j.id}`, () => api.setJobStatus(j.id, 'SKIPPED'))}>Skip</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="muted small">“Apply” opens the offer so you submit it yourself (manual mode); you then confirm it in the tracker. Assisted form filling arrives in Phase 6.</p>
      </Card>

      <div className="two-col even">
        <Card title="Recent activity">
          {data.recentEvents.length === 0 ? <p className="muted">Nothing yet.</p> : (
            <ul className="activity">
              {data.recentEvents.map((e) => (
                <li key={e.id}>
                  <small className="muted">{new Date(e.createdAt).toLocaleString()}</small>{' '}
                  <Link to={`/tracker?app=${e.applicationId}`}>{e.title} — {e.company}</Link>: {e.message}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Getting started">
          <ol className="checklist">
            <li className={data.profile.score === 100 ? 'done' : ''}>
              <Link to="/profile">Complete your profile</Link> — {data.profile.score}%
              {data.profile.missing.length > 0 && <small className="muted"> (missing: {data.profile.missing.join(', ')})</small>}
            </li>
            <li className={data.masterCv ? 'done' : ''}>
              <Link to="/master-cv">Create your Master CV</Link> — {data.masterCv ? `v${data.masterCv.version}` : 'not created yet'}
            </li>
            <li className={data.stats.totalJobs > 0 ? 'done' : ''}>
              <Link to="/sources">Add company boards or import offers</Link> — {data.stats.totalJobs} offer(s)
              {data.lastSearch && <small className="muted"> · last search {new Date(data.lastSearch.startedAt).toLocaleString()}</small>}
            </li>
            <li className={data.lastAnalysis ? 'done' : ''}>
              <Link to="/jobs">Analyse offers</Link>{data.lastAnalysis && <small className="muted"> · last {new Date(data.lastAnalysis.createdAt).toLocaleString()}</small>}
            </li>
          </ol>
        </Card>
      </div>
    </>
  );
}
