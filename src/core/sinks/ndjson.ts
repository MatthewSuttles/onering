// ndjson sink (onering-build-spec.md §6): the default fleet log. One normalized
// event per line — the unified stream every harness writes into.

import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Sink } from "../types.js";

export const ndjsonSink: Sink = {
  name: "ndjson",
  emit(env, { config }) {
    const cfg = config.sinks.ndjson;
    if (!cfg?.enabled || !cfg.path) return;
    try {
      mkdirSync(dirname(cfg.path), { recursive: true });
      appendFileSync(cfg.path, JSON.stringify(env) + "\n");
    } catch {
      /* observation must never crash the harness */
    }
  },
};
