// Gemini CLI adapter (onering-build-spec.md §4.2).
//
// Same command contract as Claude Code (JSON stdin, exit codes, matchers), but the
// event names differ and the transcript is JSON rather than JSONL (the usage parser
// handles both shapes). Gemini exposes model.pre and tool.selection, richer than CC
// and Cursor; the adapter passes them through as canonical events. Strict JSON-only
// on stdout, so all logging must go to stderr (handled by the bin entry).

import type { CanonicalEvent, HarnessAdapter, InboundEvent } from "../core/types.js";
import { renderCommandDecision } from "./command-decision.js";

/** Event names that only Gemini emits, used for unambiguous auto-detection. */
const GEMINI_UNIQUE = new Set(["BeforeModel", "BeforeToolSelection", "BeforeTool", "AfterTool", "BeforePrompt"]);

const EVENT_MAP: Record<string, CanonicalEvent> = {
  SessionStart: "session.start",
  SessionEnd: "session.end",
  BeforePrompt: "prompt.submit",
  UserPromptSubmit: "prompt.submit",
  BeforeModel: "model.pre",
  BeforeToolSelection: "tool.selection",
  BeforeTool: "tool.pre",
  AfterTool: "tool.post",
  Stop: "turn.stop",
  Notification: "notification",
};

function modelId(m: unknown): string | undefined {
  if (typeof m === "string") return m || undefined;
  if (m && typeof m === "object") {
    const o = m as Record<string, unknown>;
    return (o.id as string) || (o.model as string) || undefined;
  }
  return undefined;
}

export const geminiAdapter: HarnessAdapter = {
  name: "gemini",

  detect(payload: unknown): boolean {
    const p = payload as any;
    if (!p) return false;
    if (p.harness === "gemini") return true;
    // Disambiguate only on Gemini-UNIQUE event names. Shared names (SessionStart,
    // Stop, …) are ambiguous with Claude Code, so the bin's explicit --harness
    // selector (written by the installer) is the reliable path; auto-detect only
    // claims payloads that can't be anything but Gemini.
    const ev = p.hook_event_name ?? p.event ?? p.eventName;
    return typeof ev === "string" && GEMINI_UNIQUE.has(ev) && !p.conversation_id;
  },

  toInbound(payload: unknown): InboundEvent {
    const p = (payload ?? {}) as any;
    const event = p.hook_event_name ?? p.event ?? p.eventName ?? "unknown";
    const canonical = EVENT_MAP[event] ?? "unknown";
    const toolName = p.tool_name ?? p.toolName ?? p.tool?.name;
    const tool = toolName
      ? {
          name: toolName,
          input: p.tool_input ?? p.toolInput ?? p.tool?.input,
          response: p.tool_response ?? p.toolResponse ?? p.tool?.response,
          useId: p.tool_use_id ?? p.toolUseId,
        }
      : undefined;
    return {
      harness: "gemini",
      event,
      canonicalEvent: canonical,
      sessionId: p.session_id ?? p.sessionId ?? null,
      model: modelId(p.model),
      transcriptPath: p.transcript_path ?? p.transcriptPath ?? null,
      cwd: p.cwd,
      tool,
      isCompactionBoundary: false,
      windowHint: { exceeds200k: p.exceeds_200k === true },
      raw: payload,
    };
  },

  usage() {
    return null;
  },

  emitDecision(d) {
    // Gemini's primary deny channel is JSON on stdout.
    return renderCommandDecision(d, { jsonDeny: true });
  },
};
