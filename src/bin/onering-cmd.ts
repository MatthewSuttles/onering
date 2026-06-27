#!/usr/bin/env node
// onering command-harness entry (onering-build-spec.md §4.1–§4.3, §8).
//
// Reads a hook payload as JSON on stdin, detects the harness, runs the shared core,
// and renders the decision in that harness's dialect (exit code + stdout/stderr).
//
// Usage:
//   <hook payload on stdin> | onering-cmd                    # observe + decide
//   <hook payload on stdin> | onering-cmd -- ./real-hook.sh  # wrap + delegate
//
// In wrap mode the ORIGINAL payload is handed to the real hook so onering stays
// transparent; a deny from onering short-circuits and the wrapped hook is skipped.

import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { loadConfig } from "../core/config.js";
import { handle } from "../core/core.js";
import { builtinSinks } from "../core/sinks/index.js";
import { detectAdapter, adapterByName } from "../adapters/index.js";

function readStdin(): string {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const sep = argv.indexOf("--");
  const wrapped = sep !== -1 ? argv.slice(sep + 1) : null;
  const flags = sep !== -1 ? argv.slice(0, sep) : argv;

  // Explicit harness selector, written by the installer into each registration.
  // Removes the ambiguity of shared event names (e.g. Gemini vs CC "SessionStart").
  const hi = flags.indexOf("--harness");
  const forced = (hi !== -1 ? flags[hi + 1] : undefined) ?? process.env.ONERING_HARNESS;

  const stdin = readStdin();
  let payload: unknown;
  try {
    payload = JSON.parse(stdin);
  } catch {
    payload = {};
  }

  const adapter = forced ? adapterByName(forced) : detectAdapter(payload);
  if (!adapter) {
    // Unknown payload: stay transparent. Delegate if wrapping, else no-op.
    if (wrapped) return delegate(wrapped, stdin, 0);
    return;
  }

  const config = loadConfig();
  // Gemini requires strict JSON-only on stdout, so the human inject line is off for it.
  if (adapter.name === "gemini" && config.sinks.stdout) config.sinks.stdout.enabled = false;

  const inbound = adapter.toInbound(payload);
  const { rendered } = await handle(inbound, adapter, { config, sinks: builtinSinks });

  if (rendered.stdout) process.stdout.write(rendered.stdout.endsWith("\n") ? rendered.stdout : rendered.stdout + "\n");
  if (rendered.stderr) process.stderr.write(rendered.stderr.endsWith("\n") ? rendered.stderr : rendered.stderr + "\n");

  if (wrapped) {
    // A non-zero exit (deny) short-circuits the wrapped hook.
    if (rendered.exitCode !== 0) process.exit(rendered.exitCode);
    return delegate(wrapped, stdin, 0);
  }
  process.exit(rendered.exitCode);
}

function delegate(cmd: string[], stdin: string, fallback: number): void {
  const [bin, ...rest] = cmd;
  if (!bin) process.exit(fallback);
  const r = spawnSync(bin, rest, { input: stdin, stdio: ["pipe", "inherit", "inherit"] });
  process.exit(r.status ?? fallback);
}

main().catch((err) => {
  // Observation must never crash the harness; fail open.
  process.stderr.write(`onering: ${err?.message ?? err}\n`);
  process.exit(0);
});
