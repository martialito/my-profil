import { describe, expect, it } from 'vitest';
import { checkLetter, letterText } from '../src/cover-letter/letter.js';

const src = {
  masterCv: 'Front Office Intern at Hotel Lumière. Raised guest satisfaction score by 12%. Managed Instagram account (5k followers).',
  motivations: 'I want to learn how large hotel groups run marketing in New York.',
  job: 'Hudson Hotels is looking for a Marketing Intern to support social media campaigns.',
};
const body = (extra = '') =>
  `Dear Hiring Team,\n\n${'Hudson Hotels social campaigns rely on guest insight. '.repeat(10)}At Hotel Lumière I raised guest satisfaction score by 12%. ${extra}\n\nBest regards,\nAlex Martin`;

describe('cover letter checks', () => {
  it('accepts a grounded letter', () => {
    const r = checkLetter(body(' '.repeat(1) + 'word '.repeat(150)), [{ statement: 'raised satisfaction', source: 'master_cv', quote: 'Raised guest satisfaction score by 12%' }], src, { company: 'Hudson Hotels', title: 'Marketing Intern' });
    expect(r.issues).toEqual([]);
  });

  it('flags stock phrases, missing company, unverified claims and invented figures', () => {
    const text = 'Dear Sir,\n\nI am writing to express my keen interest in this role. I increased sales by 30%.\n\nBest regards,';
    const r = checkLetter(text, [{ statement: 'increased sales', source: 'master_cv', quote: 'increased sales by 30%' }], src, { company: 'Hudson Hotels', title: 'Marketing Intern' });
    expect(r.stockPhrases).toEqual(['i am writing to express my', 'keen interest']);
    expect(r.unverifiedClaims).toEqual(['increased sales']);
    expect(r.inventedNumbers).toEqual(['30%']);
    expect(r.issues.join(' ')).toMatch(/never names the company/);
  });

  it('renders plain text with the signature', () => {
    expect(letterText({ greeting: 'Dear Hiring Team,', paragraphs: ['One.', 'Two.'], sign_off: 'Best regards,' }, 'Alex Martin')).toBe(
      'Dear Hiring Team,\n\nOne.\n\nTwo.\n\nBest regards,\nAlex Martin\n',
    );
  });
});
