import { describe, expect, it } from 'vitest';
import { fitToOptions, matchQuestion, type BankEntry } from '../src/application/answer-matching.js';
import { AnswerBankService } from '../src/services/answer-bank.service.js';
import { ProfileService } from '../src/services/profile.service.js';
import { sampleProfile, testDb } from './helpers.js';

const bank: BankEntry[] = [
  { id: 1, question: 'Are you authorized to work in the United States?', aliases: [], answer: 'No', requiresConfirmation: false, category: 'work_authorization' },
  { id: 2, question: 'Will you require visa sponsorship?', aliases: ['Do you need sponsorship to work in the US?'], answer: 'Yes', requiresConfirmation: false, category: 'sponsorship' },
  { id: 3, question: 'When can you start?', aliases: ['Earliest start date'], answer: 'March 2027', requiresConfirmation: false, category: 'availability' },
  { id: 4, question: 'What are your salary expectations?', aliases: [], answer: null, requiresConfirmation: false, category: 'salary' },
  { id: 5, question: 'Are you willing to relocate?', aliases: [], answer: 'Yes', requiresConfirmation: true, category: 'relocation' },
];

describe('question matching', () => {
  it.each([
    ['Are you legally authorized to work in the U.S.?', 1],
    ['Are you eligible to work in the USA?', 1],
    ['Will you require sponsorship?', 2],
    ['Do you need visa sponsorship to work in the United States?', 2],
    ['What is your earliest start date?', 3],
  ])('recognises "%s"', (q, id) => {
    const r = matchQuestion(q, bank);
    expect(r.status).toBe('matched');
    expect(r.entry?.id).toBe(id);
  });

  it('asks for confirmation when a meaning-changing word differs', () => {
    const r = matchQuestion('Will you in the future require visa sponsorship?', bank);
    expect(r.status).toBe('needs_confirmation');
    expect(r.reason).toMatch(/future/);
  });

  it('flags recognised questions without a configured answer', () => {
    expect(matchQuestion('What are your compensation expectations?', bank).status).toBe('unanswered');
  });

  it('respects "always confirm" entries', () => {
    expect(matchQuestion('Are you willing to relocate?', bank).status).toBe('needs_confirmation');
  });

  it('returns unknown for unrelated questions — never guesses', () => {
    expect(matchQuestion('Describe a time you led a team through conflict.', bank).status).toBe('unknown');
    expect(matchQuestion('What is your favourite hotel brand?', bank).status).toBe('unknown');
  });

  it('fits answers to select options, or refuses', () => {
    expect(fitToOptions('Yes', ['Yes, I will require sponsorship', 'No'])).toBe('Yes, I will require sponsorship');
    expect(fitToOptions('no', ['Yes', 'No'])).toBe('No');
    expect(fitToOptions('Yes', ['Yes - H1B', 'Yes - OPT', 'No'])).toBeUndefined();
    expect(fitToOptions('March 2027', ['Immediately', 'Within 3 months'])).toBeUndefined();
  });
});

describe('AnswerBankService', () => {
  it('seeds default questions with empty answers except your availability', () => {
    const svc = new AnswerBankService(testDb());
    const list = svc.list();
    expect(list.length).toBeGreaterThanOrEqual(9);
    expect(list.find((e) => e.question === 'When can you start?')?.answer).toBe('March 2027');
    expect(list.find((e) => e.question === 'When can you finish?')?.answer).toBe('August 2027');
    expect(list.find((e) => e.question === 'How many months are you available?')?.answer).toBe('6');
    expect(list.find((e) => e.category === 'work_authorization')?.answer).toBeNull();
    expect(list.find((e) => e.category === 'salary')?.answer).toBeNull();
  });

  it('uses My Profile for work authorization when the bank has no answer', () => {
    const db = testDb();
    new ProfileService(db).save(sampleProfile()); // authorized: no, sponsorship: yes
    const svc = new AnswerBankService(db);
    expect(svc.match('Are you authorized to work in the US?')).toMatchObject({ status: 'matched', answer: 'No' });
    expect(svc.match('Do you require sponsorship to work in the US?')).toMatchObject({ status: 'matched', answer: 'Yes' });
  });

  it('CRUD, encryption at rest and aliases', () => {
    const db = testDb();
    const svc = new AnswerBankService(db);
    const e = svc.create({ question: 'Do you speak French?', answer: 'Yes, native' });
    expect(svc.match('Do you speak French fluently?').status).not.toBe('unknown');
    svc.addAlias(e.id, 'Is French your native language?');
    expect(svc.list().find((x) => x.id === e.id)?.aliases).toEqual(['Is French your native language?']);
    const raw = db.$client.prepare('select answer from application_answers where id = ?').get(e.id) as { answer: string };
    expect(raw.answer.startsWith('enc:v1:')).toBe(true);
    svc.remove(e.id);
    expect(svc.list().some((x) => x.id === e.id)).toBe(false);
  });
});
