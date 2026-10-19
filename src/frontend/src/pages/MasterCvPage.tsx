import { useEffect, useMemo, useState } from 'react';
import type { CandidateProfile } from '../../../models/profile';
import type { MasterCvContent, MasterCvVersion } from '../../../models/master-cv';
import { api } from '../api';
import { Card, Notice } from '../components';

type VersionMeta = Omit<MasterCvVersion, 'content'>;

/** Compare profile and master content ignoring ids and preferences. */
function comparable(c: Omit<CandidateProfile, 'preferences'> | MasterCvContent): string {
  return JSON.stringify(c, (k, v) => (k === 'id' || k === 'preferences' ? undefined : v));
}

const range = (s?: string, e?: string, current?: boolean) => [s ?? '?', current ? 'Present' : (e ?? '?')].join(' – ');

/** documentView: show exactly what the generated PDF/DOCX contains (bullets only, no per-role description/tools). */
export function CvPreview({ content, documentView = false }: { content: MasterCvContent; documentView?: boolean }) {
  const p = content.personal;
  const byCat = (c: string) => content.skills.filter((s) => s.category === c);
  return (
    <article className="cv-preview">
      <h2>{[p.firstName, p.lastName].filter(Boolean).join(' ')}</h2>
      {content.headline && <p className="cv-headline">{content.headline}</p>}
      <p className="muted">{[p.email, p.phone, p.currentLocation, p.linkedin, p.portfolio, p.website].filter(Boolean).join(' · ')}</p>
      {content.summary && <p>{content.summary}</p>}
      {content.experiences.length > 0 && <h3>Experience</h3>}
      {content.experiences.map((e, i) => (
        <div key={i} className="cv-entry">
          <div className="cv-entry-head">
            <strong>{e.title}</strong> — {e.company}
            {e.location ? `, ${e.location}` : ''}
            <span className="muted">{range(e.startDate, e.endDate, e.isCurrent)}</span>
          </div>
          {!documentView && e.description && <p>{e.description}</p>}
          {e.achievements.length > 0 && (
            <ul>{e.achievements.map((a, j) => <li key={j}>{a}</li>)}</ul>
          )}
          {!documentView && (e.technologies.length > 0 || e.skills.length > 0) && <small className="muted">{[...e.technologies, ...e.skills].join(', ')}</small>}
        </div>
      ))}
      {content.education.length > 0 && <h3>Education</h3>}
      {content.education.map((e, i) => (
        <div key={i} className="cv-entry">
          <div className="cv-entry-head">
            <strong>{[e.degree, e.field].filter(Boolean).join(', ') || e.school}</strong> — {e.school}
            <span className="muted">{range(e.startDate, e.endDate)}</span>
          </div>
          {e.gpa && <small>GPA: {e.gpa}</small>}
          {e.description && <p>{e.description}</p>}
        </div>
      ))}
      {content.skills.length > 0 && <h3>Skills</h3>}
      {(['technical', 'language', 'soft', 'certification'] as const).map((c) =>
        byCat(c).length ? (
          <p key={c}>
            <strong>{c[0]!.toUpperCase() + c.slice(1)}:</strong> {byCat(c).map((s) => (s.level ? `${s.name} (${s.level})` : s.name)).join(', ')}
          </p>
        ) : null,
      )}
    </article>
  );
}

export function MasterCvPage() {
  const [latest, setLatest] = useState<MasterCvVersion | null>(null);
  const [versions, setVersions] = useState<VersionMeta[]>([]);
  const [shown, setShown] = useState<MasterCvVersion | null>(null);
  const [profile, setProfile] = useState<CandidateProfile>();
  const [notes, setNotes] = useState('');
  const [msg, setMsg] = useState<{ kind: 'error' | 'success'; text: string }>();

  const load = () =>
    Promise.all([api.masterCv(), api.getProfile()]).then(([mc, pr]) => {
      setLatest(mc.latest);
      setVersions(mc.versions);
      setShown(mc.latest);
      setProfile(pr.profile);
    });
  useEffect(() => {
    Promise.all([api.masterCv(), api.getProfile()])
      .then(([mc, pr]) => {
        setLatest(mc.latest);
        setVersions(mc.versions);
        setShown(mc.latest);
        setProfile(pr.profile);
      })
      .catch((e: Error) => setMsg({ kind: 'error', text: e.message }));
  }, []);

  const outdated = useMemo(() => {
    if (!profile || !latest) return false;
    const { preferences: _ignored, ...rest } = profile;
    return comparable(rest) !== comparable(latest.content);
  }, [profile, latest]);

  const snapshot = async () => {
    setMsg(undefined);
    try {
      const v = await api.snapshotMasterCv(notes || undefined);
      setNotes('');
      await load();
      setMsg({ kind: 'success', text: `Master CV v${v.version} created.` });
    } catch (e) {
      setMsg({ kind: 'error', text: (e as Error).message });
    }
  };

  return (
    <>
      <h1>Master CV</h1>
      <p className="muted">
        The Master CV is a frozen, versioned snapshot of your verified profile. It is the single source of truth: every tailored CV
        and cover letter will be generated from it and checked against it (no invented experience, degree, skill, date or result).
      </p>
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
      {outdated && <Notice kind="warning">Your profile has changed since v{latest!.version}. Create a new version to use the changes.</Notice>}
      {!latest && <Notice kind="info">No Master CV yet. Fill in and save your profile, then create version 1.</Notice>}

      <Card title="Create a new version from the current profile">
        <div className="row">
          <input placeholder="Notes (optional), e.g. 'Added hotel internship'" value={notes} onChange={(e) => setNotes(e.target.value)} />
          <button onClick={snapshot}>Create version</button>
        </div>
      </Card>

      <div className="two-col">
        <Card title="Versions">
          {versions.length === 0 && <p className="muted">None yet.</p>}
          <ul className="version-list">
            {versions.map((v) => (
              <li key={v.id}>
                <button className={`link${shown?.version === v.version ? ' active' : ''}`} onClick={() => api.masterCvVersion(v.version).then(setShown)}>
                  v{v.version}
                </button>{' '}
                <small className="muted">{new Date(v.createdAt).toLocaleString()}</small>
                {v.notes && <div><small>{v.notes}</small></div>}
              </li>
            ))}
          </ul>
        </Card>
        <Card title={shown ? `Version ${shown.version}` : 'Preview'}>{shown ? <CvPreview content={shown.content} /> : <p className="muted">—</p>}</Card>
      </div>
    </>
  );
}
