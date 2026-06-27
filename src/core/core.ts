// The core flow (onering-build-spec.md §3.2).
//
//   handle(inbound, adapter):
//     usage   = adapter.usage(inbound) ?? usageFromTranscript(inbound.transcriptPath)
//     window  = resolveWindow(inbound.model, usage)
//     env     = buildEnvelope(inbound, usage, window)
//     sinks.emit(env)
//     for t in crossings(...): sinks.emit(thresholdEnvelope(env, t))
//     return adapter.emitDecision(policy(env))

import type {
  Decision,
  Envelope,
  HarnessAdapter,
  InboundEvent,
  OneringConfig,
  RenderedDecision,
  Sink,
} from "./types.js";
import { resolveWindow } from "./window.js";
import { usageFromTranscript } from "./usage.js";
import { buildEnvelope, thresholdEnvelope } from "./envelope.js";
import { policy } from "./policy.js";
import { emitToSinks, builtinSinks } from "./sinks/index.js";
import { FileThresholdStore, type ThresholdStore } from "./threshold.js";

export interface HandleOptions {
  config: OneringConfig;
  /** ISO timestamp; injectable for deterministic tests. */
  now?: () => string;
  sinks?: Sink[];
  store?: ThresholdStore;
}

export interface HandleResult {
  envelope: Envelope;
  thresholds: Envelope[];
  decision: Decision;
  rendered: RenderedDecision;
}

/** Run one inbound event end to end. Pure except for the sinks and the store. */
export async function handle(
  inbound: InboundEvent,
  adapter: HarnessAdapter,
  opts: HandleOptions,
): Promise<HandleResult> {
  const { config } = opts;
  const now = opts.now ?? (() => new Date().toISOString());
  const sinks = opts.sinks ?? builtinSinks;
  const store = opts.store ?? new FileThresholdStore(config.statePath);

  // 1) Usage: native first, transcript fallback. Resolve the window, then recompute
  //    percentages against it (the transcript parser assumes 200k until told).
  const window = resolveWindow(
    inbound.model,
    { ...inbound.windowHint },
    config.windowOverride,
  );
  let usage = adapter.usage(inbound);
  let source: Envelope["source"] = usage ? sourceForHarness(inbound) : "unavailable";
  if (!usage) {
    usage = usageFromTranscript(inbound.transcriptPath, window);
    if (usage) source = "transcript";
  }
  // If a transcript turn proved the 1m window, re-resolve and rescale.
  let resolvedWindow = window;
  if (usage) {
    resolvedWindow = resolveWindow(
      inbound.model ?? usage.lastModel,
      { exceeds200k: usage.exceeds200k, windowSize: inbound.windowHint?.windowSize },
      config.windowOverride,
    );
    if (resolvedWindow !== usage.context.window_size) {
      usage = rescale(usage, resolvedWindow);
    }
  }

  // 2) Build and fan out the primary envelope.
  const ts = now();
  const env = buildEnvelope({ inbound, usage, source, config, ts });

  // 3) Synthetic threshold crossings (the event no harness emits natively).
  const thresholds: Envelope[] = [];
  if (env.context && env.session_id) {
    const crossed = store.crossings(
      env.session_id,
      env.context.used_pct,
      config.thresholds,
      inbound.isCompactionBoundary,
    );
    for (const t of crossed) thresholds.push(thresholdEnvelope(env, t));
  } else if (inbound.isCompactionBoundary && env.session_id) {
    // No usage but a compaction happened: still reset the crossing state.
    store.crossings(env.session_id, 0, config.thresholds, true);
  }

  // 4) Emit everything.
  await emitToSinks(env, config, inbound, sinks);
  for (const t of thresholds) await emitToSinks(t, config, inbound, sinks);

  // 5) Decide and render in the harness's dialect.
  const decision = policy(env, config);
  env.decision = decision;
  const rendered = adapter.emitDecision(decision, inbound);

  return { envelope: env, thresholds, decision, rendered };
}

function sourceForHarness(inbound: InboundEvent): Envelope["source"] {
  if (inbound.harness === "opencode") return "event";
  if (inbound.harness === "codex") return "rollout";
  return "event";
}

function rescale(usage: NonNullable<ReturnType<HarnessAdapter["usage"]>>, window: number) {
  const used = usage.context.used_tokens;
  const usedPct = Math.round((used / window) * 1000) / 10;
  return {
    ...usage,
    context: {
      used_tokens: used,
      window_size: window,
      used_pct: usedPct,
      remaining_pct: Math.round((100 - usedPct) * 10) / 10,
    },
  };
}
