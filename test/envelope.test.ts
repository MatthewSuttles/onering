import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { handle } from "../src/core/core.js";
import { defaultConfig } from "../src/core/config.js";
import { MemoryThresholdStore } from "../src/core/threshold.js";
import { claudeCodeAdapter } from "../src/adapters/claude-code.js";
import { geminiAdapter } from "../src/adapters/gemini.js";
import { cursorAdapter } from "../src/adapters/cursor.js";
import { opencodeAdapter } from "../src/adapters/opencode.js";
import { codexAdapter } from "../src/adapters/codex.js";

const TS = "2026-06-27T00:00:00.000Z";

function opts() {
  return { config: defaultConfig(), now: () => TS, sinks: [], store: new MemoryThresholdStore() };
}

function load(path: string) {
  return JSON.parse(readFileSync(path, "utf8"));
}

test("golden: claude-code PostToolUse -> tool.post with 82% fill, crosses 50+80", async () => {
  const payload = load("test/fixtures/claude-code/post-tool-use.json");
  const { envelope, thresholds } = await handle(claudeCodeAdapter.toInbound(payload), claudeCodeAdapter, opts());
  assert.equal(envelope.harness, "claude-code");
  assert.equal(envelope.canonical_event, "tool.post");
  assert.equal(envelope.source, "transcript");
  assert.equal(envelope.context?.used_tokens, 164001);
  assert.equal(envelope.context?.used_pct, 82);
  assert.equal(envelope.context?.window_size, 200_000);
  assert.equal(envelope.compaction_imminent, true);
  assert.equal(envelope.tool?.name, "Edit");
  assert.deepEqual(thresholds.map((t) => t.threshold), [50, 80]);
  assert.equal(thresholds[0]!.canonical_event, "context.threshold");
});

test("golden: gemini BeforeTool -> tool.pre, 1m window, 10% fill, no crossing", async () => {
  const payload = load("test/fixtures/gemini/before-tool.json");
  const { envelope, thresholds } = await handle(geminiAdapter.toInbound(payload), geminiAdapter, opts());
  assert.equal(envelope.harness, "gemini");
  assert.equal(envelope.canonical_event, "tool.pre");
  assert.equal(envelope.context?.window_size, 1_000_000);
  assert.equal(envelope.context?.used_pct, 10);
  assert.equal(envelope.compaction_imminent, false);
  assert.deepEqual(thresholds, []);
});

test("golden: cursor preToolUse -> tool.pre, session from conversation_id", async () => {
  const payload = load("test/fixtures/cursor/pre-tool-use.json");
  const { envelope } = await handle(cursorAdapter.toInbound(payload), cursorAdapter, opts());
  assert.equal(envelope.harness, "cursor");
  assert.equal(envelope.canonical_event, "tool.pre");
  assert.equal(envelope.session_id, "s-cur-1");
  assert.equal(envelope.context?.used_pct, 82);
});

test("golden: opencode message.updated -> model.pre from native tokens, source=event", async () => {
  const payload = load("test/fixtures/opencode/message-updated.json");
  const { envelope, thresholds } = await handle(opencodeAdapter.toInbound(payload), opencodeAdapter, opts());
  assert.equal(envelope.harness, "opencode");
  assert.equal(envelope.source, "event");
  assert.equal(envelope.context?.used_tokens, 160005);
  assert.equal(envelope.context?.used_pct, 80);
  assert.equal(envelope.compaction_imminent, true);
  assert.deepEqual(thresholds.map((t) => t.threshold), [50, 80]);
});

test("golden: codex token_count -> model.pre, source=rollout, observe-only", async () => {
  const tokenCount = { total_token_usage: { input_tokens: 110000, cached_input_tokens: 80000, output_tokens: 900 } };
  const inbound = codexAdapter.toInbound({ tokenCount, sessionId: "s-codex-1", model: "gpt-4.1" });
  const { envelope, rendered } = await handle(inbound, codexAdapter, opts());
  assert.equal(envelope.harness, "codex");
  assert.equal(envelope.source, "rollout");
  assert.equal(envelope.context?.window_size, 128_000);
  assert.equal(envelope.context?.used_tokens, 110000);
  assert.equal(rendered.exitCode, 0); // no deny surface
});
