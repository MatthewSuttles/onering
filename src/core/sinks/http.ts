// http sink (onering-build-spec.md §6): POST the envelope to a consumer endpoint.
// "This is the MCP-shaped hookup: any monitor or policy service subscribes to one
// schema and receives events from every harness."
//
// Fire-and-forget with a short timeout. A slow or down consumer must never block or
// crash the harness, so failures are swallowed.

import type { Sink } from "../types.js";

export const httpSink: Sink = {
  name: "http",
  async emit(env, { config }) {
    const cfg = config.sinks.http;
    if (!cfg?.enabled || !cfg.url) return;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), cfg.timeoutMs ?? 2000);
    try {
      await fetch(cfg.url, {
        method: "POST",
        headers: { "content-type": "application/json", ...(cfg.headers ?? {}) },
        body: JSON.stringify(env),
        signal: controller.signal,
      });
    } catch {
      /* consumer unreachable: drop, never block the harness */
    } finally {
      clearTimeout(timeout);
    }
  },
};
