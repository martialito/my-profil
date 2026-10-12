import { NavLink, Route, Routes } from 'react-router-dom';
import { DashboardPage } from './pages/DashboardPage';
import { JobDetailsPage } from './pages/JobDetailsPage';
import { JobsPage } from './pages/JobsPage';
import { SourcesPage } from './pages/SourcesPage';
import { MasterCvPage } from './pages/MasterCvPage';
import { ProfilePage } from './pages/ProfilePage';
import { SettingsPage } from './pages/SettingsPage';

const PLANNED = [
  { label: 'Application Tracker', phase: 5 },
  { label: 'Answer Bank', phase: 6 },
];

export function App() {
  return (
    <div className="layout">
      <nav className="sidebar">
        <div className="brand">NYC Internship Agent</div>
        <NavLink to="/" end>Dashboard</NavLink>
        <NavLink to="/jobs">Job Search</NavLink>
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
          <Route path="/jobs" element={<JobsPage />} />
          <Route path="/jobs/:id" element={<JobDetailsPage />} />
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
