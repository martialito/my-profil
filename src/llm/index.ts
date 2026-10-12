import { env } from '../config/env.js';
import type { Settings } from '../models/settings.js';
import { AnthropicProvider } from './anthropic-provider.js';
import type { LlmConfig, LlmProvider } from './types.js';

export * from './types.js';
export { loadPrompt, renderPrompt } from './prompts.js';

const providers: Record<string, () => LlmProvider> = {
  anthropic: () => new AnthropicProvider(),
};

let override: LlmProvider | undefined;

/** Tests inject a fake provider here. */
export function setLlmProviderForTests(p: LlmProvider | undefined): void {
  override = p;
}

export function getLlmProvider(name: string = env().LLM_PROVIDER): LlmProvider {
  if (override) return override;
  const factory = providers[name];
  if (!factory) throw new Error(`Unknown LLM provider "${name}"`);
  return factory();
}

export function llmConfigFromSettings(s: Settings['llm']): LlmConfig {
  return {
    model: s.model,
    maxTokens: s.maxTokens,
    temperature: s.temperature,
    effort: s.effort,
    refusalFallback: s.refusalFallback,
  };
}
