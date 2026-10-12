/** Minimal JSON fetcher used by connectors. Injectable so tests never hit the network. */
export type FetchJson = (url: string) => Promise<{ status: number; body: unknown }>;

const USER_AGENT = 'NYC-Internship-Agent/0.2 (personal job search assistant; low volume)';

export const defaultFetchJson: FetchJson = async (url) => {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* non-JSON error page */
  }
  return { status: res.status, body };
};

export class SourceError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = 'SourceError';
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
