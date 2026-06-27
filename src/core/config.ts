// Configuration: defaults <- onering.config.json <- environment overrides.
//
// onering-build-spec.md §8: "Config via env or a single onering.config.json:
// thresholds, window overrides, sinks, enforcement on or off."

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { OneringConfig, SinkConfig } from "./types.js";

export const SCHEMA_VERSION = "0.1.0";

export function defaultConfig(): OneringConfig {
  return {
    schemaVersion: SCHEMA_VERSION,
    thresholds: [50, 80, 95],
    warnPct: 80,
    statePath: ".onering/state.json",
    enforcement: false,
    policy: [],
    sinks: {
      ndjson: { enabled: true, path: ".onering/usage-events.ndjson" },
      stderr: { enabled: true },
      stdout: { enabled: true, injectEvents: ["session.start", "prompt.submit"] },
      http: { enabled: false, url: "" },
    },
  };
}

function deepMergeSinks(base: SinkConfig, over: Partial<SinkConfig> | undefined): SinkConfig {
  if (!over) return base;
  return {
    ndjson: { ...base.ndjson!, ...over.ndjson } as SinkConfig["ndjson"],
    stderr: { ...base.stderr!, ...over.stderr } as SinkConfig["stderr"],
    stdout: { ...base.stdout!, ...over.stdout } as SinkConfig["stdout"],
    http: { ...base.http!, ...over.http } as SinkConfig["http"],
  };
}

function fromFile(path: string): Partial<OneringConfig> | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Partial<OneringConfig>;
  } catch {
    return null;
  }
}

function num(v: string | undefined): number | undefined {
  if (v == null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/** Resolve the effective config. `cwd` is where onering.config.json is sought. */
export function loadConfig(cwd: string = process.cwd(), env = process.env): OneringConfig {
  const cfg = defaultConfig();

  // 1) File overrides.
  const filePath = env.ONERING_CONFIG ? resolve(cwd, env.ONERING_CONFIG) : resolve(cwd, "onering.config.json");
  const file = fromFile(filePath);
  if (file) {
    if (Array.isArray(file.thresholds)) cfg.thresholds = file.thresholds;
    if (typeof file.warnPct === "number") cfg.warnPct = file.warnPct;
    if (typeof file.windowOverride === "number") cfg.windowOverride = file.windowOverride;
    if (typeof file.statePath === "string") cfg.statePath = file.statePath;
    if (typeof file.enforcement === "boolean") cfg.enforcement = file.enforcement;
    if (Array.isArray(file.policy)) cfg.policy = file.policy;
    cfg.sinks = deepMergeSinks(cfg.sinks, file.sinks);
  }

  // 2) Environment overrides (highest priority).
  const warn = num(env.ONERING_WARN_PCT);
  if (warn != null) cfg.warnPct = warn;
  const win = num(env.ONERING_WINDOW);
  if (win != null) cfg.windowOverride = win;
  if (env.ONERING_LOG) cfg.sinks.ndjson = { enabled: true, path: env.ONERING_LOG };
  if (env.ONERING_STATE) cfg.statePath = env.ONERING_STATE;
  if (env.ONERING_THRESHOLDS) {
    const parsed = env.ONERING_THRESHOLDS.split(",").map((s) => Number(s.trim())).filter(Number.isFinite);
    if (parsed.length) cfg.thresholds = parsed;
  }
  if (env.ONERING_HTTP_URL) {
    cfg.sinks.http = { enabled: true, url: env.ONERING_HTTP_URL };
  }
  if (env.ONERING_ENFORCE != null) cfg.enforcement = env.ONERING_ENFORCE === "1" || env.ONERING_ENFORCE === "true";

  cfg.thresholds = [...cfg.thresholds].sort((a, b) => a - b);
  return cfg;
}
