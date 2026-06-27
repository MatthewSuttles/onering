import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync } from "node:fs";
import { computeCrossings, FileThresholdStore, MemoryThresholdStore } from "../src/core/threshold.js";

const T = [50, 80, 95];

test("computeCrossings: ascending pass fires each boundary once", () => {
  assert.deepEqual(computeCrossings(0, 82, T), [50, 80]);
  assert.deepEqual(computeCrossings(82, 96, T), [95]);
  assert.deepEqual(computeCrossings(82, 84, T), []);
  assert.deepEqual(computeCrossings(90, 40, T), []); // descending never fires
});

test("MemoryThresholdStore: each boundary fires exactly once per ascending pass", () => {
  const s = new MemoryThresholdStore();
  assert.deepEqual(s.crossings("a", 55, T), [50]);
  assert.deepEqual(s.crossings("a", 60, T), []); // 50 already fired
  assert.deepEqual(s.crossings("a", 85, T), [80]);
  assert.deepEqual(s.crossings("a", 99, T), [95]);
  assert.deepEqual(s.crossings("a", 99, T), []); // all fired
});

test("compaction reset re-arms the boundaries", () => {
  const s = new MemoryThresholdStore();
  assert.deepEqual(s.crossings("a", 85, T), [50, 80]);
  // reset=true sets lastPct back to 0; next ascending pass fires again.
  assert.deepEqual(s.crossings("a", 0, T, true), []);
  assert.deepEqual(s.crossings("a", 85, T), [50, 80]);
});

test("FileThresholdStore persists across instances (command-mode reality)", () => {
  const path = join(tmpdir(), `onering-test-state-${process.pid}.json`);
  rmSync(path, { force: true });
  try {
    const a = new FileThresholdStore(path);
    assert.deepEqual(a.crossings("s", 55, T), [50]);
    // A brand-new instance (new process) must see the persisted last pct.
    const b = new FileThresholdStore(path);
    assert.deepEqual(b.crossings("s", 60, T), []);
    assert.deepEqual(b.crossings("s", 85, T), [80]);
  } finally {
    rmSync(path, { force: true });
  }
});

test("sessions are isolated", () => {
  const s = new MemoryThresholdStore();
  assert.deepEqual(s.crossings("a", 85, T), [50, 80]);
  assert.deepEqual(s.crossings("b", 85, T), [50, 80]);
});
