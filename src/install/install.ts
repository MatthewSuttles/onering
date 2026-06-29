// Programmatic, fs-injectable installer API.
//
// The install logic used to live inline in bin/onering-install.ts and write
// straight to disk + console.log. It's extracted here so any embedding tool
// (a GUI button, an editor extension) can wire onering into a repo without
// shelling out and scraping stdout — and so it's unit-testable with an injected
// fs. The CLI bin is now a thin wrapper over installHarness().

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

/** The slice of node:fs this module needs — injectable for tests. */
export interface InstallFs {
  readFileSync: (path: string, encoding: "utf8") => string;
  writeFileSync: (path: string, data: string) => void;
  mkdirSync: (path: string, opts: { recursive: boolean }) => void;
}

export interface InstallOptions {
  /** Target repo dir for project-scoped installs. Defaults to process.cwd(). */
  projectDir?: string;
  /** Write to the user-level config instead of the project (claude-code/gemini only). */
  global?: boolean;
  /** Override the fs implementation (tests). */
  fs?: InstallFs;
  /** Path to onering-cmd.js the hook should invoke. Defaults to the built sibling. */
  cmdPath?: string;
  /** Override home dir (tests). */
  home?: string;
}

export interface InstallResult {
  ok: boolean;
  harness: string;
  /** Config file written (absent for instructions-only harnesses / errors). */
  path?: string;
  /** Human-facing summary, suitable for a toast or stdout line. */
  message: string;
  /** True when nothing was written — the harness has no installable hook surface. */
  instructionsOnly?: boolean;
  error?: string;
}

const defaultFs: InstallFs = { readFileSync, writeFileSync, mkdirSync };

const here = dirname(fileURLToPath(import.meta.url)); // dist/src/install
const DEFAULT_CMD = resolve(here, "..", "bin", "onering-cmd.js");

export const HARNESSES = ["claude-code", "gemini", "cursor", "opencode", "codex"] as const;
export type Harness = (typeof HARNESSES)[number];

export interface HarnessInfo {
  id: Harness;
  label: string;
  /** No installable hook surface — install only prints guidance. */
  instructionsOnly: boolean;
  /** Whether --global (user-level) is supported. */
  supportsGlobal: boolean;
}

/** Enumerate harnesses for a picker UI. */
export function listHarnesses(): HarnessInfo[] {
  return [
    { id: "claude-code", label: "Claude Code", instructionsOnly: false, supportsGlobal: true },
    { id: "gemini", label: "Gemini CLI", instructionsOnly: false, supportsGlobal: true },
    { id: "cursor", label: "Cursor", instructionsOnly: false, supportsGlobal: false },
    { id: "opencode", label: "OpenCode", instructionsOnly: false, supportsGlobal: false },
    { id: "codex", label: "Codex CLI", instructionsOnly: true, supportsGlobal: false },
  ];
}

// The events worth wiring per harness, with each harness's native names.
const CC_EVENTS = ["SessionStart", "UserPromptSubmit", "PostToolUse", "Stop", "PreCompact"];
const GEMINI_EVENTS = ["SessionStart", "BeforeModel", "BeforeTool", "AfterTool", "Stop"];
const CURSOR_EVENTS = ["sessionStart", "preToolUse", "postToolUse", "stop", "preCompact"];

const invoke = (harness: string, cmd: string) => `node ${cmd} --harness ${harness}`;

function readJson(fs: InstallFs, path: string): any {
  try {
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch {
    return {};
  }
}

function writeJson(fs: InstallFs, path: string, data: unknown): void {
  fs.mkdirSync(dirname(path), { recursive: true });
  fs.writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
}

/** True if a hooks group already references onering-cmd (idempotency guard). */
function hasOnering(groups: any[]): boolean {
  return groups.some((g) =>
    (g.hooks ?? []).some((h: any) => typeof h?.command === "string" && h.command.includes("onering-cmd")),
  );
}

/** Add our command hook to a Claude-Code/Gemini-style hooks block without dupes. */
function addCommandHook(config: any, events: string[], command: string): any {
  config.hooks ??= {};
  for (const ev of events) {
    const groups: any[] = (config.hooks[ev] ??= []);
    if (hasOnering(groups)) continue;
    groups.push({ matcher: "", hooks: [{ type: "command", command }] });
  }
  return config;
}

function installClaudeCode(fs: InstallFs, cmd: string, projectDir: string, global: boolean, home: string): InstallResult {
  const path = global ? join(home, ".claude", "settings.json") : join(projectDir, ".claude", "settings.json");
  writeJson(fs, path, addCommandHook(readJson(fs, path), CC_EVENTS, invoke("claude-code", cmd)));
  return { ok: true, harness: "claude-code", path, message: `Claude Code hooks written to ${path}` };
}

function installGemini(fs: InstallFs, cmd: string, projectDir: string, global: boolean, home: string): InstallResult {
  const path = global ? join(home, ".gemini", "settings.json") : join(projectDir, ".gemini", "settings.json");
  writeJson(fs, path, addCommandHook(readJson(fs, path), GEMINI_EVENTS, invoke("gemini", cmd)));
  return { ok: true, harness: "gemini", path, message: `Gemini CLI hooks written to ${path}` };
}

function installCursor(fs: InstallFs, cmd: string, projectDir: string): InstallResult {
  const path = join(projectDir, ".cursor", "hooks.json");
  const config = readJson(fs, path);
  config.version ??= 1;
  config.hooks ??= {};
  for (const ev of CURSOR_EVENTS) {
    const arr: any[] = (config.hooks[ev] ??= []);
    if (arr.some((h) => typeof h?.command === "string" && h.command.includes("onering-cmd"))) continue;
    arr.push({ command: invoke("cursor", cmd) });
  }
  writeJson(fs, path, config);
  return { ok: true, harness: "cursor", path, message: `Cursor hooks written to ${path}` };
}

function installOpenCode(fs: InstallFs, projectDir: string): InstallResult {
  const path = join(projectDir, "opencode.json");
  const config = readJson(fs, path);
  config["$schema"] ??= "https://opencode.ai/config.json";
  const plugins: string[] = (config.plugin ??= []);
  if (!plugins.includes("opencode-onering")) plugins.push("opencode-onering");
  writeJson(fs, path, config);
  return {
    ok: true,
    harness: "opencode",
    path,
    message:
      `OpenCode plugin registered in ${path}\n` +
      `  (publish this package as opencode-onering, or drop a plugin file that\n` +
      `   re-exports { Onering } from "onering/plugin/opencode")`,
  };
}

function codexInstructions(): InstallResult {
  return {
    ok: true,
    harness: "codex",
    instructionsOnly: true,
    message:
      "Codex CLI has no usable in-loop hook surface (onering-build-spec.md §4.5).\n" +
      "Run the out-of-band tailer instead:\n\n" +
      "  onering-codex --interval 1500\n\n" +
      "It tails ~/.codex/sessions and emits envelopes + threshold events (observe-only).",
  };
}

/**
 * Wire onering into a harness's hook config. Merge-safe and idempotent: existing
 * foreign hooks are preserved, and re-running never duplicates onering's entry.
 */
export function installHarness(harness: string, opts: InstallOptions = {}): InstallResult {
  const fs = opts.fs ?? defaultFs;
  const cmd = opts.cmdPath ?? DEFAULT_CMD;
  const projectDir = opts.projectDir ?? process.cwd();
  const global = !!opts.global;
  const home = opts.home ?? homedir();

  switch (harness) {
    case "claude-code":
      return installClaudeCode(fs, cmd, projectDir, global, home);
    case "gemini":
      return installGemini(fs, cmd, projectDir, global, home);
    case "cursor":
      return installCursor(fs, cmd, projectDir);
    case "opencode":
      return installOpenCode(fs, projectDir);
    case "codex":
      return codexInstructions();
    default:
      return { ok: false, harness, error: `Unknown harness: ${harness}`, message: `Unknown harness: ${harness}` };
  }
}
