import type { NormalizedJob } from '../../models/job.js';
import type { FetchJson } from '../http.js';

export interface BoardRef {
  provider: 'greenhouse' | 'lever';
  token: string;
  companyName: string;
}

/**
 * A connector for a source whose terms allow automated access through a public API.
 * Sources that forbid automation (LinkedIn, Indeed, Glassdoor…) have NO connector:
 * they are handled through generated search links + manual import.
 */
export interface BoardConnector {
  readonly provider: BoardRef['provider'];
  /** Board display name, used to validate a token. Throws SourceError if the board does not exist. */
  boardInfo(token: string, fetchJson: FetchJson): Promise<{ name: string; jobCount: number }>;
  listJobs(board: BoardRef, fetchJson: FetchJson): Promise<NormalizedJob[]>;
  getJob(token: string, id: string, fetchJson: FetchJson, companyName?: string): Promise<NormalizedJob>;
}
