import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, type Analysis, type DateCheck, type JobDetail, type Precheck } from '../api';
import { Card, Notice } from '../components';
import { DateBadge } from './JobsPage';
import { DocumentsPanel } from './DocumentsPanel';

function Bar({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="bar-row">
      <span>{label}</span>
      <div className="bar"><div style={{ width: `${value ?? 0}%` }} className={value === null ? 'unknown' : ''} /></div>
      <strong>{value === null ? '?' : `${value}%`}</strong>
    </div>
  );
}

function DateExplain({ date }: { date: DateCheck }) {
  return (
    <div className="date-explain">
      <DateBadge status={date.status} />{' '}
      {date.period.start && <span>{date.period.start}{date.period.end ? ` → ${date.period.end}` : ''}</span>}
      {date.period.durationMonths && <span className="muted"> · {date.period.durationMonths} month(s)</span>}
      <ul>{date.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
      {date.status === 'COMPATIBLE' && !date.autoSubmitSafe && <small className="muted">Approximate dates: automatic submission will not be allowed for this offer.</small>}
    </div>
  );
}

function AnalysisView({ a }: { a: Analysis }) {
  return (
    <>
      <div className="score-head">
        <span className={`score big c-${a.category.toLowerCase()}`}>{a.overallScore}</span>
        <div>
          <strong className={`cat c-${a.category.toLowerCase()}`}>{a.category}</strong>
          <div className="muted small">
            {a.category === 'GREEN' ? 'Automatic application allowed (if your mode permits it)' : a.category === 'YELLOW' ? 'CV + letter will be prepared, then your validation is required' : 'No application will be prepared automatically'}
          </div>
          <div className="muted small">Analysed {new Date(a.createdAt).toLocaleString()} · {a.model} · Master CV v{a.scoreDetails?.masterCvVersion}{a.costUsd != null ? ` · ≈ $${a.costUsd.toFixed(3)}` : ''}</div>
        </div>
      </div>
      <Bar label="Skills" value={a.skillsMatch} />
      <Bar label="Experience" value={a.experienceMatch} />
      <Bar label="Education" value={a.educationMatch} />
      <Bar label="Location" value={a.locationCompatibility} />
      <Bar label="Dates" value={a.dateCompatibility} />
      <Bar label="Preferences" value={a.preferencesMatch} />
      <p className="muted small">Formula: 30% skills · 20% experience · 10% education · 15% location · 15% dates (unknown = 50) · 10% preferences = {a.scoreDetails?.rawFormulaScore}.</p>
      {a.scoreDetails && a.scoreDetails.caps.length > 0 && (
        <Notice kind="warning">Score capped: <ul>{a.scoreDetails.caps.map((c, i) => <li key={i}>max {c.max} — {c.reason}</li>)}</ul></Notice>
      )}
      <div className="two-col even">
        <div><h3>Matched skills</h3>{a.matchedSkills.length ? <div className="chips">{a.matchedSkills.map((s) => <span key={s} className="chip ok">{s}</span>)}</div> : <p className="muted">None</p>}</div>
        <div><h3>Missing skills</h3>{a.missingSkills.length ? <div className="chips">{a.missingSkills.map((s) => <span key={s} className="chip miss">{s}</span>)}</div> : <p className="muted">None</p>}</div>
      </div>
      <h3>Reasons</h3>
      <ul>{a.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
      {(a.redFlags.length > 0 || a.missingRequirements.length > 0 || (a.scoreDetails?.notes.length ?? 0) > 0) && (
        <>
          <h3>Potential concerns</h3>
          <ul>
            {a.redFlags.map((r, i) => <li key={`r${i}`} className="error-text">{r}</li>)}
            {a.missingRequirements.map((r, i) => <li key={`m${i}`}>{r}</li>)}
            {a.scoreDetails?.notes.map((r, i) => <li key={`n${i}`} className="muted">{r}</li>)}
          </ul>
        </>
      )}
      {a.dateDetails && (<><h3>Dates</h3><DateExplain date={a.dateDetails} /></>)}
    </>
  );
}

export function JobDetailsPage() {
  const id = Number(useParams().id);
  const [job, setJob] = useState<JobDetail>();
  const [pre, setPre] = useState<Precheck>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.job(id).then(setJob).catch((e: Error) => setError(e.message));
    api.precheck(id).then(setPre).catch(() => undefined);
  }, [id]);

  if (!job) return error ? <Notice kind="error">{error}</Notice> : <p>Loading…</p>;

  const setStatus = async (s: string) => setJob(await api.setJobStatus(id, s));
  const analyze = async () => {
    setBusy(true);
    setError(undefined);
    try {
      setJob(await api.analyzeJob(id));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
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
          <button onClick={analyze} disabled={busy}>{busy ? 'Analysing…' : job.analysis ? 'Re-analyse' : 'Analyse'}</button>
          {job.status !== 'SHORTLISTED' && <button className="secondary" onClick={() => setStatus('SHORTLISTED')}>Shortlist</button>}
          {job.status !== 'SKIPPED' && <button className="danger" onClick={() => setStatus('SKIPPED')}>Skip</button>}
          {job.status === 'SKIPPED' || job.status === 'SHORTLISTED' ? <button className="secondary" onClick={() => setStatus(job.analysis ? 'ANALYZED' : 'FOUND')}>Reset status</button> : null}
        </div>
      </div>
      {error && <Notice kind="error">{error}</Notice>}
      {job.closedAt && <Notice kind="warning">This offer is no longer listed on its source board (since {new Date(job.closedAt).toLocaleDateString()}).</Notice>}
      {job.duplicatesOf && (
        <Notice kind="info">
          Grouped as a duplicate of <Link to={`/jobs/${job.duplicatesOf}`}>job #{job.duplicatesOf}</Link>.{' '}
          <button className="link" onClick={async () => setJob(await api.ungroupJob(id))}>Not the same offer? Separate it</button>
        </Notice>
      )}

      <div className="two-col wide-right">
        <div>
          <Card title="Details">
            <dl className="facts">
              {facts.map(([k, v]) => (
                <div key={k}><dt>{k}</dt><dd>{v || <span className="muted">not stated</span>}</dd></div>
              ))}
            </dl>
            {job.skills.length > 0 && (<><h3>Skills asked</h3><div className="chips">{job.skills.map((s) => <span key={s} className="chip">{s}</span>)}</div></>)}
            {job.related.length > 0 && (
              <>
                <h3>Same offer elsewhere</h3>
                <ul>{job.related.map((r) => <li key={r.id}><Link to={`/jobs/${r.id}`}>#{r.id}</Link> — {r.source} · <a href={r.sourceUrl} target="_blank" rel="noreferrer noopener">link</a></li>)}</ul>
              </>
            )}
          </Card>
          {pre && !job.analysis && (
            <Card title="Quick check (no AI)">
              <p>Internship: {pre.internship.isInternship ? 'yes' : <span className="error-text">no — {pre.internship.reason}</span>}</p>
              <p>Location: {pre.locationMatch === 'none' ? <span className="error-text">not NYC</span> : pre.locationMatch}</p>
              <DateExplain date={pre.date} />
            </Card>
          )}
        </div>
        <div>
          <Card title="Match score">
            {job.analysis ? <AnalysisView a={job.analysis} /> : <p className="muted">Not analysed yet. Click “Analyse” (uses Claude, requires ANTHROPIC_API_KEY and a Master CV).</p>}
          </Card>
          {job.responsibilities.length > 0 && <Card title="Responsibilities"><ul>{job.responsibilities.map((r, i) => <li key={i}>{r}</li>)}</ul></Card>}
          {job.requirements.length > 0 && <Card title="Requirements"><ul>{job.requirements.map((r, i) => <li key={i}>{r}</li>)}</ul></Card>}
          <Card title="Job description">{job.description ? <div className="description">{job.description}</div> : <p className="muted">No description.</p>}</Card>
          <DocumentsPanel jobId={id} category={job.analysis?.category ?? null} />
          <Card title="Application">
            <p className="muted">Browser-assisted application, answer bank and test mode arrive in Phase 6.</p>
          </Card>
        </div>
      </div>
    </>
  );
}
