import { useCallback, useEffect, useState } from 'react';
import { NavLink, Route, Routes } from 'react-router-dom';
import { api, type NotificationCounts } from './api';
import { DashboardPage } from './pages/DashboardPage';
import { JobDetailsPage } from './pages/JobDetailsPage';
import { JobsPage } from './pages/JobsPage';
import { MasterCvPage } from './pages/MasterCvPage';
import { NotificationsPage } from './pages/NotificationsPage';
import { ProfilePage } from './pages/ProfilePage';
import { SettingsPage } from './pages/SettingsPage';
import { SourcesPage } from './pages/SourcesPage';
import { TrackerPage } from './pages/TrackerPage';

const PLANNED = [{ label: 'Answer Bank', phase: 6 }];

export function App() {
  const [counts, setCounts] = useState<NotificationCounts>({ unread: 0, actionRequired: 0 });
  const refresh = useCallback(() => {
    api.notificationCounts().then(setCounts).catch(() => undefined);
  }, []);
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 60_000);
    return () => clearInterval(t);
  }, [refresh]);

  return (
    <div className="layout">
      <nav className="sidebar">
        <div className="brand">NYC Internship Agent</div>
        <NavLink to="/" end>Dashboard</NavLink>
        <NavLink to="/notifications">
          Notifications {counts.unread > 0 && <span className={`count ${counts.actionRequired ? 'urgent' : ''}`}>{counts.unread}</span>}
        </NavLink>
        <NavLink to="/jobs">Job Search</NavLink>
        <NavLink to="/tracker">Application Tracker</NavLink>
        <NavLink to="/sources">Sources</NavLink>
        <NavLink to="/profile">My Profile</NavLink>
        <NavLink to="/master-cv">Master CV</NavLink>
        <NavLink to="/settings">Settings</NavLink>
        <div className="nav-section">Coming next</div>
        {PLANNED.map((p) => (
          <span key={p.label} className="nav-disabled" title={`Planned for Phase ${p.phase}`}>
            {p.label} <small>Phase {p.phase}</small>
          </span>
        ))}
      </nav>
      <main className="content">
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/notifications" element={<NotificationsPage onChange={refresh} />} />
          <Route path="/jobs" element={<JobsPage />} />
          <Route path="/jobs/:id" element={<JobDetailsPage />} />
          <Route path="/tracker" element={<TrackerPage />} />
          <Route path="/sources" element={<SourcesPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/master-cv" element={<MasterCvPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<p>Page not found.</p>} />
        </Routes>
      </main>
    </div>
  );
}
