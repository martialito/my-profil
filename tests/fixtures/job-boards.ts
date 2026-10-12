/**
 * Fake API responses shaped like the documented Greenhouse Job Board API and Lever Postings API.
 * Companies and offers are fictional.
 */
const esc = (html: string) => html.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const greenhouseBoard = { name: 'Hudson Hotels Group', content: '' };

export const greenhouseJobs = {
  jobs: [
    {
      id: 1001,
      title: 'Marketing Intern (Spring 2027)',
      absolute_url: 'https://job-boards.greenhouse.io/hudsonhotels/jobs/1001?gh_src=abc',
      updated_at: '2026-10-01T12:00:00-04:00',
      first_published: '2026-09-28T09:00:00-04:00',
      location: { name: 'New York, NY' },
      departments: [{ name: 'Marketing' }],
      offices: [{ name: 'New York', location: 'New York, NY, United States' }],
      metadata: [{ name: 'Employment Type', value: 'Internship' }],
      content: esc(
        '<p>Join our brand team for a 6-month internship. Start date: March 2027.</p>' +
          '<h3>What you\'ll do</h3><ul><li>Support social media campaigns</li><li>Analyze guest feedback</li></ul>' +
          '<h3>Qualifications</h3><ul><li>Currently enrolled in a business program</li><li>Fluent English</li></ul>' +
          '<p>Pay: $25 - $28 per hour</p>',
      ),
    },
    {
      id: 1002,
      title: 'Senior Marketing Manager',
      absolute_url: 'https://job-boards.greenhouse.io/hudsonhotels/jobs/1002',
      updated_at: '2026-10-01T12:00:00-04:00',
      location: { name: 'New York, NY' },
      content: esc('<p>Lead our marketing team.</p>'),
    },
    {
      id: 1003,
      title: 'Operations Intern',
      absolute_url: 'https://job-boards.greenhouse.io/hudsonhotels/jobs/1003',
      updated_at: '2026-10-01T12:00:00-04:00',
      location: { name: 'Miami, FL' },
      content: esc('<p>Summer 2027 internship in Miami.</p>'),
    },
    {
      id: 1004,
      title: 'Hospitality Intern',
      absolute_url: 'https://job-boards.greenhouse.io/hudsonhotels/jobs/1004',
      updated_at: '2026-10-02T12:00:00-04:00',
      location: { name: 'Brooklyn' },
      content: esc('<p>Summer 2027, 12 weeks, front desk rotation at our Brooklyn property.</p>'),
    },
  ],
  meta: { total: 4 },
};

export const leverPostings = [
  {
    id: 'a1b2c3d4-0000-4000-8000-000000000001',
    text: 'Sales Intern',
    hostedUrl: 'https://jobs.lever.co/brightmedia/a1b2c3d4-0000-4000-8000-000000000001',
    applyUrl: 'https://jobs.lever.co/brightmedia/a1b2c3d4-0000-4000-8000-000000000001/apply',
    createdAt: Date.UTC(2026, 8, 30),
    workplaceType: 'hybrid',
    categories: { location: 'New York City', commitment: 'Intern', team: 'Sales', allLocations: ['New York City'] },
    descriptionPlain: 'Bright Media is hiring a Sales Intern for March - August 2027.',
    lists: [
      { text: 'What you will do', content: '<li>Prospect new clients</li><li>Prepare sales decks</li>' },
      { text: 'Requirements', content: '<li>Excel</li><li>Strong communication</li>' },
    ],
    additionalPlain: '',
    salaryRange: { min: 22, max: 24, currency: 'USD', interval: 'per-hour-wage' },
  },
  {
    id: 'a1b2c3d4-0000-4000-8000-000000000002',
    text: 'Account Executive',
    hostedUrl: 'https://jobs.lever.co/brightmedia/a1b2c3d4-0000-4000-8000-000000000002',
    categories: { location: 'New York City', commitment: 'Full-time' },
    descriptionPlain: 'Full-time sales role.',
    lists: [],
  },
  {
    id: 'a1b2c3d4-0000-4000-8000-000000000003',
    text: 'Communications Intern',
    hostedUrl: 'https://jobs.lever.co/brightmedia/a1b2c3d4-0000-4000-8000-000000000003',
    categories: { location: 'Remote - US', commitment: 'Intern' },
    descriptionPlain: 'Remote communications internship.',
    lists: [],
  },
];

/** Route fake responses by URL. Any unexpected URL fails the test (no real network). */
export function fakeFetch(overrides: Record<string, { status: number; body: unknown }> = {}) {
  const calls: string[] = [];
  const routes: Record<string, { status: number; body: unknown }> = {
    'https://boards-api.greenhouse.io/v1/boards/hudsonhotels': { status: 200, body: greenhouseBoard },
    'https://boards-api.greenhouse.io/v1/boards/hudsonhotels/jobs': { status: 200, body: greenhouseJobs },
    'https://boards-api.greenhouse.io/v1/boards/hudsonhotels/jobs?content=true': { status: 200, body: greenhouseJobs },
    'https://boards-api.greenhouse.io/v1/boards/hudsonhotels/jobs/1001': { status: 200, body: greenhouseJobs.jobs[0] },
    'https://api.lever.co/v0/postings/brightmedia?mode=json': { status: 200, body: leverPostings },
    'https://boards-api.greenhouse.io/v1/boards/doesnotexist': { status: 404, body: { status: 404, error: 'Job not found' } },
    'https://boards-api.greenhouse.io/v1/boards/doesnotexist/jobs': { status: 404, body: {} },
    ...overrides,
  };
  const fn = async (url: string) => {
    calls.push(url);
    const r = routes[url];
    if (!r) throw new Error(`Unexpected network call in test: ${url}`);
    return structuredClone(r);
  };
  return Object.assign(fn, { calls });
}
