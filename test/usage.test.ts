import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { usageFromText, usageFromTranscript } from "../src/core/usage.js";

test("placeholder edge case: input_tokens=1 still computes fill from cache fields", () => {
  const text = readFileSync("test/fixtures/claude-code/transcript.jsonl", "utf8");
  const u = usageFromText(text, 200_000);
  assert.ok(u);
  // 1 + 4000 + 160000 = 164001, dominated by cache_read.
  assert.equal(u!.context.used_tokens, 164001);
  assert.equal(u!.context.used_pct, 82);
  assert.equal(u!.breakdown.input_tokens, 1);
  assert.equal(u!.breakdown.cache_read_input_tokens, 160000);
});

test("max-since-compaction: a boundary resets the high-water fill", () => {
  const text = readFileSync("test/fixtures/claude-code/transcript-compacted.jsonl", "utf8");
  const u = usageFromText(text, 200_000);
  assert.ok(u);
  // The 164001 turn is BEFORE the compact boundary; only the 13002 turn counts after.
  assert.equal(u!.context.used_tokens, 2 + 12000 + 1000);
});

test("gemini JSON transcript (usageMetadata) parses to the same shape", () => {
  const u = usageFromTranscript("test/fixtures/gemini/transcript.json", 1_000_000);
  assert.ok(u);
  // promptTokenCount 90000 + cachedContentTokenCount 10000 = 100000
  assert.equal(u!.context.used_tokens, 100_000);
  assert.equal(u!.context.used_pct, 10);
});

test("missing transcript returns null, never throws", () => {
  assert.equal(usageFromTranscript("does/not/exist.jsonl"), null);
  assert.equal(usageFromTranscript(null), null);
});
