// Core type contracts for onering.
//
// These mirror the spec (onering-build-spec.md §3.1, §5) and the normative event
// model (hook-architecture-reference.md §4, §5, §6). Everything else in the core
// is defined in terms of these.

/** Canonical event names (hook-architecture-reference.md §6). Adapters map their
 *  harness-native event names onto these. The string form is kept open because
 *  harnesses keep adding events; these are the ones onering reasons about. */
export type CanonicalEvent =
  | "session.start"
  | "session.end"
  | "session.setup"
  | "config.changed"
  | "prompt.submit"
  | "prompt.expand"
  | "model.pre"
  | "turn.stop"
  | "turn.stop_failure"
  | "agent.thought"
  | "tool.selection"
  | "tool.pre"
  | "tool.post"
  | "tool.post_failure"
  | "tool.batch"
  | "permission.request"
  | "permission.decision"
  | "subagent.start"
  | "subagent.stop"
  | "task.created"
  | "task.completed"
  | "teammate.idle"
  | "context.threshold"
  | "compact.pre"
  | "compact.post"
  | "file.changed"
  | "cwd.changed"
  | "worktree.create"
  | "worktree.remove"
  | "elicitation"
  | "elicitation.result"
  | "notification"
  | "unknown";

export type HarnessName =
  | "claude-code"
  | "cursor"
  | "gemini"
  | "opencode"
  | "codex"
  | "unknown";

/** Normalized inbound event handed from an adapter to the core. */
export interface InboundEvent {
  harness: HarnessName;
  /** The harness-native event name, retained verbatim. */
  event: string;
  /** The canonical event name this maps to, if known. */
  canonicalEvent: CanonicalEvent;
  sessionId: string | null;
  model?: string;
  transcriptPath?: string | null;
  cwd?: string;
  tool?: { name: string; input?: unknown; response?: unknown; useId?: string };
  /** A compaction boundary just occurred in this payload (resets threshold state). */
  isCompactionBoundary?: boolean;
  /** Harness hints for window resolution. */
  windowHint?: { exceeds200k?: boolean; windowSize?: number };
  /** Original payload, for adapter-specific needs and the `raw` envelope echo. */
  raw: unknown;
}

export interface ContextBlock {
  used_tokens: number;
  window_size: number;
  used_pct: number;
  remaining_pct: number;
}

export interface Breakdown {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
}

/** The usage contract (hook-architecture-reference.md §5). */
export interface UsageBlock {
  context: ContextBlock;
  breakdown: Breakdown;
  cost?: { total_cost_usd: number };
  /** Model id observed while computing usage (transcripts carry it per-turn). */
  lastModel?: string;
  /** Any single turn exceeded 200k, a strong hint the window is the large variant. */
  exceeds200k?: boolean;
}

export type DecisionAction = "allow" | "deny" | "modify" | "annotate";

export interface Decision {
  action: DecisionAction;
  reason?: string;
  /** Replacement input/prompt for `modify`, or extra context for `annotate`. */
  patch?: unknown;
}

/** The normalized output envelope (onering-build-spec.md §5). */
export interface Envelope {
  schema_version: string;
  ts: string;
  harness: HarnessName;
  /** Harness-native event name. */
  event: string;
  /** Canonical event name. */
  canonical_event: CanonicalEvent;
  session_id: string | null;
  model: string | null;
  context: ContextBlock | null;
  breakdown: Breakdown | null;
  cost?: { total_cost_usd: number } | null;
  tool?: { name: string; input?: unknown; response?: unknown } | null;
  /** Present only on context.threshold events. */
  threshold?: number;
  compaction_imminent: boolean;
  source: "transcript" | "event" | "rollout" | "unavailable";
  /** Populated on the outbound path once a policy has run. */
  decision: Decision | null;
}

/** Per-harness adapter contract (onering-build-spec.md §3.1). */
export interface HarnessAdapter {
  name: HarnessName;
  /** Command adapters only: does this payload belong to this harness? */
  detect(payload: unknown): boolean;
  toInbound(payload: unknown): InboundEvent;
  /** Harness-native usage if the harness hands it to hooks; else null and the
   *  core falls back to transcript parsing. */
  usage(inbound: InboundEvent): UsageBlock | null;
  /** Render a decision in the harness's own dialect (exit code, JSON, no-op). */
  emitDecision(d: Decision, inbound: InboundEvent): RenderedDecision;
}

/** The result of rendering a decision for a command-transport harness. */
export interface RenderedDecision {
  /** Process exit code to use. */
  exitCode: number;
  /** Text to write to stdout (JSON decision, or injected context). */
  stdout?: string;
  /** Text to write to stderr (reason fed back to the model on deny). */
  stderr?: string;
}

/** A sink receives every envelope the core emits. */
export interface Sink {
  name: string;
  emit(env: Envelope, ctx: SinkContext): void | Promise<void>;
}

export interface SinkContext {
  config: OneringConfig;
  inbound: InboundEvent;
}

export interface SinkConfig {
  ndjson?: { enabled: boolean; path?: string };
  stdout?: { enabled: boolean; injectEvents?: CanonicalEvent[] };
  stderr?: { enabled: boolean };
  http?: { enabled: boolean; url: string; headers?: Record<string, string>; timeoutMs?: number };
}

/** A single policy rule. Evaluated in order; first match wins. */
export interface PolicyRule {
  /** Match by canonical event. */
  event?: CanonicalEvent;
  /** Match by tool name (regex source string). */
  tool?: string;
  /** Fire when context fill is at or above this percentage. */
  atOrAbovePct?: number;
  action: DecisionAction;
  reason?: string;
}

export interface OneringConfig {
  schemaVersion: string;
  /** Threshold boundaries for the synthetic context.threshold event. */
  thresholds: number[];
  /** Percentage at/above which `compaction_imminent` is set and a warning fires. */
  warnPct: number;
  /** Hard window override; bypasses model-based resolution. */
  windowOverride?: number;
  /** Path for the threshold state store. */
  statePath: string;
  sinks: SinkConfig;
  /** When false, the policy engine only ever annotates (observe-only default). */
  enforcement: boolean;
  policy: PolicyRule[];
}
