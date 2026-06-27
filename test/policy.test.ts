import { test } from "node:test";
import assert from "node:assert/strict";
import { policy } from "../src/core/policy.js";
import { defaultConfig } from "../src/core/config.js";
import type { Envelope } from "../src/core/types.js";

function env(over: Partial<Envelope> = {}): Envelope {
  return {
    schema_version: "0.1.0",
    ts: "2026-06-27T00:00:00.000Z",
    harness: "claude-code",
    event: "PreToolUse",
    canonical_event: "tool.pre",
    session_id: "s",
    model: "claude-opus-4-8",
    context: { used_tokens: 170000, window_size: 200000, used_pct: 85, remaining_pct: 15 },
    breakdown: null,
    tool: { name: "Bash", input: {} },
    compaction_imminent: true,
    source: "transcript",
    decision: null,
    ...over,
  };
}

test("default policy allows", () => {
  assert.deepEqual(policy(env(), defaultConfig()), { action: "allow" });
});

test("enforcement OFF downgrades a deny rule to annotate", () => {
  const cfg = defaultConfig();
  cfg.enforcement = false;
  cfg.policy = [{ event: "tool.pre", tool: "Bash", action: "deny", reason: "blocked" }];
  const d = policy(env(), cfg);
  assert.equal(d.action, "annotate");
});

test("enforcement ON honors a deny rule", () => {
  const cfg = defaultConfig();
  cfg.enforcement = true;
  cfg.policy = [{ event: "tool.pre", tool: "Bash", action: "deny", reason: "blocked" }];
  const d = policy(env(), cfg);
  assert.equal(d.action, "deny");
  assert.equal(d.reason, "blocked");
});

test("atOrAbovePct gates a rule on context fill", () => {
  const cfg = defaultConfig();
  cfg.enforcement = true;
  cfg.policy = [{ event: "tool.pre", atOrAbovePct: 90, action: "deny", reason: "too full" }];
  assert.equal(policy(env({ context: { used_tokens: 1, window_size: 2, used_pct: 85, remaining_pct: 15 } }), cfg).action, "allow");
  assert.equal(policy(env({ context: { used_tokens: 1, window_size: 2, used_pct: 92, remaining_pct: 8 } }), cfg).action, "deny");
});

test("tool regex that does not match falls through to allow", () => {
  const cfg = defaultConfig();
  cfg.enforcement = true;
  cfg.policy = [{ event: "tool.pre", tool: "^Edit$", action: "deny" }];
  assert.equal(policy(env(), cfg).action, "allow"); // tool is Bash
});
