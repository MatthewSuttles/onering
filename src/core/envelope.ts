// Envelope assembly (onering-build-spec.md §5).

import type { Envelope, InboundEvent, OneringConfig, UsageBlock } from "./types.js";
import { SCHEMA_VERSION } from "./config.js";

export interface BuildInput {
  inbound: InboundEvent;
  usage: UsageBlock | null;
  source: Envelope["source"];
  config: OneringConfig;
  /** ISO timestamp; injectable so fixtures are deterministic. */
  ts: string;
}

export function buildEnvelope({ inbound, usage, source, config, ts }: BuildInput): Envelope {
  const ctx = usage?.context ?? null;
  const usedPct = ctx?.used_pct ?? null;
  return {
    schema_version: SCHEMA_VERSION,
    ts,
    harness: inbound.harness,
    event: inbound.event,
    canonical_event: inbound.canonicalEvent,
    session_id: inbound.sessionId,
    model: inbound.model ?? usage?.lastModel ?? null,
    context: ctx,
    breakdown: usage?.breakdown ?? null,
    cost: usage?.cost ?? null,
    tool: inbound.tool
      ? { name: inbound.tool.name, input: inbound.tool.input, response: inbound.tool.response }
      : null,
    compaction_imminent: usedPct != null && usedPct >= config.warnPct,
    source,
    decision: null,
  };
}

/** Derive a synthetic context.threshold envelope from a base envelope. */
export function thresholdEnvelope(base: Envelope, threshold: number): Envelope {
  return { ...base, event: "context.threshold", canonical_event: "context.threshold", threshold };
}
