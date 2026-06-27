import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveWindow } from "../src/core/window.js";

test("default window is 200k", () => {
  assert.equal(resolveWindow("claude-opus-4-8"), 200_000);
});

test("[1m] tag implies the 1m variant", () => {
  assert.equal(resolveWindow("claude-opus-4-8[1m]"), 1_000_000);
});

test("exceeds-200k hint implies the 1m variant", () => {
  assert.equal(resolveWindow("claude-opus-4-8", { exceeds200k: true }), 1_000_000);
});

test("explicit override wins over everything", () => {
  assert.equal(resolveWindow("claude-opus-4-8[1m]", { exceeds200k: true }, 300_000), 300_000);
});

test("harness-supplied window size is used when present", () => {
  assert.equal(resolveWindow("some-unknown-model", { windowSize: 64_000 }), 64_000);
});

test("known model families resolve", () => {
  assert.equal(resolveWindow("gemini-2.0-pro"), 1_000_000);
  assert.equal(resolveWindow("gpt-4.1"), 128_000);
});
