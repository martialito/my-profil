import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, type JobDetail } from '../api';
import { Card, Notice } from '../components';
import { startLabel } from './JobsPage';

export function JobDetailsPage() {
  const id = Number(useParams().id);
  const [job, setJob] = useState<JobDetail>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    api.job(id).then(setJob).catch((e: Error) => setError(e.message));
  }, [id]);

  if (error) return <Notice kind="error">{error}</Notice>;
  if (!job) return <p>Loading…</p>;

  const setStatus = async (s: string) => setJob(await api.setJobStatus(id, s));
  const facts: Array<[string, string | null | undefined]> = [
    ['Company', job.company],
    ['Location', job.location],
    ['Source', job.sourceName ?? job.source],
    ['Posted', job.postedDate],
    ['Start date', job.startDate],
    ['End date', job.endDate],
    ['Period mentioned', job.periodHints.join(', ') || null],
    ['Duration', job.internshipDuration],
    ['Salary', job.salary],
    ['Employment type', job.employmentType],
    ['Department', job.department],
    ['Workplace', job.workplaceType],
    ['Status', job.status],
  ];

  return (
    <>
      <p><Link to="/jobs">← Job Search</Link></p>
      <div className="page-head">
        <h1>{job.title}</h1>
        <div className="actions">
          <a className="button-link" href={job.sourceUrl} target="_blank" rel="noreferrer noopener">Open offer</a>
          {job.status !== 'SHORTLISTED' && <button onClick={() => setStatus('SHORTLISTED')}>Shortlist</button>}
          {job.status !== 'SKIPPED' && <button className="danger" onClick={() => setStatus('SKIPPED')}>Skip</button>}
          {job.status !== 'FOUND' && <button className="secondary" onClick={() => setStatus('FOUND')}>Reset status</button>}
        </div>
      </div>
      {job.closedAt && <Notice kind="warning">This offer is no longer listed on its source board (since {new Date(job.closedAt).toLocaleDateString()}).</Notice>}
      {job.duplicatesOf && (
        <Notice kind="info">
          Grouped as a duplicate of <Link to={`/jobs/${job.duplicatesOf}`}>job #{job.duplicatesOf}</Link>.{' '}
          <button className="link" onClick={async () => setJob(await api.ungroupJob(id))}>Not the same offer? Separate it</button>
        </Notice>
      )}

      <div className="two-col wide-right">
        <Card title="Details">
          <dl className="facts">
            {facts.map(([k, v]) => (
              <div key={k}><dt>{k}</dt><dd>{v || <span className="muted">not stated</span>}</dd></div>
            ))}
          </dl>
          {job.related.length > 0 && (
            <>
              <h3>Same offer elsewhere</h3>
              <ul>{job.related.map((r) => <li key={r.id}><Link to={`/jobs/${r.id}`}>#{r.id}</Link> — {r.source} · <a href={r.sourceUrl} target="_blank" rel="noreferrer noopener">link</a></li>)}</ul>
            </>
          )}
        </Card>
        <div>
          <Card title="Match score">
            {job.analysis ? <pre>{JSON.stringify(job.analysis, null, 2)}</pre> : <p className="muted">Not analysed yet — Claude scoring (skills, experience, education, location, dates) arrives in Phase 3.</p>}
          </Card>
          {job.responsibilities.length > 0 && (
            <Card title="Responsibilities"><ul>{job.responsibilities.map((r, i) => <li key={i}>{r}</li>)}</ul></Card>
          )}
          {job.requirements.length > 0 && (
            <Card title="Requirements"><ul>{job.requirements.map((r, i) => <li key={i}>{r}</li>)}</ul></Card>
          )}
          <Card title="Job description">
            {job.description ? <div className="description">{job.description}</div> : <p className="muted">No description.</p>}
          </Card>
          <Card title="Customized CV · Cover letter · Application">
            <p className="muted">Arrive in Phases 4 and 6. Start: {startLabel(job)}.</p>
          </Card>
        </div>
      </div>
    </>
  );
}
