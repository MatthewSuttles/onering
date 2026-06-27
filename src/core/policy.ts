// Decision policy engine (onering-build-spec.md §4, §6, §11).
//
// Default behavior is observe-and-annotate. Enforcement (deny/modify) is opt-in:
// when config.enforcement is false, any deny/modify a rule would produce is
// downgraded to an annotate, so an install can ship rules and flip them on later
// without rewriting them.

import type { Decision, Envelope, OneringConfig, PolicyRule } from "./types.js";

function matches(rule: PolicyRule, env: Envelope): boolean {
  if (rule.event && rule.event !== env.canonical_event) return false;
  if (rule.tool) {
    const name = env.tool?.name ?? "";
    let re: RegExp;
    try {
      re = new RegExp(rule.tool);
    } catch {
      return false;
    }
    if (!re.test(name)) return false;
  }
  if (rule.atOrAbovePct != null) {
    const pct = env.context?.used_pct;
    if (pct == null || pct < rule.atOrAbovePct) return false;
  }
  return true;
}

/** Evaluate the configured rules against an envelope. First match wins. */
export function policy(env: Envelope, config: OneringConfig): Decision {
  for (const rule of config.policy) {
    if (!matches(rule, env)) continue;
    const wantsEnforcement = rule.action === "deny" || rule.action === "modify";
    if (wantsEnforcement && !config.enforcement) {
      return { action: "annotate", reason: rule.reason ?? `would ${rule.action} (enforcement off)` };
    }
    return { action: rule.action, reason: rule.reason, patch: undefined };
  }
  return { action: "allow" };
}
