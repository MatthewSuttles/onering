#!/usr/bin/env node
// Per-harness installer (onering-build-spec.md §8, §9 P5).
//
// Writes the right registration for each harness so onering-cmd fires on the
// high-value events. Merge-safe: reads any existing config, adds onering without
// clobbering other hooks, and is idempotent.
//
// Usage:
//   onering-install claude-code [--global] [--project <dir>]
//   onering-install gemini       [--global] [--project <dir>]
//   onering-install cursor       [--project <dir>]
//   onering-install opencode     [--project <dir>]
//   onering-install codex                                  # prints tailer instructions

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const CMD = resolve(here, "onering-cmd.js"); // dist/src/bin/onering-cmd.js
const invoke = (harness: string) => `node ${CMD} --harness ${harness}`;

// The events worth wiring per harness, with each harness's native names.
const CC_EVENTS = ["SessionStart", "UserPromptSubmit", "PostToolUse", "Stop", "PreCompact"];
const GEMINI_EVENTS = ["SessionStart", "BeforeModel", "BeforeTool", "AfterTool", "Stop"];
const CURSOR_EVENTS = ["sessionStart", "preToolUse", "postToolUse", "stop", "preCompact"];

function readJson(path: string): any {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return {};
  }
}

function writeJson(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
}

/** Add our command hook to a Claude-Code/Gemini-style hooks block without dupes. */
function addCommandHook(config: any, events: string[], command: string): any {
  config.hooks ??= {};
  for (const ev of events) {
    const groups: any[] = (config.hooks[ev] ??= []);
    const already = groups.some((g) =>
      (g.hooks ?? []).some((h: any) => typeof h?.command === "string" && h.command.includes("onering-cmd")),
    );
    if (already) continue;
    groups.push({ matcher: "", hooks: [{ type: "command", command }] });
  }
  return config;
}

function flag(name: string): boolean {
  return process.argv.includes(name);
}
function opt(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

function installClaudeCode(): void {
  const projectDir = opt("--project") ?? process.cwd();
  const path = flag("--global")
    ? join(homedir(), ".claude", "settings.json")
    : join(projectDir, ".claude", "settings.json");
  writeJson(path, addCommandHook(readJson(path), CC_EVENTS, invoke("claude-code")));
  console.log(`✓ Claude Code hooks written to ${path}`);
}

function installGemini(): void {
  const projectDir = opt("--project") ?? process.cwd();
  const path = flag("--global")
    ? join(homedir(), ".gemini", "settings.json")
    : join(projectDir, ".gemini", "settings.json");
  writeJson(path, addCommandHook(readJson(path), GEMINI_EVENTS, invoke("gemini")));
  console.log(`✓ Gemini CLI hooks written to ${path}`);
}

function installCursor(): void {
  const projectDir = opt("--project") ?? process.cwd();
  const path = join(projectDir, ".cursor", "hooks.json");
  const config = readJson(path);
  config.version ??= 1;
  config.hooks ??= {};
  for (const ev of CURSOR_EVENTS) {
    const arr: any[] = (config.hooks[ev] ??= []);
    if (arr.some((h) => typeof h?.command === "string" && h.command.includes("onering-cmd"))) continue;
    arr.push({ command: invoke("cursor") });
  }
  writeJson(path, config);
  console.log(`✓ Cursor hooks written to ${path}`);
}

function installOpenCode(): void {
  const projectDir = opt("--project") ?? process.cwd();
  const path = join(projectDir, "opencode.json");
  const config = readJson(path);
  config["$schema"] ??= "https://opencode.ai/config.json";
  const plugins: string[] = (config.plugin ??= []);
  if (!plugins.includes("opencode-onering")) plugins.push("opencode-onering");
  writeJson(path, config);
  console.log(`✓ OpenCode plugin registered in ${path}`);
  console.log("  (publish this package as opencode-onering, or drop a plugin file that");
  console.log('   re-exports { Onering } from "onering/plugin/opencode")');
}

function installCodex(): void {
  console.log("Codex CLI has no usable in-loop hook surface (onering-build-spec.md §4.5).");
  console.log("Run the out-of-band tailer instead:\n");
  console.log("  onering-codex --interval 1500");
  console.log("\nIt tails ~/.codex/sessions and emits envelopes + threshold events (observe-only).");
}

const harness = process.argv[2];
const installers: Record<string, () => void> = {
  "claude-code": installClaudeCode,
  gemini: installGemini,
  cursor: installCursor,
  opencode: installOpenCode,
  codex: installCodex,
};

const run = harness ? installers[harness] : undefined;
if (!run) {
  console.error("Usage: onering-install <claude-code|gemini|cursor|opencode|codex> [--global] [--project <dir>]");
  process.exit(1);
}
run();
