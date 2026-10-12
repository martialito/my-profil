import type { CandidateProfile, CandidateProfileInput } from '../../models/profile';
import type { MasterCvVersion } from '../../models/master-cv';
import type { Settings, SettingsSection } from '../../models/settings';
import type { CvExtractionDraft } from '../../cv/extraction-types';

export class ApiError extends Error {
  constructor(message: string, public status: number, public details?: unknown) {
    super(message);
  }
}

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, headers: {} };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { 'Content-Type': 'application/json' };
  }
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = (data as { error?: { message?: string; details?: unknown } }).error;
    throw new ApiError(err?.message ?? `HTTP ${res.status}`, res.status, err?.details);
  }
  return data as T;
}

export interface Completeness { score: number; missing: string[] }
export interface TopJob {
  id: number; company: string; title: string; startDate: string | null; periodHints: string[]; jobStatus: string; applicationUrl: string | null; sourceUrl: string;
  score: number | null; category: string | null; dateStatus: string | null; applicationId: number | null; applicationStatus: string | null; hasResume: boolean | number; hasLetter: boolean | number;
}
export interface DashboardData {
  lastSearch: SearchRun | null;
  lastAnalysis: { createdAt: string } | null;
  stats: Record<
    'totalJobs' | 'newJobs' | 'matchingJobs' | 'highMatch' | 'applications' | 'applicationsPrepared' | 'applicationsSubmitted' | 'needsValidation' | 'responses' | 'interviews' | 'offers' | 'rejected',
    number
  >;
  topJobs: TopJob[];
  recentEvents: Array<{ id: number; message: string | null; toStatus: string | null; createdAt: string; company: string; title: string; applicationId: number }>;
  notifications: NotificationCounts;
  profile: Completeness;
  masterCv: { version: number; createdAt: string } | null;
  testMode: boolean;
  applicationMode: string;
}
export interface NotificationCounts { unread: number; actionRequired: number }
export interface AppNotification { id: number; type: string; level: string; title: string; message: string; link: string | null; readAt: string | null; createdAt: string }
export interface ApplicationRow {
  id: number; jobId: number; company: string; title: string; location: string | null; startDate: string | null; periodHints: string[]; applicationUrl: string | null; sourceUrl: string;
  status: string; mode: string | null; isSimulation: boolean; applicationDate: string | null; submittedAt: string | null; confirmationSource: string | null; followUpDate: string | null;
  notes: string | null; resumeVersion: number | null; letterVersion: number | null; score: number | null; category: string | null; updatedAt: string;
}
export interface ApplicationDetail extends ApplicationRow {
  confirmationText: string | null; confirmationUrl: string | null; resumeId: number | null; coverLetterId: number | null;
  events: Array<{ id: number; type: string; fromStatus: string | null; toStatus: string | null; message: string | null; createdAt: string }>;
}
export interface TransitionInput { to: string; note?: string; applicationDate?: string; confirmationText?: string; confirmationUrl?: string }
export interface CvImportResult { id: number; originalFilename: string; sha256: string; method: 'heuristic' | 'llm'; textLength: number; draft: CvExtractionDraft }
export interface CvImportRow { id: number; originalFilename: string; sizeBytes: number; status: string; extractionMethod: string | null; error: string | null; createdAt: string; sha256: string }

export interface JobRow {
  id: number; company: string; title: string; location: string | null; locationMatch: string | null; salary: string | null;
  postedDate: string | null; startDate: string | null; endDate: string | null; internshipDuration: string | null; periodHints: string[];
  department: string | null; sourceUrl: string; applicationUrl: string | null; source: string | null; status: string;
  closedAt: string | null; createdAt: string; score: number | null; category: string | null; dateStatus: string | null; duplicates: number;
}
export interface JobDetail extends Omit<JobRow, 'score' | 'category' | 'dateStatus' | 'duplicates'> {
  description: string | null; requirements: string[]; responsibilities: string[]; skills: string[]; employmentType: string | null;
  workplaceType: string | null; sourceName: string | null; duplicatesOf: number | null; lastSeenAt: string | null;
  related: Array<{ id: number; title: string; company: string; sourceUrl: string; source: string | null }>;
  analysis: null | Analysis;
}
export interface DateCheck {
  status: 'COMPATIBLE' | 'INCOMPATIBLE' | 'UNKNOWN'; score: number | null; precision: string;
  period: { start?: string; end?: string; durationMonths?: number }; flexible: boolean; autoSubmitSafe: boolean; reasons: string[];
}
export interface Analysis {
  id: number; overallScore: number; category: 'GREEN' | 'YELLOW' | 'RED'; dateStatus: string; dateCompatibility: number | null;
  locationCompatibility: number | null; skillsMatch: number | null; experienceMatch: number | null; educationMatch: number | null;
  preferencesMatch: number | null; reasons: string[]; missingRequirements: string[]; redFlags: string[]; matchedSkills: string[];
  missingSkills: string[]; dateDetails: DateCheck | null; model: string | null; costUsd: number | null; createdAt: string;
  scoreDetails: { caps: Array<{ max: number; reason: string }>; notes: string[]; rawFormulaScore: number; masterCvVersion: number } | null;
}
export interface TruthViolation { type: string; message: string }
export interface JobDocuments {
  resume: null | { id: number; version: number; createdAt: string; content: import('../../models/master-cv').MasterCvContent; checks: { repaired: TruthViolation[]; violations: TruthViolation[]; warnings: string[]; changes: string[] } | null };
  coverLetter: null | { id: number; version: number; createdAt: string; content: string; editedByUser: boolean; checks: { issues: string[]; needsReview: boolean; wordCount: number } | null };
}
export interface Precheck { date: DateCheck; locationMatch: string; internship: { isInternship: boolean; reason?: string } }
export interface AnalysisSummary { analyzed: number; green: number; yellow: number; red: number; errors: Array<{ jobId: number; company: string; title: string; reason: string }>; costUsd: number }
export interface Board { id: number; provider: 'greenhouse' | 'lever'; token: string; companyName: string; enabled: boolean; lastFetchedAt: string | null; lastError: string | null; lastJobCount: number | null }
export interface SearchStats { boards: number; fetched: number; kept: number; newJobs: number; updated: number; duplicatesGrouped: number; filteredNotInternship: number; filteredNotNyc: number; closed: number; errors: number }
export interface SearchRun { id: number; trigger: string; startedAt: string; finishedAt: string | null; stats: SearchStats | null; errors: Array<{ board: string; reason: string }> | null }
export interface SearchQuery { domain: string; query: string; keywords: string; links: Array<{ platform: string; url: string }> }
export interface JobSource { id: number; key: string; name: string; kind: string; automationAllowed: boolean; notes: string | null }
export interface ManualJobInput { url: string; company?: string; title?: string; location?: string; description?: string; salary?: string }

export const api = {
  jobs: (params: Record<string, string>) => call<{ total: number; items: JobRow[] }>('GET', `/api/jobs?${new URLSearchParams(params)}`),
  job: (id: number) => call<JobDetail>('GET', `/api/jobs/${id}`),
  setJobStatus: (id: number, status: string) => call<JobDetail>('PATCH', `/api/jobs/${id}/status`, { status }),
  precheck: (id: number) => call<Precheck>('GET', `/api/jobs/${id}/precheck`),
  analyzeJob: (id: number) => call<JobDetail>('POST', `/api/jobs/${id}/analyze`),
  analyzePending: (limit?: number) => call<AnalysisSummary>('POST', '/api/analysis/run', limit ? { limit } : {}),
  documents: (id: number) => call<JobDocuments>('GET', `/api/jobs/${id}/documents`),
  generateDocuments: (id: number, body: { what: 'all' | 'resume' | 'cover-letter'; guidance?: string; force?: boolean }) => call<JobDocuments>('POST', `/api/jobs/${id}/documents`, body),
  saveLetter: (id: number, text: string) => call<JobDocuments>('PUT', `/api/jobs/${id}/documents/cover-letter`, { text }),
  generatePending: (limit?: number) => call<{ cvs: number; letters: number; errors: Array<{ jobId: number; company: string; title: string; reason: string }> }>('POST', '/api/documents/generate-pending', limit ? { limit } : {}),
  applications: (params: Record<string, string> = {}) => call<ApplicationRow[]>('GET', `/api/applications?${new URLSearchParams(params)}`),
  application: (id: number) => call<ApplicationDetail>('GET', `/api/applications/${id}`),
  applicationForJob: (jobId: number) => call<ApplicationDetail>('POST', `/api/applications/for-job/${jobId}`),
  transition: (id: number, input: TransitionInput) => call<ApplicationDetail>('POST', `/api/applications/${id}/transition`, input),
  updateApplication: (id: number, patch: { notes?: string | null; followUpDate?: string | null }) => call<ApplicationDetail>('PATCH', `/api/applications/${id}`, patch),
  notifications: (unread = false) => call<{ items: AppNotification[]; counts: NotificationCounts }>('GET', `/api/notifications${unread ? '?unread=true' : ''}`),
  notificationCounts: () => call<NotificationCounts>('GET', '/api/notifications/counts'),
  readNotification: (id: number) => call<NotificationCounts>('POST', `/api/notifications/${id}/read`),
  readAllNotifications: () => call<NotificationCounts>('POST', '/api/notifications/read-all'),
  ungroupJob: (id: number) => call<JobDetail>('POST', `/api/jobs/${id}/ungroup`),
  importJob: (input: ManualJobInput) => call<{ kind: string; id: number; of?: number; warnings: string[] }>('POST', '/api/jobs/manual', input),
  jobSources: () => call<JobSource[]>('GET', '/api/jobs/sources'),
  boards: () => call<Board[]>('GET', '/api/search/boards'),
  addBoard: (input: { url?: string; provider?: string; token?: string; companyName?: string }) => call<Board>('POST', '/api/search/boards', input),
  updateBoard: (id: number, patch: { enabled?: boolean; companyName?: string }) => call<Board>('PATCH', `/api/search/boards/${id}`, patch),
  removeBoard: (id: number) => fetch(`/api/search/boards/${id}`, { method: 'DELETE' }),
  runSearch: () => call<{ runId: number; stats: SearchStats; errors: Array<{ board: string; reason: string }> }>('POST', '/api/search/run'),
  searchRuns: () => call<SearchRun[]>('GET', '/api/search/runs'),
  searchQueries: () => call<SearchQuery[]>('GET', '/api/search/queries'),
  dashboard: () => call<DashboardData>('GET', '/api/dashboard'),
  getProfile: () => call<{ profile: CandidateProfile; completeness: Completeness }>('GET', '/api/profile'),
  saveProfile: (p: CandidateProfileInput) => call<{ profile: CandidateProfile; completeness: Completeness }>('PUT', '/api/profile', p),
  getSettings: () => call<{ settings: Settings; env: { testModeForced: boolean; llmConfigured: boolean } }>('GET', '/api/settings'),
  saveSettings: <K extends SettingsSection>(section: K, value: Partial<Settings[K]>) => call<{ settings: Settings }>('PUT', `/api/settings/${section}`, value),
  resetSettings: (section: SettingsSection) => call<{ settings: Settings }>('DELETE', `/api/settings/${section}`),
  masterCv: () => call<{ latest: MasterCvVersion | null; versions: Array<Omit<MasterCvVersion, 'content'>> }>('GET', '/api/master-cv'),
  masterCvVersion: (v: number) => call<MasterCvVersion>('GET', `/api/master-cv/versions/${v}`),
  snapshotMasterCv: (notes?: string) => call<MasterCvVersion>('POST', '/api/master-cv/snapshot', { notes }),
  importCv: (file: File, useLlm: boolean) => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('useLlm', String(useLlm));
    return call<CvImportResult>('POST', '/api/cv/import', fd);
  },
  cvImports: () => call<CvImportRow[]>('GET', '/api/cv/imports'),
  verifyCv: (id: number) => call<{ intact: boolean }>('GET', `/api/cv/imports/${id}/verify`),
};
