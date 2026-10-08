import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import type { z } from 'zod';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { LlmError, type LlmConfig, type LlmProvider, type LlmRequest, type LlmStructuredResult, type LlmTextResult } from './types.js';

/**
 * Models that reject sampling parameters (temperature/top_p) with a 400.
 * For them the temperature setting is ignored; depth is controlled via `effort`.
 */
const NO_SAMPLING_MODELS = /^claude-(fable|mythos|opus-5|opus-4-[78]|sonnet-5|haiku-5)/;
/** Models accepting the server-side refusal fallback ("default" routing). */
const FALLBACK_MODELS = /^claude-(fable-5-1|opus-5|sonnet-5-5)/;

export class AnthropicProvider implements LlmProvider {
  readonly name = 'anthropic';
  private client: Anthropic | undefined;

  isConfigured(): boolean {
    return !!env().ANTHROPIC_API_KEY;
  }

  private getClient(): Anthropic {
    if (!this.isConfigured()) {
      throw new LlmError('ANTHROPIC_API_KEY is not set in .env', 'not_configured');
    }
    this.client ??= new Anthropic({ apiKey: env().ANTHROPIC_API_KEY });
    return this.client;
  }

  private buildParams(req: LlmRequest, config: LlmConfig) {
    const model = env().ANTHROPIC_MODEL ?? config.model;
    const content: Anthropic.Beta.BetaContentBlockParam[] = [];
    if (req.pdfBase64) {
      content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: req.pdfBase64 } });
    }
    content.push({ type: 'text', text: req.prompt });

    const useFallback = config.refusalFallback && FALLBACK_MODELS.test(model);
    return {
      model,
      max_tokens: config.maxTokens,
      ...(req.system ? { system: req.system } : {}),
      ...(config.temperature !== null && !NO_SAMPLING_MODELS.test(model) ? { temperature: config.temperature } : {}),
      messages: [{ role: 'user' as const, content }],
      ...(useFallback ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
    };
  }

  private check(stopReason: string | null, model: string): void {
    if (stopReason === 'refusal') throw new LlmError(`Model ${model} declined the request`, 'refusal');
    if (stopReason === 'max_tokens') throw new LlmError('Output truncated: increase "Max tokens" in Settings', 'truncated');
  }

  async complete(req: LlmRequest, config: LlmConfig): Promise<LlmTextResult> {
    const params = this.buildParams(req, config);
    try {
      const res = await this.getClient().beta.messages.create({ ...params, output_config: { effort: config.effort } });
      this.check(res.stop_reason, res.model);
      const text = res.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
      return { text, usage: { inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens, model: res.model } };
    } catch (err) {
      throw this.wrap(err);
    }
  }

  async completeStructured<S extends z.ZodType>(req: LlmRequest, schema: S, config: LlmConfig): Promise<LlmStructuredResult<z.infer<S>>> {
    const params = this.buildParams(req, config);
    try {
      const res = await this.getClient().beta.messages.parse({
        ...params,
        output_config: { effort: config.effort, format: betaZodOutputFormat(schema) },
      });
      this.check(res.stop_reason, res.model);
      if (res.parsed_output == null) throw new LlmError('Model output did not match the expected schema', 'invalid_output');
      return {
        data: res.parsed_output as z.infer<S>,
        usage: { inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens, model: res.model },
      };
    } catch (err) {
      throw this.wrap(err);
    }
  }

  private wrap(err: unknown): Error {
    if (err instanceof LlmError) return err;
    if (err instanceof Anthropic.AuthenticationError) return new LlmError('Invalid ANTHROPIC_API_KEY', 'api', err);
    if (err instanceof Anthropic.RateLimitError) return new LlmError('Anthropic rate limit reached, retry later', 'api', err);
    if (err instanceof Anthropic.APIError) {
      logger.error('Anthropic API error', { status: err.status, message: err.message });
      return new LlmError(`Anthropic API error ${err.status ?? ''}: ${err.message}`, 'api', err);
    }
    return new LlmError(err instanceof Error ? err.message : String(err), 'api', err);
  }
}
