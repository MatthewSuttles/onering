// OpenCode adapter (onering-build-spec.md §4.4).
//
// In-process: OpenCode hands token usage straight to plugins on message.updated
// (info.tokens), so there is no transcript to parse — usage() reads it directly.
// The plugin entry (src/plugin/opencode.ts) builds the InboundEvent and drives the
// shared core, so threshold synthesis and sinks are identical to every other
// harness.

import type { CanonicalEvent, HarnessAdapter, InboundEvent, UsageBlock } from "../core/types.js";

/** OpenCode token shapes have varied across versions; read defensively. */
export function usageFromTokens(tokens: any, window: number): UsageBlock | null {
  if (!tokens) return null;
  const input = tokens.input ?? tokens.input_tokens ?? 0;
  const output = tokens.output ?? tokens.output_tokens ?? 0;
  const cacheRead = tokens.cache?.read ?? tokens.cache_read ?? 0;
  const cacheWrite = tokens.cache?.write ?? tokens.cache_creation ?? 0;
  const used = input + cacheRead + cacheWrite;
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
      cache_read_input_tokens: cacheRead,
      cache_creation_input_tokens: cacheWrite,
    },
  };
}

const EVENT_MAP: Record<string, CanonicalEvent> = {
  "message.updated": "model.pre",
  "session.start": "session.start",
  "session.end": "session.end",
  "experimental.session.compacting": "compact.pre",
};

interface OpenCodeRaw {
  event: string;
  tokens?: any;
  window?: number;
  sessionId?: string | null;
  model?: string;
  isCompactionBoundary?: boolean;
}

export const opencodeAdapter: HarnessAdapter = {
  name: "opencode",

  // In-process only; never dispatched by payload shape.
  detect() {
    return false;
  },

  toInbound(payload: unknown): InboundEvent {
    const p = (payload ?? {}) as OpenCodeRaw;
    const canonical = EVENT_MAP[p.event] ?? "unknown";
    return {
      harness: "opencode",
      event: p.event,
      canonicalEvent: canonical,
      sessionId: p.sessionId ?? null,
      model: p.model,
      transcriptPath: null,
      isCompactionBoundary: p.isCompactionBoundary ?? canonical === "compact.pre",
      windowHint: { windowSize: p.window },
      raw: payload,
    };
  },

  usage(inbound: InboundEvent): UsageBlock | null {
    const p = inbound.raw as OpenCodeRaw;
    const window = p.window && p.window > 0 ? p.window : inbound.windowHint?.windowSize ?? 200_000;
    return usageFromTokens(p.tokens, window);
  },

  // OpenCode enforcement (client.session.summarize) is handled in the plugin, not
  // through a rendered command decision.
  emitDecision() {
    return { exitCode: 0 };
  },
};
