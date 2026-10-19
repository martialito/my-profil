/** Approximate USD prices per million tokens (input, output) used to estimate analysis cost. */
const PRICES: Array<[RegExp, number, number]> = [
  [/^claude-fable-5/, 10, 50],
  [/^claude-opus-5-5/, 4, 20],
  [/^claude-opus-(5|4-[678])/, 5, 25],
  [/^claude-sonnet-5/, 2, 10],
  [/^claude-sonnet-4-6/, 3, 15],
  [/^claude-haiku-5-5/, 0.1, 0.5],
  [/^claude-haiku-4-5/, 1, 5],
];

export function estimateCostUsd(model: string, u: { inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheWriteTokens?: number }): number | null {
  const p = PRICES.find(([re]) => re.test(model));
  if (!p) return null;
  const [, inP, outP] = p;
  const input = u.inputTokens + 1.25 * (u.cacheWriteTokens ?? 0) + 0.1 * (u.cacheReadTokens ?? 0);
  return Math.round(((input * inP + u.outputTokens * outP) / 1e6) * 10000) / 10000;
}
