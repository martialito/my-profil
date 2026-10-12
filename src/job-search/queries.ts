import type { CandidateProfile } from '../models/profile.js';
import type { Settings } from '../models/settings.js';

/**
 * Search queries generated from the profile (section 37). They drive the *manual* search links for
 * platforms that forbid automated access (LinkedIn, Indeed, Glassdoor, Welcome to the Jungle):
 * the user opens them in their own browser and imports interesting offers by URL.
 */

const DEFAULT_DOMAINS = ['marketing', 'business', 'tourism', 'hospitality', 'sales', 'operations', 'communications'];
const STOP = /\b(intern(ship)?s?|summer|spring|fall|stagiaire|assistant|junior|trainee|the|and|of|in|at|nyc|new york)\b/gi;

function domainOf(title: string): string | undefined {
  const d = title.toLowerCase().replace(STOP, ' ').replace(/[^a-z& ]+/g, ' ').replace(/\s+/g, ' ').trim();
  return d.length >= 3 && d.split(' ').length <= 3 ? d : undefined;
}

export interface SearchQuery {
  domain: string;
  query: string;
  keywords: string;
  links: Array<{ platform: string; url: string }>;
}

export function generateSearchQueries(profile: CandidateProfile, settings: Settings, max = 15): SearchQuery[] {
  const year = settings.search.availabilityStart.slice(0, 4);
  const titles = [...settings.search.jobTitles, ...profile.preferences.preferredJobTitles];
  const industries = [...settings.search.industries, ...profile.preferences.preferredIndustries];
  const fromExperience = profile.experiences.map((e) => e.title);

  const domains: string[] = [];
  const add = (d?: string) => {
    if (d && !domains.includes(d)) domains.push(d);
  };
  titles.forEach((t) => add(domainOf(t)));
  industries.forEach((i) => add(i.toLowerCase().trim()));
  fromExperience.forEach((t) => add(domainOf(t)));
  if (domains.length < 5) DEFAULT_DOMAINS.forEach(add);

  return domains.slice(0, max).map((domain) => {
    const keywords = `${domain} intern`;
    const query = `${keywords} New York ${year}`;
    const k = encodeURIComponent(keywords);
    return {
      domain,
      query,
      keywords,
      links: [
        { platform: 'LinkedIn', url: `https://www.linkedin.com/jobs/search/?keywords=${k}&location=New%20York%2C%20New%20York%2C%20United%20States&f_E=1` },
        { platform: 'Indeed', url: `https://www.indeed.com/jobs?q=${k}&l=New+York%2C+NY` },
        { platform: 'Glassdoor', url: `https://www.glassdoor.com/Job/new-york-ny-${domain.replace(/\s+/g, '-')}-intern-jobs-SRCH_IL.0,11_IC1132348.htm` },
        { platform: 'Welcome to the Jungle', url: `https://www.welcometothejungle.com/en/jobs?query=${k}&aroundQuery=New%20York` },
        { platform: 'Google Jobs', url: `https://www.google.com/search?q=${encodeURIComponent(query)}&ibp=htl;jobs` },
      ],
    };
  });
}
