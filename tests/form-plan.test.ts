import { describe, expect, it } from 'vitest';
import type { BankEntry } from '../src/application/answer-matching.js';
import { planForm, type FormField } from '../src/application/form-plan.js';
import { CandidateProfileSchema } from '../src/models/profile.js';
import { sampleProfile } from './helpers.js';

const profile = CandidateProfileSchema.parse(sampleProfile());
const bank: BankEntry[] = [
  { id: 1, question: 'Will you require visa sponsorship?', aliases: [], answer: 'Yes', requiresConfirmation: false, category: 'sponsorship' },
  { id: 2, question: 'When can you start?', aliases: [], answer: 'March 2027', requiresConfirmation: false, category: 'availability' },
];
const f = (id: string, label: string, type: FormField['type'] = 'text', required = true, options: string[] = []): FormField => ({ id, label, type, required, options });

describe('form filling plan', () => {
  const ctx = { profile, bank, resumePath: '/gen/resume.pdf', coverLetterPath: '/gen/letter.pdf', coverLetterText: 'Dear Hiring Team, …' };

  it('fills identity fields from the profile and documents from the generated files', () => {
    const plan = planForm([f('a', 'First Name*'), f('b', 'Last name'), f('c', 'Email', 'email'), f('d', 'Phone'), f('e', 'LinkedIn Profile', 'url', false), f('r', 'Resume/CV', 'file'), f('l', 'Cover Letter', 'file', false)], ctx);
    expect(plan.items.map((i) => [i.field.id, i.value, i.source])).toEqual([
      ['a', 'Alex', 'profile'],
      ['b', 'Martin', 'profile'],
      ['c', 'alex.martin@example.com', 'profile'],
      ['d', '+33 6 12 34 56 78', 'profile'],
      ['e', 'https://linkedin.com/in/alex-martin-example', 'profile'],
      ['r', '/gen/resume.pdf', 'resume'],
      ['l', '/gen/letter.pdf', 'cover_letter'],
    ]);
    expect(plan.complete).toBe(true);
  });

  it('answers known questions and maps them to the options', () => {
    const plan = planForm([f('s', 'Will you now require visa sponsorship?', 'select', true, ['Yes', 'No']), f('t', 'When can you start?')], ctx);
    expect(plan.items[1]).toMatchObject({ status: 'ready', value: 'March 2027', source: 'answer_bank' });
    expect(plan.items[0]!.status).toBe('needs_confirmation'); // "now" changes the meaning
  });

  it('stops on unknown required questions and never invents answers', () => {
    const plan = planForm([f('q', 'Why do you want to work at Hudson Hotels?', 'textarea'), f('o', 'Anything else you would like to share?', 'textarea', false)], ctx);
    expect(plan.items[0]).toMatchObject({ status: 'needs_input', source: 'none' });
    expect(plan.items[1]).toMatchObject({ status: 'skipped' });
    expect(plan.complete).toBe(false);
  });

  it('never answers voluntary self-identification questions on its own', () => {
    const plan = planForm([f('g', 'Gender', 'select', false, ['Male', 'Female', 'Decline to self-identify']), f('v', 'Veteran status', 'select', true, ['I am not a veteran', 'Decline'])], ctx);
    expect(plan.items[0]!.status).toBe('skipped');
    expect(plan.items[1]!.status).toBe('needs_input');
  });

  it('uses your answers for this application, checking select options', () => {
    const fields = [f('q', 'Why do you want to work at Hudson Hotels?', 'textarea'), f('x', 'Preferred shift', 'select', true, ['Morning', 'Evening'])];
    const plan = planForm(fields, { ...ctx, userAnswers: { q: 'Because …', x: 'Night' } });
    expect(plan.items[0]).toMatchObject({ status: 'ready', source: 'user' });
    expect(plan.items[1]).toMatchObject({ status: 'needs_input' });
  });

  it('missing documents block the upload', () => {
    const plan = planForm([f('r', 'Resume', 'file')], { profile, bank });
    expect(plan.items[0]!.status).toBe('needs_input');
  });
});
