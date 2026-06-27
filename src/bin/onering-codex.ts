#!/usr/bin/env node
// onering Codex tailer (onering-build-spec.md §4.5) — out-of-band, degraded.
//
// Codex exposes no usable in-loop hook, so this runs as a side process that tails
// the session rollouts under ~/.codex/sessions and reads token_count events (a
// cumulative running total per session). It emits envelopes and synthetic
// context.threshold events only — observe-only, no deny/modify/inject.
//
// Usage:  onering-codex [--sessions <dir>] [--interval <ms>] [--once]

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { loadConfig } from "../core/config.js";
import { handle } from "../core/core.js";
import { codexAdapter } from "../adapters/codex.js";
import { FileThresholdStore } from "../core/threshold.js";

interface Args {
  sessions: string;
  interval: number;
  once: boolean;
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i !== -1 ? argv[i + 1] : undefined;
  };
  return {
    sessions: get("--sessions") ?? process.env.ONERING_CODEX_SESSIONS ?? join(homedir(), ".codex", "sessions"),
    interval: Number(get("--interval") ?? 1500),
    once: argv.includes("--once"),
  };
}

/** Find a token_count payload anywhere in a rollout record. */
export function extractTokenCount(o: any): { tokenCount: any; model?: string } | null {
  if (!o || typeof o !== "object") return null;
  const candidates = [o, o.payload, o.info, o.msg, o.data].filter(Boolean);
  for (const c of candidates) {
    if (c.type === "token_count" || c.total_token_usage || c.token_usage) {
      return { tokenCount: c.info ?? c, model: o.model ?? c.model };
    }
  }
  // Nested event_msg shape: { payload: { type: "token_count", info: {...} } }
  if (o.payload?.type === "token_count") return { tokenCount: o.payload.info ?? o.payload, model: o.model };
  return null;
}

function sessionIdFromFile(file: string): string {
  const m = file.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  return m ? m[1]! : file;
}

function listRollouts(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    let entries: string[];
    try {
      entries = readdirSync(d);
    } catch {
      return;
    }
    for (const name of entries) {
      const full = join(d, name);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) walk(full);
      else if (name.endsWith(".jsonl") || name.endsWith(".json")) out.push(full);
    }
  };
  walk(dir);
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const config = loadConfig();
  const store = new FileThresholdStore(config.statePath);
  const offsets = new Map<string, number>();
  const models = new Map<string, string>(); // per-session model, learned from session_meta

  process.stderr.write(`onering-codex: tailing ${args.sessions} (interval ${args.interval}ms)\n`);

  async function scan(): Promise<void> {
    for (const file of listRollouts(args.sessions)) {
      let text: string;
      let size: number;
      try {
        size = statSync(file).size;
        const from = offsets.get(file) ?? 0;
        if (size <= from) continue;
        const buf = readFileSync(file);
        text = buf.subarray(from).toString("utf8");
        offsets.set(file, size);
      } catch {
        continue;
      }
      const sessionId = sessionIdFromFile(file);
      for (const line of text.split("\n")) {
        if (!line.trim()) continue;
        let o: any;
        try {
          o = JSON.parse(line);
        } catch {
          continue;
        }
        // Learn the session model from any record that carries it (session_meta
        // first, then any token_count that happens to include one).
        const model = o.model ?? o.payload?.model ?? o.info?.model;
        if (model) models.set(sessionId, model);
        const found = extractTokenCount(o);
        if (!found) continue;
        const inbound = codexAdapter.toInbound({
          tokenCount: found.tokenCount,
          sessionId,
          model: found.model ?? models.get(sessionId),
        });
        await handle(inbound, codexAdapter, { config, store });
      }
    }
  }

  // Seed offsets to end-of-file on first pass so we only emit NEW events, unless
  // --once was requested (then read everything present and exit).
  if (!args.once) {
    for (const file of listRollouts(args.sessions)) {
      try {
        offsets.set(file, statSync(file).size);
      } catch {
        /* ignore */
      }
    }
  }

  await scan();
  if (args.once) return;

  const tick = () => scan().catch(() => {}).finally(() => setTimeout(tick, args.interval));
  setTimeout(tick, args.interval);
}

main().catch((err) => {
  process.stderr.write(`onering-codex: ${err?.message ?? err}\n`);
  process.exit(1);
});
