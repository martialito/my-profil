import type { z } from 'zod';
import type { LlmJobAnalysis } from '../../src/job-analysis/schema.js';
import type { LlmConfig, LlmProvider, LlmRequest } from '../../src/llm/types.js';

/** Deterministic LLM double: returns canned structured output and records requests. */
export class FakeLlm implements LlmProvider {
  readonly name = 'fake';
  requests: LlmRequest[] = [];
  constructor(private readonly respond: (req: LlmRequest) => unknown) {}
  isConfigured() {
    return true;
  }
  async complete(req: LlmRequest, _c: LlmConfig) {
    this.requests.push(req);
    return { text: String(this.respond(req)), usage: { inputTokens: 100, outputTokens: 50, model: 'claude-opus-5-5' } };
  }
  async completeStructured<S extends z.ZodType>(req: LlmRequest, schema: S, _c: LlmConfig) {
    this.requests.push(req);
    return { data: schema.parse(this.respond(req)) as z.infer<S>, usage: { inputTokens: 3000, outputTokens: 800, cacheReadTokens: 2000, model: 'claude-opus-5-5' } };
  }
}

export function llmAnalysis(overrides: Partial<LlmJobAnalysis> = {}): LlmJobAnalysis {
  return {
    seniority: 'internship',
    employment_type: 'internship',
    skills_required: ['Excel', 'Social media marketing'],
    skills_preferred: ['Canva'],
    matched_skills: [
      { skill: 'Excel', evidence: 'Excel' },
      { skill: 'Social media marketing', evidence: 'Social media marketing' },
      { skill: 'Canva', evidence: 'Canva' },
    ],
    missing_skills: [],
    missing_requirements: [],
    skills_match: 95,
    experience_match: 90,
    education_match: 95,
    preferences_match: 90,
    stated_period: { start: null, end: null, duration_months: null, evidence: null },
    sponsorship: { statement: 'not_stated', evidence: null },
    reasons: ['Hotel front-office experience matches the guest-facing responsibilities.'],
    red_flags: [],
    ...overrides,
  };
}
