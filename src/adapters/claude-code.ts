// Claude Code adapter (onering-build-spec.md §4.1).
//
// Transport: JSON on stdin, exit codes and stdout JSON back.
// Event names: PascalCase. Usage: parse transcript_path (placeholder-safe).
// Decisions: exit code 2 + stderr to block; stdout for inject/modify.

import type { CanonicalEvent, HarnessAdapter, InboundEvent } from "../core/types.js";
import { renderCommandDecision } from "./command-decision.js";

const EVENT_MAP: Record<string, CanonicalEvent> = {
  SessionStart: "session.start",
  SessionEnd: "session.end",
  UserPromptSubmit: "prompt.submit",
  PreToolUse: "tool.pre",
  PostToolUse: "tool.post",
  Stop: "turn.stop",
  SubagentStart: "subagent.start",
  SubagentStop: "subagent.stop",
  PreCompact: "compact.pre",
  Notification: "notification",
  PreToolSelection: "tool.selection",
};

function modelId(m: unknown): string | undefined {
  if (typeof m === "string") return m || undefined;
  if (m && typeof m === "object") {
    const o = m as Record<string, unknown>;
    return (o.id as string) || (o.model as string) || (o.display_name as string) || undefined;
  }
  return undefined;
}

export const claudeCodeAdapter: HarnessAdapter = {
  name: "claude-code",

  detect(payload: unknown): boolean {
    const p = payload as any;
    // PascalCase hook_event_name and no Cursor-only ids.
    return !!p?.hook_event_name && !p?.conversation_id && !p?.generation_id;
  },

  toInbound(payload: unknown): InboundEvent {
    const p = (payload ?? {}) as any;
    const event = p.hook_event_name ?? "unknown";
    const canonical = EVENT_MAP[event] ?? "unknown";
    const tool = p.tool_name
      ? { name: p.tool_name, input: p.tool_input, response: p.tool_response, useId: p.tool_use_id }
      : undefined;
    return {
      harness: "claude-code",
      event,
      canonicalEvent: canonical,
      sessionId: p.session_id ?? null,
      model: modelId(p.model),
      transcriptPath: p.transcript_path ?? null,
      cwd: p.cwd,
      tool,
      isCompactionBoundary: canonical === "compact.pre",
      windowHint: { exceeds200k: p.exceeds_200k === true },
      raw: payload,
    };
  },

  // Claude Code does not hand usage to hooks; the core falls back to the transcript.
  usage() {
    return null;
  },

  emitDecision(d) {
    return renderCommandDecision(d, { jsonDeny: false });
  },
};
