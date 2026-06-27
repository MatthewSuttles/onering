// Shared decision rendering for command-transport harnesses (Claude Code, Gemini,
// Cursor-command). hook-architecture-reference.md §4.3: a hook returns allow / deny
// / modify / annotate. Command harnesses express this as exit code 2 + stderr to
// block, or a JSON `decision` on stdout.

import type { Decision, RenderedDecision } from "../core/types.js";

export interface DialectOptions {
  /** Whether stdout JSON is the primary deny channel (Gemini) vs exit-code 2 (CC). */
  jsonDeny?: boolean;
}

export function renderCommandDecision(d: Decision, opts: DialectOptions = {}): RenderedDecision {
  switch (d.action) {
    case "deny":
      if (opts.jsonDeny) {
        return { exitCode: 0, stdout: JSON.stringify({ decision: "deny", reason: d.reason ?? "" }) };
      }
      // Claude Code: exit 2 + stderr feeds the reason back to the model.
      return { exitCode: 2, stderr: d.reason ?? "blocked by onering policy" };
    case "modify":
      return {
        exitCode: 0,
        stdout: JSON.stringify({ decision: "modify", patch: d.patch ?? null, reason: d.reason ?? "" }),
      };
    case "annotate":
      // Annotation is surfaced by the stdout-inject sink, not here; the decision
      // itself is a no-op on control flow.
      return { exitCode: 0 };
    case "allow":
    default:
      return { exitCode: 0 };
  }
}
