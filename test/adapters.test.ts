import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { detectAdapter } from "../src/adapters/index.js";
import { claudeCodeAdapter } from "../src/adapters/claude-code.js";
import { geminiAdapter } from "../src/adapters/gemini.js";
import { cursorAdapter } from "../src/adapters/cursor.js";
import { codexAdapter } from "../src/adapters/codex.js";

function load(path: string) {
  return JSON.parse(readFileSync(path, "utf8"));
}

test("detectAdapter dispatches each command payload to the right harness", () => {
  assert.equal(detectAdapter(load("test/fixtures/claude-code/post-tool-use.json"))?.name, "claude-code");
  assert.equal(detectAdapter(load("test/fixtures/gemini/before-tool.json"))?.name, "gemini");
  assert.equal(detectAdapter(load("test/fixtures/cursor/pre-tool-use.json"))?.name, "cursor");
});

test("detectAdapter returns null for an unknown payload", () => {
  assert.equal(detectAdapter({ random: true }), null);
});

test("cursor is detected before claude-code despite a shared event field", () => {
  // A payload with both hook_event_name and conversation_id is Cursor's.
  const p = { hook_event_name: "preToolUse", conversation_id: "x" };
  assert.equal(detectAdapter(p)?.name, "cursor");
});

test("decision dialect: deny is exit-code-2 + stderr for Claude Code", () => {
  const r = claudeCodeAdapter.emitDecision({ action: "deny", reason: "no" }, {} as any);
  assert.equal(r.exitCode, 2);
  assert.equal(r.stderr, "no");
});

test("decision dialect: deny is JSON on stdout for Gemini (strict JSON contract)", () => {
  const r = geminiAdapter.emitDecision({ action: "deny", reason: "no" }, {} as any);
  assert.equal(r.exitCode, 0);
  assert.deepEqual(JSON.parse(r.stdout!), { decision: "deny", reason: "no" });
});

test("decision dialect: codex deny is a no-op (observe-only)", () => {
  const r = codexAdapter.emitDecision({ action: "deny", reason: "no" }, {} as any);
  assert.equal(r.exitCode, 0);
  assert.equal(r.stdout, undefined);
  assert.equal(r.stderr, undefined);
});

test("cursor command path uses the CC dialect", () => {
  const r = cursorAdapter.emitDecision({ action: "deny", reason: "blocked" }, {} as any);
  assert.equal(r.exitCode, 2);
});
