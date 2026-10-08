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
export interface DashboardData {
  stats: Record<
    'totalJobs' | 'newJobs' | 'matchingJobs' | 'highMatch' | 'applicationsPrepared' | 'applicationsSubmitted' | 'needsValidation' | 'interviews' | 'offers' | 'rejected',
    number
  >;
  profile: Completeness;
  masterCv: { version: number; createdAt: string } | null;
  testMode: boolean;
  applicationMode: string;
}
export interface CvImportResult { id: number; originalFilename: string; sha256: string; method: 'heuristic' | 'llm'; textLength: number; draft: CvExtractionDraft }
export interface CvImportRow { id: number; originalFilename: string; sizeBytes: number; status: string; extractionMethod: string | null; error: string | null; createdAt: string; sha256: string }

export const api = {
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
