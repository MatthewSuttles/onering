// Adapter registry and command-payload dispatch.

import type { HarnessAdapter } from "../core/types.js";
import { claudeCodeAdapter } from "./claude-code.js";
import { geminiAdapter } from "./gemini.js";
import { cursorAdapter } from "./cursor.js";
import { opencodeAdapter } from "./opencode.js";
import { codexAdapter } from "./codex.js";

export { claudeCodeAdapter, geminiAdapter, cursorAdapter, opencodeAdapter, codexAdapter };
export { cursorCallbackDecision } from "./cursor.js";

/** Adapters that arrive over a command transport (JSON on stdin) and are chosen by
 *  payload shape. Order matters: the specific detectors (Cursor by id, Gemini by
 *  unique event names) run before Claude Code, which is the permissive catch-all
 *  for any remaining hook_event_name payload. OpenCode and Codex are in-process /
 *  out-of-band and excluded. */
export const commandAdapters: HarnessAdapter[] = [cursorAdapter, geminiAdapter, claudeCodeAdapter];

export const allAdapters: HarnessAdapter[] = [...commandAdapters, opencodeAdapter, codexAdapter];

/** Look up an adapter by harness name (the explicit --harness / ONERING_HARNESS path). */
export function adapterByName(name: string): HarnessAdapter | null {
  return allAdapters.find((a) => a.name === name) ?? null;
}

/** Pick the adapter for a stdin payload, or null if no command adapter claims it. */
export function detectAdapter(payload: unknown, adapters: HarnessAdapter[] = commandAdapters): HarnessAdapter | null {
  for (const a of adapters) {
    try {
      if (a.detect(payload)) return a;
    } catch {
      /* a misbehaving detector must not block the others */
    }
  }
  return null;
}
