import { describe, expect, it } from 'vitest';
import { loadPrompt, renderPrompt } from '../src/llm/prompts.js';
import { normalizeLlmExtraction } from '../src/cv/llm-extractor.js';
import type { LlmCvExtraction } from '../src/cv/extraction-types.js';
import { AnthropicProvider } from '../src/llm/anthropic-provider.js';

describe('prompts', () => {
  it('loads prompt files and renders variables', () => {
    const t = loadPrompt('cv-extraction');
    expect(t).toContain('{{cv_text}}');
    expect(renderPrompt(t, { cv_text: 'HELLO' })).toContain('HELLO');
  });
  it('fails loudly on missing variables and bad names', () => {
    expect(() => renderPrompt('Hi {{name}}', {})).toThrow(/name/);
    expect(() => loadPrompt('../etc/passwd')).toThrow();
  });
});

describe('Anthropic provider', () => {
  it('reports not configured without API key and refuses to call', async () => {
    const p = new AnthropicProvider();
    expect(p.isConfigured()).toBe(false);
    await expect(
      p.complete({ prompt: 'x' }, { model: 'claude-opus-5-5', maxTokens: 100, temperature: null, effort: 'low', refusalFallback: false }),
    ).rejects.toThrow(/ANTHROPIC_API_KEY/);
  });
});

describe('LLM CV extraction normalisation', () => {
  const base: LlmCvExtraction = {
    personal: { firstName: 'Alex', lastName: 'Martin', email: 'alex@example.com', phone: null, currentLocation: null, linkedin: null, portfolio: null, website: null },
    headline: null,
    summary: null,
    education: [],
    experiences: [
      { company: 'Hotel Lumière', title: 'Intern', location: null, startDate: '2025-06', endDate: 'summer', isCurrent: false, description: null, achievements: [], technologies: [], skills: [] },
      { company: 'Hallucinated Corp', title: 'Analyst', location: null, startDate: null, endDate: null, isCurrent: false, description: null, achievements: [], technologies: [], skills: [] },
    ],
    skills: [{ category: 'technical', name: 'Excel', level: null }],
    uncertainFields: ['experiences[0].title'],
  };
  const cv = 'Alex Martin alex@example.com\nHotel Lumière — Intern 06/2025\nSkills: Excel';

  it('flags facts absent from the source text and drops malformed dates', () => {
    const d = normalizeLlmExtraction(base, cv);
    expect(d.experiences[0]!.endDate).toBeUndefined();
    expect(d.warnings.join('\n')).toMatch(/Hallucinated Corp/);
    expect(d.warnings.join('\n')).toMatch(/unreadable date "summer"/);
    expect(d.warnings.join('\n')).toMatch(/Uncertain: experiences\[0\]\.title/);
    expect(d.warnings.join('\n')).not.toMatch(/Hotel Lumière" not found/);
  });
});
