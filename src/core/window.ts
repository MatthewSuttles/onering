// Window resolution (onering-build-spec.md §3.4).
//
// Maps a model id to its context-window size, honoring an explicit override, a
// harness-supplied window, and the `[1m]` / exceeds-200k hints. This is a
// heuristic until harnesses expose a native window_size field, at which point the
// adapter passes it through via inbound.windowHint.windowSize and this collapses.

const ONE_MILLION = 1_000_000;
const TWO_HUNDRED_K = 200_000;

/** Known exact windows by model-id substring. Longest/most-specific first. */
const KNOWN: Array<[RegExp, number]> = [
  [/gpt-4\.1|gpt-4o|o3|o4/i, 128_000],
  [/gemini-1\.5|gemini-2|gemini-exp/i, ONE_MILLION],
  [/claude-(opus|sonnet|haiku|fable)/i, TWO_HUNDRED_K],
];

export interface WindowHint {
  exceeds200k?: boolean;
  windowSize?: number;
}

/**
 * Resolve the context window in tokens.
 * Priority: explicit override > harness-supplied size > 1m hint > known map > default.
 */
export function resolveWindow(
  modelId: string | undefined | null,
  hint?: WindowHint,
  override?: number,
): number {
  if (override && override > 0) return override;
  if (hint?.windowSize && hint.windowSize > 0) return hint.windowSize;

  const id = modelId ?? "";
  // A `[1m]` tag or a turn that already exceeded 200k both imply the 1m variant.
  if (/\[1m\]|\b1m\b/i.test(id)) return ONE_MILLION;
  if (hint?.exceeds200k) return ONE_MILLION;

  for (const [re, size] of KNOWN) {
    if (re.test(id)) return size;
  }
  return TWO_HUNDRED_K;
}
