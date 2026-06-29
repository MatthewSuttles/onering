#!/usr/bin/env node
// Per-harness installer CLI (onering-build-spec.md §8, §9 P5).
//
// Thin wrapper over the programmatic API in ../install/install.ts. All the
// merge logic lives there (and is unit-tested + reusable by embedding tools);
// this file only parses argv and prints.
//
// Usage:
//   onering-install claude-code [--global] [--project <dir>]
//   onering-install gemini       [--global] [--project <dir>]
//   onering-install cursor       [--project <dir>]
//   onering-install opencode     [--project <dir>]
//   onering-install codex                                  # prints tailer instructions

import { installHarness, HARNESSES } from "../install/install.js";

function flag(name: string): boolean {
  return process.argv.includes(name);
}
function opt(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

const harness = process.argv[2];
if (!harness || !(HARNESSES as readonly string[]).includes(harness)) {
  console.error("Usage: onering-install <claude-code|gemini|cursor|opencode|codex> [--global] [--project <dir>]");
  process.exit(1);
}

const result = installHarness(harness, { global: flag("--global"), projectDir: opt("--project") });

if (!result.ok) {
  console.error(result.error ?? result.message);
  process.exit(1);
}

console.log(result.instructionsOnly ? result.message : `✓ ${result.message}`);
