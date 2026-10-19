import type { z } from 'zod';

export interface LlmConfig {
  model: string;
  maxTokens: number;
  temperature: number | null;
  effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  refusalFallback: boolean;
}

export interface LlmRequest {
  system?: string;
  prompt: string;
  /** Optional attached document (e.g. a PDF CV) sent alongside the prompt. */
  pdfBase64?: string;
  /**
   * Large context identical across many calls (e.g. the Master CV). Sent first and marked
   * cacheable so repeated job analyses reuse it (prompt caching).
   */
  cachedContext?: string;
}

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  model: string;
}

export interface LlmTextResult {
  text: string;
  usage: LlmUsage;
}

export interface LlmStructuredResult<T> {
  data: T;
  usage: LlmUsage;
}

/** Provider-agnostic interface: swap Anthropic for another vendor by implementing this. */
export interface LlmProvider {
  readonly name: string;
  isConfigured(): boolean;
  complete(req: LlmRequest, config: LlmConfig): Promise<LlmTextResult>;
  completeStructured<S extends z.ZodType>(req: LlmRequest, schema: S, config: LlmConfig): Promise<LlmStructuredResult<z.infer<S>>>;
}

export class LlmError extends Error {
  constructor(
    message: string,
    public readonly kind: 'not_configured' | 'refusal' | 'truncated' | 'invalid_output' | 'api',
    public override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'LlmError';
  }
}
