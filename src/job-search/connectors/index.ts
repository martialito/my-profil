import { greenhouseConnector } from './greenhouse.js';
import { leverConnector } from './lever.js';
import type { BoardConnector, BoardRef } from './types.js';

export const connectors: Record<BoardRef['provider'], BoardConnector> = {
  greenhouse: greenhouseConnector,
  lever: leverConnector,
};

export type { BoardConnector, BoardRef } from './types.js';

/** Recognise a Greenhouse/Lever job or board URL. Other URLs are never fetched. */
export function parseAtsUrl(input: string): { provider: BoardRef['provider']; token: string; jobId?: string } | undefined {
  let u: URL;
  try {
    u = new URL(input);
  } catch {
    return undefined;
  }
  const host = u.hostname.toLowerCase();
  const parts = u.pathname.split('/').filter(Boolean);
  if (/^(boards|job-boards)(\.eu)?\.greenhouse\.io$/.test(host)) {
    if (host.includes('.eu.')) return undefined; // EU instance uses another API host: not supported yet
    if (parts[0] === 'embed') {
      const token = u.searchParams.get('for');
      const jobId = u.searchParams.get('token') ?? undefined;
      return token ? { provider: 'greenhouse', token, jobId } : undefined;
    }
    if (!parts[0]) return undefined;
    return { provider: 'greenhouse', token: parts[0], jobId: parts[1] === 'jobs' ? parts[2] : undefined };
  }
  if (host === 'jobs.lever.co') {
    if (!parts[0]) return undefined;
    return { provider: 'lever', token: parts[0], jobId: parts[1] };
  }
  return undefined;
}

/** Map a job URL's host to a known (manual) source key. */
export function sourceKeyForUrl(url: string): string {
  const host = (() => {
    try {
      return new URL(url).hostname.toLowerCase();
    } catch {
      return '';
    }
  })();
  if (host.includes('linkedin.')) return 'linkedin';
  if (host.includes('indeed.')) return 'indeed';
  if (host.includes('glassdoor.')) return 'glassdoor';
  if (host.includes('welcometothejungle')) return 'welcometothejungle';
  if (host.includes('myworkdayjobs.com') || host.includes('workday')) return 'workday';
  if (host.includes('greenhouse.io')) return 'greenhouse';
  if (host.includes('lever.co')) return 'lever';
  return 'company-site';
}
