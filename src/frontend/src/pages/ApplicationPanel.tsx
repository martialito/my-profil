import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type ApplicationDetail, type FinalCheckResult, type SimulationReport } from '../api';
import { Card, Notice } from '../components';

const ICON: Record<string, string> = { ok: '✓', warning: '!', fail: '✗', pending: '…' };

function Checklist({ check }: { check: FinalCheckResult }) {
  return (
    <>
      <div className={`ready-box ${check.ready ? 'ready' : 'not-ready'}`}>
        <strong>{check.ready ? 'APPLICATION READY' : 'NOT READY YET'}</strong>
        <dl className="facts">
          {Object.entries(check.summary).map(([k, v]) => (
            <div key={k}><dt>{k}</dt><dd>{v ?? <span className="muted">—</span>}</dd></div>
          ))}
        </dl>
      </div>
      <ul className="checklist-items">
        {check.items.map((i) => (
          <li key={i.key} className={`ck-${i.status}`}><span className="ck-icon">{ICON[i.status]}</span> <strong>{i.label}</strong> — {i.detail}</li>
        ))}
      </ul>
    </>
  );
}

export function ApplicationPanel({ jobId, applicationUrl }: { jobId: number; applicationUrl: string }) {
  const [app, setApp] = useState<ApplicationDetail | null>();
  const [check, setCheck] = useState<FinalCheckResult>();
  const [sim, setSim] = useState<SimulationReport>();
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [save, setSave] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [confirming, setConfirming] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [submitResult, setSubmitResult] = useState<Awaited<ReturnType<typeof api.submitApplication>>>();

  useEffect(() => {
    api.applicationByJob(jobId).then((a) => {
      setApp(a);
      if (a) api.finalCheck(a.id).then(setCheck).catch(() => undefined);
    }).catch((e: Error) => setError(e.message));
  }, [jobId]);

  const ensureApp = async (): Promise<ApplicationDetail> => {
    if (app) return app;
    const created = await api.applicationForJob(jobId);
    setApp(created);
    return created;
  };

  const simulate = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const a = await ensureApp();
      const r = await api.simulate(a.id, { answers, saveToBank: Object.keys(save).filter((k) => save[k] && answers[k]) });
      setSim(r);
      setCheck(r.check);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    if (!app || !sim?.report.digest) return;
    setBusy(true);
    setError(undefined);
    try {
      const r = await api.submitApplication(app.id, { expectedDigest: sim.report.digest, answers });
      setSubmitResult(r);
      setApp(r.application);
      setConfirming(false);
      setCheck(await api.finalCheck(app.id));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const canSubmit = !!sim && sim.result.status === 'simulated' && sim.check.ready && !sim.submissionBlocker && !!sim.report.digest && !submitResult;

  const setMode = async (mode: string) => {
    const a = await ensureApp();
    await api.setMode(a.id, mode || null);
    setApp({ ...a, mode: mode || null });
    setCheck(await api.finalCheck(a.id));
  };

  return (
    <Card title="Application">
      {error && <Notice kind="error">{error}</Notice>}
      <div className="row">
        <label className="inline">Mode for this offer:
          <select value={app?.mode ?? ''} onChange={(e) => setMode(e.target.value)} style={{ width: 'auto' }}>
            <option value="">Global setting{check ? ` (${check.mode})` : ''}</option>
            <option value="FULL_AUTO">FULL_AUTO</option><option value="SEMI_AUTO">SEMI_AUTO</option><option value="MANUAL">MANUAL</option>
          </select>
        </label>
        {app && <Link to={`/tracker?app=${app.id}`}>Tracker: {app.status}</Link>}
      </div>

      {check && <Checklist check={check} />}

      <Notice kind="info">
        “Simulate” opens the application page in a controlled browser, fills what is known, attaches your CV and letter,
        takes a screenshot and shows exactly what would be sent — without clicking submit. It stops on CAPTCHA, sign-in or verification codes.
        {check?.submissionBlocker ? <div><strong>Submission disabled:</strong> {check.submissionBlocker}</div> : <div><strong>Real submission is enabled</strong>: after a complete simulation you can submit with your explicit confirmation.</div>}
      </Notice>
      <div className="row">
        <button onClick={simulate} disabled={busy}>{busy ? 'Simulating…' : sim ? 'Simulate again with my answers' : 'Simulate application'}</button>
        <a href={applicationUrl} target="_blank" rel="noreferrer noopener">Open the application page myself</a>
        <button className="submit-btn" disabled={!canSubmit || busy} title={canSubmit ? '' : sim?.submissionBlocker ?? check?.submissionBlocker ?? 'Run a complete simulation first'} onClick={() => setConfirming(true)}>Submit application</button>
      </div>

      {confirming && sim && (
        <div className="confirm-box danger-box">
          <h3>Submit this application for real?</h3>
          <p>
            You are about to send your application for <strong>{String(sim.check.summary.Position)}</strong> at <strong>{String(sim.check.summary.Company)}</strong>,
            with {String(sim.check.summary.CV)} and {String(sim.check.summary['Cover Letter'])}. The page will be re-opened and re-filled; the button is clicked only
            if everything is identical to the simulation you reviewed. <strong>This cannot be undone.</strong>
          </p>
          <label className="inline"><input type="checkbox" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} /> I reviewed the CV, the cover letter and every answer above.</label>
          <div className="row">
            <button className="danger-solid" disabled={!reviewed || busy} onClick={submit}>{busy ? 'Submitting…' : 'Yes, submit now'}</button>
            <button className="secondary" onClick={() => setConfirming(false)}>Cancel</button>
          </div>
        </div>
      )}

      {submitResult && (
        <Notice kind={submitResult.result.status === 'submitted' ? 'success' : 'error'}>
          {submitResult.result.status === 'submitted' && <>Submitted and <strong>confirmed by the website</strong>: “{submitResult.result.submission?.outcome.evidence}”. The application is now APPLIED.</>}
          {submitResult.result.status === 'aborted' && <>Not sent: {submitResult.result.abortReason}</>}
          {submitResult.result.status === 'form_errors' && <>The website reported errors: {submitResult.result.submission?.outcome.evidence}. Not counted as applied.</>}
          {submitResult.result.status === 'unconfirmed' && <>The button was clicked but the website showed no confirmation. Check your e-mail or the site; if you receive a confirmation, record it in the tracker. Not counted as applied.</>}
          {['blocked', 'error', 'needs_input'].includes(submitResult.result.status) && <>Not sent: {submitResult.result.blocker?.detail ?? submitResult.result.error ?? 'the form needs your answers again.'}</>}
        </Notice>
      )}

      {sim && (
        <div className="sim">
          <Notice kind={sim.result.status === 'simulated' ? 'success' : sim.result.status === 'needs_input' ? 'warning' : 'error'}>
            {sim.result.status === 'simulated' && 'Simulation complete: every required field would be filled. Nothing was sent.'}
            {sim.result.status === 'needs_input' && 'Simulation stopped: some questions need you (below). Nothing was sent.'}
            {sim.result.status === 'blocked' && `Stopped: ${sim.result.blocker?.detail} Please handle it yourself in the browser — the app never tries to get around it.`}
            {sim.result.status === 'error' && `Could not open the application page: ${sim.result.error}`}
            {sim.result.submitButton !== undefined && sim.result.status !== 'blocked' && <div className="small">Submit button found: “{sim.result.submitButton ?? 'none'}” — not clicked.</div>}
          </Notice>

          {sim.report.questionsForYou.length + sim.report.toConfirm.length > 0 && (
            <>
              <h3>Questions for you</h3>
              {[...sim.report.questionsForYou.map((q) => ({ ...q, proposed: undefined as string | undefined })), ...sim.report.toConfirm.map((q) => ({ ...q, type: 'text', options: [] as string[] }))].map((q) => (
                <div key={q.label} className="question">
                  <div><strong>{q.label}</strong> <small className="muted">{q.reason}</small></div>
                  <div className="row">
                    {q.options.length ? (
                      <select value={answers[q.label] ?? ''} onChange={(e) => setAnswers({ ...answers, [q.label]: e.target.value })} style={{ maxWidth: 360 }}>
                        <option value="">Choose…</option>
                        {q.options.map((o) => <option key={o}>{o}</option>)}
                      </select>
                    ) : (
                      <textarea rows={q.type === 'textarea' ? 3 : 1} value={answers[q.label] ?? q.proposed ?? ''} onChange={(e) => setAnswers({ ...answers, [q.label]: e.target.value })} />
                    )}
                    <label className="inline small"><input type="checkbox" checked={!!save[q.label]} onChange={(e) => setSave({ ...save, [q.label]: e.target.checked })} /> save to Answer Bank</label>
                  </div>
                </div>
              ))}
            </>
          )}

          {sim.report.wouldFill.length > 0 && (
            <>
              <h3>What would be sent</h3>
              <table className="table">
                <thead><tr><th>Field</th><th>Value</th><th>Source</th><th>Checked</th></tr></thead>
                <tbody>
                  {sim.report.wouldFill.map((f) => (
                    <tr key={f.label}><td>{f.label}</td><td className="value-cell">{f.actual.length > 160 ? `${f.actual.slice(0, 160)}…` : f.actual}</td><td className="muted">{f.source.replace('_', ' ')}</td><td>{f.verified ? '✓' : <span className="error-text">✗</span>}</td></tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
          {sim.report.leftEmpty.length > 0 && <p className="muted small">Left empty: {sim.report.leftEmpty.map((l) => l.label).join(', ')}</p>}
          {sim.result.screenshotUrl && <img className="shot" src={sim.result.screenshotUrl} alt="What the form looked like before submission" />}
        </div>
      )}
    </Card>
  );
}
