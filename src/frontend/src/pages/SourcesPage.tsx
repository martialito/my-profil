import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError, type Board, type JobSource, type ManualJobInput, type SearchQuery, type SearchRun, type SearchStats } from '../api';
import { Card, Field, Notice } from '../components';

type Msg = { kind: 'error' | 'success' | 'warning' | 'info'; text: string };

function statsLine(s: SearchStats): string {
  return `${s.fetched} offers fetched from ${s.boards} board(s) · ${s.kept} NYC internships kept · ${s.newJobs} new · ${s.updated} already known · ${s.duplicatesGrouped} duplicates grouped · ${s.filteredNotInternship} non-internships and ${s.filteredNotNyc} non-NYC filtered out${s.closed ? ` · ${s.closed} closed` : ''}`;
}

export function SourcesPage() {
  const [boards, setBoards] = useState<Board[]>([]);
  const [runs, setRuns] = useState<SearchRun[]>([]);
  const [queries, setQueries] = useState<SearchQuery[]>([]);
  const [sources, setSources] = useState<JobSource[]>([]);
  const [msg, setMsg] = useState<Msg>();
  const [busy, setBusy] = useState(false);
  const [boardUrl, setBoardUrl] = useState('');
  const [boardName, setBoardName] = useState('');
  const [manual, setManual] = useState<ManualJobInput>({ url: '' });

  const refresh = () =>
    Promise.all([api.boards(), api.searchRuns()]).then(([b, r]) => {
      setBoards(b);
      setRuns(r);
    });
  useEffect(() => {
    Promise.all([api.boards(), api.searchRuns(), api.searchQueries(), api.jobSources()])
      .then(([b, r, q, s]) => {
        setBoards(b);
        setRuns(r);
        setQueries(q);
        setSources(s);
      })
      .catch((e: Error) => setMsg({ kind: 'error', text: e.message }));
  }, []);

  const guard = async (fn: () => Promise<void>) => {
    setMsg(undefined);
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setMsg({ kind: 'error', text: e instanceof ApiError ? e.message : (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const addBoard = () =>
    guard(async () => {
      const b = await api.addBoard({ url: boardUrl.trim(), companyName: boardName || undefined });
      setBoardUrl('');
      setBoardName('');
      await refresh();
      setMsg({ kind: 'success', text: `${b.companyName} added (${b.lastJobCount ?? 0} open positions on the board).` });
    });

  const run = () =>
    guard(async () => {
      const r = await api.runSearch();
      await refresh();
      setMsg({ kind: r.errors.length ? 'warning' : 'success', text: statsLine(r.stats) + (r.errors.length ? ` · ${r.errors.length} board error(s), see below` : '') });
    });

  const importJob = () =>
    guard(async () => {
      const clean = Object.fromEntries(Object.entries(manual).filter(([, v]) => v)) as unknown as ManualJobInput;
      const r = await api.importJob(clean);
      setManual({ url: '' });
      setMsg({ kind: r.warnings.length ? 'warning' : 'success', text: `${r.kind === 'updated' ? 'Offer refreshed' : 'Offer imported'} (#${r.id}). ${r.warnings.join(' ')}` });
    });

  const isAts = /(greenhouse\.io|jobs\.lever\.co)/i.test(manual.url);

  return (
    <>
      <h1>Sources & search</h1>
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}

      <Card title="Company job boards (automatic)" actions={<button onClick={run} disabled={busy || boards.every((b) => !b.enabled)}>{busy ? 'Working…' : 'Run search now'}</button>}>
        <p className="muted">
          Greenhouse and Lever publish public job-board APIs intended for listing offers, so these boards are fetched automatically
          (politely, one board per second). Only <strong>internships</strong> located in <strong>NYC</strong> (or near NYC; remote only if your
          profile accepts remote work) are kept.
        </p>
        <div className="row">
          <input placeholder="Board URL, e.g. https://job-boards.greenhouse.io/acme or https://jobs.lever.co/acme" value={boardUrl} onChange={(e) => setBoardUrl(e.target.value)} />
          <input style={{ maxWidth: 220 }} placeholder="Company name (optional)" value={boardName} onChange={(e) => setBoardName(e.target.value)} />
          <button onClick={addBoard} disabled={busy || !boardUrl}>Add board</button>
        </div>
        <small className="hint">Tip: open a company's careers page; if job links point to boards.greenhouse.io/&lt;name&gt; or jobs.lever.co/&lt;name&gt;, paste that link here.</small>
        {boards.length > 0 && (
          <table className="table">
            <thead><tr><th>Company</th><th>Provider</th><th>Token</th><th>Open positions</th><th>Last fetch</th><th>Enabled</th><th /></tr></thead>
            <tbody>
              {boards.map((b) => (
                <tr key={b.id}>
                  <td>{b.companyName}</td>
                  <td>{b.provider}</td>
                  <td><code>{b.token}</code></td>
                  <td>{b.lastJobCount ?? '—'}</td>
                  <td>{b.lastFetchedAt ? new Date(b.lastFetchedAt).toLocaleString() : 'never'}{b.lastError && <div className="error-text">{b.lastError}</div>}</td>
                  <td><input type="checkbox" checked={b.enabled} onChange={(e) => guard(async () => { await api.updateBoard(b.id, { enabled: e.target.checked }); await refresh(); })} /></td>
                  <td><button className="danger small" onClick={() => guard(async () => { await api.removeBoard(b.id); await refresh(); })}>Remove</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card title="Import an offer manually">
        <p className="muted">
          For LinkedIn, Indeed, Glassdoor, Welcome to the Jungle, Workday or company sites, pages are <strong>never fetched</strong> automatically:
          paste the URL and copy the offer text. Greenhouse/Lever job links are fetched through their public API.
        </p>
        <div className="grid">
          <Field label="Offer URL *" wide><input value={manual.url} onChange={(e) => setManual({ ...manual, url: e.target.value })} placeholder="https://…" /></Field>
          {!isAts && (
            <>
              <Field label="Company *"><input value={manual.company ?? ''} onChange={(e) => setManual({ ...manual, company: e.target.value })} /></Field>
              <Field label="Job title *"><input value={manual.title ?? ''} onChange={(e) => setManual({ ...manual, title: e.target.value })} /></Field>
              <Field label="Location"><input value={manual.location ?? ''} onChange={(e) => setManual({ ...manual, location: e.target.value })} /></Field>
              <Field label="Salary (if stated)"><input value={manual.salary ?? ''} onChange={(e) => setManual({ ...manual, salary: e.target.value })} /></Field>
              <Field label="Full description *" wide><textarea rows={6} value={manual.description ?? ''} onChange={(e) => setManual({ ...manual, description: e.target.value })} /></Field>
            </>
          )}
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <button onClick={importJob} disabled={busy || !manual.url}>Import offer</button>
          <Link to="/jobs">See all offers →</Link>
        </div>
      </Card>

      <Card title="Search links (manual search on platforms that forbid automation)">
        <p className="muted">Generated from your profile (job titles, industries, experience). Open them in your browser, then import interesting offers above.</p>
        <table className="table">
          <thead><tr><th>Query</th><th>Open on</th></tr></thead>
          <tbody>
            {queries.map((q) => (
              <tr key={q.query}>
                <td>{q.query}</td>
                <td className="links">{q.links.map((l) => <a key={l.platform} href={l.url} target="_blank" rel="noreferrer noopener">{l.platform}</a>)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card title="Search history">
        {runs.length === 0 && <p className="muted">No search run yet.</p>}
        <ul className="runs">
          {runs.map((r) => (
            <li key={r.id}>
              <strong>{new Date(r.startedAt).toLocaleString()}</strong> ({r.trigger}) — {r.stats ? statsLine(r.stats) : 'running or interrupted'}
              {r.errors?.map((e, i) => <div key={i} className="error-text">[ERROR] {e.board}: {e.reason}</div>)}
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Sources policy">
        <table className="table">
          <thead><tr><th>Source</th><th>Automated access</th><th>Notes</th></tr></thead>
          <tbody>
            {sources.map((s) => (
              <tr key={s.key}><td>{s.name}</td><td>{s.automationAllowed ? 'Yes (public API)' : 'No — manual only'}</td><td className="muted">{s.notes}</td></tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}
