import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type DashboardData } from '../api';
import { Card, Notice } from '../components';

const CARDS: Array<{ key: keyof DashboardData['stats']; label: string }> = [
  { key: 'totalJobs', label: 'Total jobs' },
  { key: 'newJobs', label: 'New jobs' },
  { key: 'matchingJobs', label: 'Relevant' },
  { key: 'highMatch', label: 'High match' },
  { key: 'applicationsPrepared', label: 'Prepared' },
  { key: 'applicationsSubmitted', label: 'Submitted (confirmed)' },
  { key: 'needsValidation', label: 'Needs validation' },
  { key: 'interviews', label: 'Interviews' },
  { key: 'offers', label: 'Offers' },
];

export function DashboardPage() {
  const [data, setData] = useState<DashboardData>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    api.dashboard().then(setData).catch((e: Error) => setError(e.message));
  }, []);

  if (error) return <Notice kind="error">Cannot reach the API: {error}</Notice>;
  if (!data) return <p>Loading…</p>;

  return (
    <>
      <h1>Dashboard</h1>
      {data.testMode && (
        <Notice kind="info">
          <strong>TEST MODE is ON</strong> — no application will ever be submitted. Mode: {data.applicationMode}.
        </Notice>
      )}
      <div className="stats">
        {CARDS.map((c) => (
          <div className="stat" key={c.key}>
            <div className="stat-value">{data.stats[c.key]}</div>
            <div className="stat-label">{c.label}</div>
          </div>
        ))}
      </div>
      <p className="muted">
        {data.lastSearch?.stats
          ? `Last search: ${new Date(data.lastSearch.startedAt).toLocaleString()} — ${data.lastSearch.stats.newJobs} new offer(s).`
          : 'No search run yet.'}{' '}
        Scoring and applications arrive in Phases 3–7; those counters stay at 0 until then.
      </p>

      <Card title="Getting started">
        <ol className="checklist">
          <li className={data.profile.score === 100 ? 'done' : ''}>
            <Link to="/profile">Complete your profile</Link> — {data.profile.score}%
            {data.profile.missing.length > 0 && <small className="muted"> (missing: {data.profile.missing.join(', ')})</small>}
          </li>
          <li className={data.masterCv ? 'done' : ''}>
            <Link to="/master-cv">Create your Master CV</Link> —{' '}
            {data.masterCv ? `v${data.masterCv.version} (${new Date(data.masterCv.createdAt).toLocaleString()})` : 'not created yet'}
          </li>
          <li>
            <Link to="/settings">Check your search & automation settings</Link>
          </li>
          <li className={data.stats.totalJobs > 0 ? 'done' : ''}>
            <Link to="/sources">Add company boards or import offers</Link> — {data.stats.totalJobs} offer(s) in the database
          </li>
        </ol>
      </Card>
    </>
  );
}
