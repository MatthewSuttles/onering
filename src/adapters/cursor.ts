// Cursor adapter (onering-build-spec.md §4.3).
//
// Dual transport: command hooks (.cursor/hooks.json, reusing the CC command path)
// and in-process callback hooks. Event names are camelCase. The command path gets
// transcript_path; the callback path gets model plus the transcript. Decisions:
// 2xx JSON for the callback path, the CC dialect for the command path.

import type { CanonicalEvent, Decision, HarnessAdapter, InboundEvent, RenderedDecision } from "../core/types.js";
import { renderCommandDecision } from "./command-decision.js";

const EVENT_MAP: Record<string, CanonicalEvent> = {
  sessionStart: "session.start",
  stop: "turn.stop",
  preToolUse: "tool.pre",
  postToolUse: "tool.post",
  afterFileEdit: "file.changed",
  beforeSubmitPrompt: "prompt.submit",
  preCompact: "compact.pre",
  afterAgentResponse: "turn.stop",
  afterAgentThought: "agent.thought",
};

function modelId(m: unknown): string | undefined {
  if (typeof m === "string") return m || undefined;
  if (m && typeof m === "object") {
    const o = m as Record<string, unknown>;
    return (o.id as string) || (o.model as string) || undefined;
  }
  return undefined;
}

export const cursorAdapter: HarnessAdapter = {
  name: "cursor",

  detect(payload: unknown): boolean {
    const p = payload as any;
    return !!p && (!!p.conversation_id || !!p.generation_id);
  },

  toInbound(payload: unknown): InboundEvent {
    const p = (payload ?? {}) as any;
    const event = p.hook_event_name ?? p.hookEventName ?? p.event ?? "unknown";
    const canonical = EVENT_MAP[event] ?? "unknown";
    const toolName = p.tool_name ?? p.toolName ?? p.tool?.name;
    const tool = toolName
      ? {
          name: toolName,
          input: p.tool_input ?? p.toolInput ?? p.tool?.input,
          response: p.tool_response ?? p.toolResponse,
          useId: p.tool_use_id ?? p.generation_id,
        }
      : undefined;
    return {
      harness: "cursor",
      event,
      canonicalEvent: canonical,
      sessionId: p.conversation_id ?? p.session_id ?? p.sessionId ?? null,
      model: modelId(p.model),
      transcriptPath: p.transcript_path ?? p.transcriptPath ?? null,
      cwd: p.cwd ?? p.workspace_root,
      tool,
      isCompactionBoundary: canonical === "compact.pre",
      windowHint: { exceeds200k: p.exceeds_200k === true },
      raw: payload,
    };
  },

  usage() {
    return null;
  },

  emitDecision(d: Decision): RenderedDecision {
    // Command path matches the CC dialect. The callback path consumer reads the
    // JSON `decision` form via `callbackDecision` below.
    return renderCommandDecision(d, { jsonDeny: false });
  },
};

/** Render a decision for Cursor's in-process callback path (2xx JSON, §4.3). */
export function cursorCallbackDecision(d: Decision): { status: number; body: unknown } {
  switch (d.action) {
    case "deny":
      return { status: 200, body: { decision: "deny", reason: d.reason ?? "" } };
    case "modify":
      return { status: 200, body: { decision: "modify", patch: d.patch ?? null } };
    default:
      return { status: 200, body: { decision: "allow" } };
  }
}
