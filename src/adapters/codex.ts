// Codex CLI adapter (onering-build-spec.md §4.5) — out-of-band, degraded.
//
// Codex exposes only a notification hook in-loop, so there is no blocking surface.
// onering runs as a side process (src/bin/onering-codex.ts) that tails
// ~/.codex/sessions rollouts and reads token_count events (a cumulative running
// total per session). Capabilities: observe and emit envelopes + threshold events
// only. No deny, no modify, no inject.

import type { HarnessAdapter, InboundEvent, UsageBlock } from "../core/types.js";

/** Extract fill from a Codex token_count payload. Shapes vary; read defensively.
 *  Codex reports cumulative totals, and the input side (incl. cached) is the fill. */
export function usageFromTokenCount(tc: any, window: number): UsageBlock | null {
  if (!tc) return null;
  // Common shapes: { input_tokens, cached_input_tokens, output_tokens } or nested
  // under total_token_usage / info.
  const t = tc.total_token_usage ?? tc.info?.total_token_usage ?? tc.total ?? tc;
  const input = t.input_tokens ?? t.prompt_tokens ?? 0;
  const cached = t.cached_input_tokens ?? t.cache_read_input_tokens ?? t.cached_tokens ?? 0;
  const output = t.output_tokens ?? t.completion_tokens ?? 0;
  // Codex's input_tokens is typically inclusive of cached; if a separate cached
  // figure is given and input excludes it, summing would double count. Treat the
  // larger of (input) and (input+cached only when input looks non-inclusive).
  const used = input >= cached ? input : input + cached;
  if (used <= 0 && output <= 0) return null;
  const usedPct = Math.round((used / window) * 1000) / 10;
  return {
    context: {
      used_tokens: used,
      window_size: window,
      used_pct: usedPct,
      remaining_pct: Math.round((100 - usedPct) * 10) / 10,
    },
    breakdown: {
      input_tokens: input,
      output_tokens: output,
      cache_read_input_tokens: cached,
      cache_creation_input_tokens: 0,
    },
  };
}

interface CodexRaw {
  tokenCount: any;
  sessionId: string | null;
  model?: string;
  window?: number;
  isCompactionBoundary?: boolean;
}

export const codexAdapter: HarnessAdapter = {
  name: "codex",

  detect() {
    return false; // never dispatched by stdin payload; driven by the tailer
  },

  toInbound(payload: unknown): InboundEvent {
    const p = (payload ?? {}) as CodexRaw;
    return {
      harness: "codex",
      event: "token_count",
      canonicalEvent: "model.pre",
      sessionId: p.sessionId ?? null,
      model: p.model,
      transcriptPath: null,
      isCompactionBoundary: p.isCompactionBoundary ?? false,
      windowHint: { windowSize: p.window },
      raw: payload,
    };
  },

  usage(inbound: InboundEvent): UsageBlock | null {
    const p = inbound.raw as CodexRaw;
    const window = p.window && p.window > 0 ? p.window : inbound.windowHint?.windowSize ?? 200_000;
    return usageFromTokenCount(p.tokenCount, window);
  },

  // Observe-only: no deny, no modify, no inject.
  emitDecision() {
    return { exitCode: 0 };
  },
};
