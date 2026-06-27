// Threshold-crossing detection with a persistent per-session state store.
//
// onering-build-spec.md §7: context.threshold fires when fill crosses a configured
// boundary. "State is per session; each boundary fires once per ascending pass and
// resets after a compaction boundary."
//
// Command-transport adapters run as a fresh process on every hook fire, so the last
// observed percentage has to be persisted to disk to detect a crossing at all. The
// in-process adapters (OpenCode) can use the same store or an in-memory map.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

interface StateFile {
  sessions: Record<string, { lastPct: number }>;
}

export interface ThresholdStore {
  /** Return the thresholds newly crossed on this ascending pass and persist state. */
  crossings(sessionId: string, pct: number, thresholds: number[], reset?: boolean): number[];
  /** Drop a session's state (e.g. on session.end). */
  clear(sessionId: string): void;
}

/** Compute which thresholds are crossed going from prev -> pct (ascending only). */
export function computeCrossings(prev: number, pct: number, thresholds: number[]): number[] {
  if (pct <= prev) return [];
  return thresholds.filter((t) => prev < t && pct >= t);
}

/** A store backed by a JSON file on disk. Used by command adapters. */
export class FileThresholdStore implements ThresholdStore {
  constructor(private readonly path: string) {}

  private read(): StateFile {
    try {
      const data = JSON.parse(readFileSync(this.path, "utf8"));
      if (data && typeof data === "object" && data.sessions) return data as StateFile;
    } catch {
      /* missing or corrupt: start fresh */
    }
    return { sessions: {} };
  }

  private write(state: StateFile): void {
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      writeFileSync(this.path, JSON.stringify(state));
    } catch {
      /* best effort; observation must never crash the harness */
    }
  }

  crossings(sessionId: string, pct: number, thresholds: number[], reset = false): number[] {
    const state = this.read();
    const prev = reset ? 0 : state.sessions[sessionId]?.lastPct ?? 0;
    const crossed = computeCrossings(prev, pct, thresholds);
    state.sessions[sessionId] = { lastPct: reset ? 0 : pct };
    this.write(state);
    return crossed;
  }

  clear(sessionId: string): void {
    const state = this.read();
    delete state.sessions[sessionId];
    this.write(state);
  }
}

/** A store backed by an in-memory map. Used by the in-process plugin. */
export class MemoryThresholdStore implements ThresholdStore {
  private readonly map = new Map<string, number>();

  crossings(sessionId: string, pct: number, thresholds: number[], reset = false): number[] {
    const prev = reset ? 0 : this.map.get(sessionId) ?? 0;
    const crossed = computeCrossings(prev, pct, thresholds);
    this.map.set(sessionId, reset ? 0 : pct);
    return crossed;
  }

  clear(sessionId: string): void {
    this.map.delete(sessionId);
  }
}
