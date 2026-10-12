import { useEffect, useState } from 'react';
import { api, type JobDocuments } from '../api';
import { Card, Notice } from '../components';
import { CvPreview } from './MasterCvPage';

export function DocumentsPanel({ jobId, category }: { jobId: number; category: string | null }) {
  const [docs, setDocs] = useState<JobDocuments>();
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const [guidance, setGuidance] = useState('');
  const [draft, setDraft] = useState<string>();
  const [tab, setTab] = useState<'cv' | 'letter'>('cv');

  useEffect(() => {
    api.documents(jobId).then(setDocs).catch((e: Error) => setError(e.message));
  }, [jobId]);

  const run = async (label: string, fn: () => Promise<JobDocuments>) => {
    setBusy(label);
    setError(undefined);
    try {
      setDocs(await fn());
      setDraft(undefined);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(undefined);
    }
  };
  const generate = (what: 'all' | 'resume' | 'cover-letter', force = false) =>
    run(what, () => api.generateDocuments(jobId, { what, guidance: guidance || undefined, force: force || undefined }));

  const red = category === 'RED';
  const notAnalysed = category === null;
  const r = docs?.resume;
  const l = docs?.coverLetter;

  return (
    <Card title="Customized CV & cover letter">
      {error && <Notice kind="error">{error}</Notice>}
      {notAnalysed && <p className="muted">Analyse the offer first.</p>}
      {red && !r && <Notice kind="info">This offer is RED: nothing is prepared automatically. You can still generate documents yourself.</Notice>}
      <div className="row">
        <input placeholder="Optional guidance, e.g. “emphasise my hotel experience” (not new facts)" value={guidance} onChange={(e) => setGuidance(e.target.value)} />
        {!notAnalysed && (
          <button onClick={() => generate('all', red)} disabled={!!busy}>
            {busy === 'all' ? 'Generating…' : r || l ? 'Regenerate both' : red ? 'Generate anyway' : 'Generate CV + letter'}
          </button>
        )}
      </div>

      {(r || l) && (
        <div className="tabs">
          <button className={tab === 'cv' ? 'tab active' : 'tab'} onClick={() => setTab('cv')}>CV {r ? `v${r.version}` : ''}</button>
          <button className={tab === 'letter' ? 'tab active' : 'tab'} onClick={() => setTab('letter')}>Cover letter {l ? `v${l.version}` : ''}</button>
        </div>
      )}

      {tab === 'cv' && r && (
        <div>
          <div className="row doc-actions">
            <a href={`/api/documents/resume/${r.id}/pdf`}>Download PDF</a>
            <a href={`/api/documents/resume/${r.id}/docx`}>Download DOCX</a>
            <button className="secondary small" onClick={() => generate('resume', red)} disabled={!!busy}>{busy === 'resume' ? '…' : 'Regenerate CV'}</button>
            <small className="muted">Generated {new Date(r.createdAt).toLocaleString()}</small>
          </div>
          {r.checks && (
            <Notice kind={r.checks.violations.length ? 'error' : 'success'}>
              Truth check: {r.checks.violations.length ? 'FAILED' : 'passed'} — every company, title, date, degree and skill comes from your Master CV.
              {r.checks.repaired.length > 0 && <div>Automatically corrected: <ul>{r.checks.repaired.map((v, i) => <li key={i}>{v.message}</li>)}</ul></div>}
            </Notice>
          )}
          {r.checks?.warnings.length ? <Notice kind="warning"><ul>{r.checks.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></Notice> : null}
          {r.checks?.changes.length ? (<><h3>What was adapted</h3><ul>{r.checks.changes.map((c, i) => <li key={i}>{c}</li>)}</ul></>) : null}
          <div className="doc-preview"><CvPreview content={r.content} documentView /></div>
        </div>
      )}

      {tab === 'letter' && l && (
        <div>
          <div className="row doc-actions">
            <a href={`/api/documents/cover-letter/${l.id}/pdf`}>Download PDF</a>
            <a href={`/api/documents/cover-letter/${l.id}/docx`}>Download DOCX</a>
            <a href={`/api/documents/cover-letter/${l.id}/txt`}>TXT</a>
            <button className="secondary small" onClick={() => generate('cover-letter', red)} disabled={!!busy}>{busy === 'cover-letter' ? '…' : 'Regenerate letter'}</button>
            {l.editedByUser && <span className="badge">edited by you</span>}
          </div>
          {l.checks && (l.checks.issues.length ? (
            <Notice kind="warning">Please review before using: <ul>{l.checks.issues.map((x, i) => <li key={i}>{x}</li>)}</ul></Notice>
          ) : (
            <Notice kind="success">Checks passed: specific to the company, no generic phrases, every figure and claim found in your documents ({l.checks.wordCount} words).</Notice>
          ))}
          <textarea className="letter" rows={18} value={draft ?? l.content} onChange={(e) => setDraft(e.target.value)} />
          {draft !== undefined && draft !== l.content && (
            <div className="row">
              <button onClick={() => run('save', () => api.saveLetter(jobId, draft))} disabled={!!busy}>{busy === 'save' ? 'Saving…' : 'Save my edits (new version)'}</button>
              <button className="secondary" onClick={() => setDraft(undefined)}>Cancel</button>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
