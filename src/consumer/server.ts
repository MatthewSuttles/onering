#!/usr/bin/env node
// Reference consumer (onering-build-spec.md §6, §9 P4).
//
// The MCP-shaped hookup: one HTTP endpoint that subscribes to the one envelope
// schema and receives events from every harness. It keeps a live per-session view
// of context fill — a minimal fleet monitor demonstrating that a consumer written
// once works across harnesses.
//
//   POST /events     a single envelope (the http sink target)
//   GET  /fleet      current per-session fill, as JSON
//   GET  /healthz    liveness
//
// Usage:  onering-consumer [--port 8787]

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Envelope } from "../core/types.js";

interface SessionState {
  harness: string;
  model: string | null;
  usedPct: number | null;
  usedTokens: number | null;
  windowSize: number | null;
  lastEvent: string;
  lastTs: string;
  thresholdsCrossed: number[];
  compactionImminent: boolean;
  events: number;
}

const sessions = new Map<string, SessionState>();

function ingest(env: Envelope): void {
  const id = env.session_id ?? "unknown";
  const s: SessionState = sessions.get(id) ?? {
    harness: env.harness,
    model: env.model,
    usedPct: null,
    usedTokens: null,
    windowSize: null,
    lastEvent: env.event,
    lastTs: env.ts,
    thresholdsCrossed: [],
    compactionImminent: false,
    events: 0,
  };
  s.harness = env.harness;
  s.model = env.model ?? s.model;
  s.lastEvent = env.event;
  s.lastTs = env.ts;
  s.events += 1;
  s.compactionImminent = env.compaction_imminent;
  if (env.context) {
    s.usedPct = env.context.used_pct;
    s.usedTokens = env.context.used_tokens;
    s.windowSize = env.context.window_size;
  }
  if (env.canonical_event === "context.threshold" && env.threshold != null && !s.thresholdsCrossed.includes(env.threshold)) {
    s.thresholdsCrossed.push(env.threshold);
    s.thresholdsCrossed.sort((a, b) => a - b);
  }
  sessions.set(id, s);

  const pct = env.context ? `${env.context.used_pct}%` : "n/a";
  const tag = env.canonical_event === "context.threshold" ? ` THRESHOLD ${env.threshold}` : "";
  process.stderr.write(`[consumer] ${env.harness} ${id} ${env.event} ${pct}${tag}\n`);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c as Buffer));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, { "content-type": "application/json" });
  res.end(payload);
}

async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method === "POST" && req.url === "/events") {
    try {
      const env = JSON.parse(await readBody(req)) as Envelope;
      ingest(env);
      json(res, 202, { ok: true });
    } catch (err: any) {
      json(res, 400, { ok: false, error: err?.message ?? "bad request" });
    }
    return;
  }
  if (req.method === "GET" && req.url === "/fleet") {
    json(res, 200, { sessions: Object.fromEntries(sessions) });
    return;
  }
  if (req.method === "GET" && req.url === "/healthz") {
    json(res, 200, { ok: true, sessions: sessions.size });
    return;
  }
  json(res, 404, { ok: false, error: "not found" });
}

function port(): number {
  const i = process.argv.indexOf("--port");
  return Number(i !== -1 ? process.argv[i + 1] : process.env.ONERING_CONSUMER_PORT) || 8787;
}

const p = port();
createServer((req, res) => {
  handler(req, res).catch(() => json(res, 500, { ok: false }));
}).listen(p, () => {
  process.stderr.write(`onering-consumer listening on http://127.0.0.1:${p} (POST /events, GET /fleet)\n`);
});
