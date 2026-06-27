<div align="center">

<img src="./onering.png" alt="onering" width="200" />

# onering

### One hook standard to rule them all.

A unified hook layer for coding-agent harnesses. One normalized envelope, one
canonical event vocabulary, and a mandatory `usage` block, so a hook you write once
works across every harness, and your tooling can finally *see* how full the context
window is.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A520-339933.svg?logo=node.js&logoColor=white)](https://nodejs.org)
[![Types](https://img.shields.io/badge/types-TypeScript-3178c6.svg?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Runtime deps](https://img.shields.io/badge/runtime%20deps-0-success.svg)](#design-principles)

</div>

## TL;DR

Coding-agent harnesses all have hooks, but no two agree on event names, payloads,
transports, or decision contracts, and none of them tells a hook how full the
context window is. onering normalizes every harness onto one envelope with a
mandatory `usage` block, and synthesizes the events nobody emits natively (like a
`context.threshold` crossing), using only data each harness already provides.

Write your monitor, policy gate, or backup routine once. Run it on Claude Code,
Cursor, Gemini CLI, OpenCode, and Codex CLI. Zero runtime dependencies, Node 20+.

```bash
npm install && npm run build

# wire it into any (or all) of your harnesses:
node dist/src/bin/onering-install.js claude-code   # .claude/settings.json
node dist/src/bin/onering-install.js gemini        # .gemini/settings.json
node dist/src/bin/onering-install.js cursor        # .cursor/hooks.json
node dist/src/bin/onering-install.js opencode      # opencode.json
node dist/src/bin/onering-install.js codex         # prints tailer setup (observe-only)
```

## Table of contents

- [Background](#background)
- [Why onering](#why-onering)
- [How it works](#how-it-works)
- [Quick start](#quick-start)
- [Supported harnesses](#supported-harnesses)
- [The envelope](#the-envelope)
- [Canonical events](#canonical-events)
- [The usage contract](#the-usage-contract)
- [Synthetic events](#synthetic-events)
- [Sinks](#sinks)
- [Decisions and the policy engine](#decisions-and-the-policy-engine)
- [Configuration](#configuration)
- [Programmatic API](#programmatic-api)
- [CLI reference](#cli-reference)
- [Project layout](#project-layout)
- [Testing](#testing)
- [Build status](#build-status)
- [Design principles](#design-principles)
- [Roadmap and open questions](#roadmap-and-open-questions)
- [Contributing](#contributing)
- [Acknowledgments](#acknowledgments)
- [License](#license)

## Background

Hooks are now table stakes for coding agents. Every major harness lets you run
deterministic code at fixed points in the agent loop, to observe an action, block
it, modify it, or add context. That convergence is real, but it stopped at the idea.
The implementations did not converge: event names, payload schemas, transports, and
decision contracts all differ for no good reason, so a hook is effectively rewritten
once per harness.

There is also a gap that every harness shares. A hook cannot see how full the
context window is. Each harness tracks this internally and feeds it to its own status
line, yet never hands it to a hook. The practical cost is that automatic compaction,
the single most disruptive thing that happens to a long session, arrives with no
hook-visible warning. You can react to it after the fact, but you cannot act before
it.

onering started as a short conversation with
[Zlatko Alomerovic](https://www.linkedin.com/in/zlatkoalomerovic/) about that gap,
became a single-file proof of concept that read the data harnesses already expose,
and grew into the standard and adapter layer documented here.

## Why onering

[MCP](https://modelcontextprotocol.io) gave the ecosystem one protocol so any
client can reach any tool: a server implements once, every client benefits. The
hook ecosystem has the **inverse** problem.

Every coding-agent harness (Claude Code, Cursor, Gemini CLI, Codex CLI, OpenCode)
has converged on the same idea: run deterministic code at fixed points in the agent
loop. But the implementations have *not* converged. Event names, payload schemas,
transports, and decision contracts differ gratuitously, and **one capability is
missing from all of them**: hooks cannot see how full the context window is. So
automatic compaction happens with no hook-visible signal, and every consumer of
hook data, whether a fleet monitor, a policy gate, or a backup-on-compaction routine,
gets rewritten once per harness.

onering closes that gap two ways:

1. **A standard.** One normalized hook envelope and one canonical event vocabulary,
   carrying a mandatory `usage` block, so a consumer written once works everywhere.
   (Working name: **HHP**, the Harness Hook Protocol.)
2. **A polyfill.** A single adapter layer that makes each harness speak the standard
   *today*, using data the harness already has. Where a harness already plans native
   support, onering bridges until it lands, and then the adapter logic is deleted, not
   maintained forever.

The shape of the win is the same as MCP: **write the consumer once, run it anywhere.**

## How it works

One codebase, one envelope, many adapters. Not one binary. Each harness gets a thin
adapter that knows its transport, event names, and usage source, and hands
everything to a shared core.

```
   harness event ──►  adapter (per harness)
                        detect · toInbound · usage · emitDecision
                              │
                              ▼
                       core (shared)
                        normalize → usage → threshold-crossing → sinks → decision
                              │
        ┌─────────────────────┼─────────────────────┬─────────────────────┐
        ▼                     ▼                     ▼                     ▼
   ndjson log            stdout inject          decision               http sink
   (fleet stream)        (model sees it)        (block, harness        (any consumer,
                                                 dialect)               MCP-shaped)
```

The core flow, per event:

```
handle(inbound, adapter):
  usage   = adapter.usage(inbound) ?? usageFromTranscript(inbound.transcriptPath)
  window  = resolveWindow(inbound.model, usage)
  env     = buildEnvelope(inbound, usage, window)
  sinks.emit(env)
  for t in crossings(session, env.context.used_pct):   # the synthetic threshold event
    sinks.emit(thresholdEnvelope(env, t))
  return adapter.emitDecision(policy(env))              # default policy: allow + annotate
```

## Quick start

Requires **Node 20 or newer**. Zero runtime dependencies; TypeScript is a dev-only
dependency.

```bash
git clone https://github.com/MatthewSuttles/onering.git && cd onering
npm install
npm run build      # tsc to dist/
npm test           # build + run the suite (node --test)
```

Wire it into a harness (idempotent, merge-safe):

```bash
node dist/src/bin/onering-install.js claude-code      # writes .claude/settings.json
```

Now every hook fire appends a normalized envelope to `.onering/usage-events.ndjson`
and emits synthetic `context.threshold` events as the window fills. Try it directly:

```bash
echo '{"hook_event_name":"PostToolUse","session_id":"s1",
       "transcript_path":"test/fixtures/claude-code/transcript.jsonl",
       "model":"claude-opus-4-8","tool_name":"Edit"}' \
  | node dist/src/bin/onering-cmd.js --harness claude-code
```

```
onering: context 82% (164001/200000) compaction imminent [PostToolUse]
onering: context 82% (164001/200000) compaction imminent [context.threshold]
onering: context 82% (164001/200000) compaction imminent [context.threshold]
```

```jsonc
// .onering/usage-events.ndjson
{"event":"PostToolUse","canonical_event":"tool.post","context":{"used_pct":82,...}}
{"event":"context.threshold","threshold":50,"context":{"used_pct":82,...}}
{"event":"context.threshold","threshold":80,"context":{"used_pct":82,...}}
```

## Supported harnesses

Each adapter brings its harness up to the standard by backfilling the two universal
gaps, the `usage` block and the `context.threshold` event, and normalizing names
and transport. No harness is forked; only its existing hook surface is used.

| Harness | Transport | Usage source | Inject to model | Deny / modify | Status |
|---|---|---|---|---|---|
| **Claude Code** | command (JSON stdin) | transcript JSONL | ✅ SessionStart, UserPromptSubmit | exit 2 + stderr / JSON | full |
| **Gemini CLI** | command (JSON stdin) | transcript JSON or JSONL | strict JSON stdout | JSON `decision` on stdout | full |
| **Cursor** | command + in-process callback | transcript (command) / model+transcript (callback) | ✅ | CC dialect / 2xx JSON | full |
| **OpenCode** | in-process plugin | native `info.tokens` | ✅ via `output.context` | optional `session.summarize` | full |
| **Codex CLI** | out-of-band tailer | `~/.codex/sessions` rollouts | no | observe-only | degraded |

### Wiring each harness

The installer writes the right registration and pins `--harness <name>` so shared
event names (for example Gemini versus Claude Code `SessionStart`) are never
ambiguous.

```bash
node dist/src/bin/onering-install.js claude-code [--global] [--project <dir>]   # .claude/settings.json
node dist/src/bin/onering-install.js gemini      [--global] [--project <dir>]   # .gemini/settings.json
node dist/src/bin/onering-install.js cursor                 [--project <dir>]   # .cursor/hooks.json
node dist/src/bin/onering-install.js opencode               [--project <dir>]   # opencode.json
node dist/src/bin/onering-install.js codex                                      # prints tailer setup
```

- **Claude Code / Gemini / Cursor** register `onering-cmd` on the high-value events
  (`SessionStart`, `UserPromptSubmit`/prompt, tool pre/post, `Stop`, compaction).
  `--global` targets your home config; otherwise the current (or `--project`) repo.
- **OpenCode** is an in-process plugin. Add `opencode-onering` to `opencode.json`'s
  `plugin` array (the installer does this), or drop a project plugin that re-exports
  `{ Onering } from "onering/plugin/opencode"`.
- **Codex CLI** exposes only a notification hook in-loop, so there is no blocking
  surface. Run the out-of-band tailer instead, described in
  [CLI reference](#cli-reference).

## The envelope

Every event, from every harness, is normalized to the same shape. The
harness-native event name is retained alongside the canonical one.

```jsonc
{
  "schema_version": "0.1.0",
  "ts": "2026-06-27T21:17:00.000Z",
  "harness": "claude-code",           // claude-code | cursor | gemini | opencode | codex
  "event": "PostToolUse",             // harness-native name, verbatim
  "canonical_event": "tool.post",     // the HHP canonical name
  "session_id": "s-abc",
  "model": "claude-opus-4-8",
  "context": {
    "used_tokens": 164001,
    "window_size": 200000,
    "used_pct": 82,
    "remaining_pct": 18
  },
  "breakdown": {
    "input_tokens": 1,
    "output_tokens": 520,
    "cache_read_input_tokens": 160000,
    "cache_creation_input_tokens": 4000
  },
  "cost": null,                       // { total_cost_usd } when available
  "tool": { "name": "Edit", "input": { }, "response": { } },  // tool events only
  "threshold": 80,                    // context.threshold events only
  "compaction_imminent": true,        // used_pct >= warnPct
  "source": "transcript",             // transcript | event | rollout | unavailable
  "decision": null                    // populated on the outbound path
}
```

| Field | Meaning |
|---|---|
| `schema_version` | HHP envelope version. |
| `harness` / `event` / `canonical_event` | Origin harness, its native event name, and the canonical name it maps to. |
| `context` | Live window state. `null` when usage could not be computed. |
| `breakdown` | Raw token counts behind `context`. |
| `compaction_imminent` | `true` once fill reaches `warnPct` (default 80%). |
| `source` | Where usage came from: parsed `transcript`, in-process `event`, Codex `rollout`, or `unavailable`. |
| `threshold` | Present only on synthetic `context.threshold` events. |
| `decision` | The policy outcome, attached on the outbound path. |

## Canonical events

Adapters map their harness-native event names onto this vocabulary. **Block** = `Y`
can deny or modify, `N` observe or annotate only.

| Phase | Canonical events |
|---|---|
| **Session** | `session.start` (inject), `session.end`, `session.setup`, `config.changed` |
| **Turn** | `prompt.submit` (Y, inject), `prompt.expand` (Y), `model.pre`, `turn.stop` (Y), `turn.stop_failure`, `agent.thought` |
| **Tool** | `tool.selection` (Y), `tool.pre` (Y), `tool.post`, `tool.post_failure`, `tool.batch`, `permission.request` (Y), `permission.decision` |
| **Subagent** | `subagent.start`, `subagent.stop`, `task.created`, `task.completed`, `teammate.idle` |
| **Context** | **`context.threshold`** (Y), `compact.pre` (Y), `compact.post` |
| **Environment** | `file.changed`, `cwd.changed`, `worktree.create` / `worktree.remove`, `elicitation` / `elicitation.result`, `notification` |

Specialized tool events (`shell.pre`, `file.read`, `mcp.pre`) are `tool.pre`
filtered by a matcher, carrying the same envelope.

## The usage contract

The single highest-value gap onering closes. Every event carries a `usage` block
describing the live window, data every harness already tracks for its status line
but never hands to hooks.

### How fill is computed

```
used_tokens = input_tokens + cache_creation_input_tokens + cache_read_input_tokens
used_pct    = used_tokens / window_size * 100
```

Taken as the **maximum across assistant turns since the last compaction boundary**.
This is the same formula status-line APIs use, and it is **placeholder-safe**:
`input_tokens` is frequently a streaming placeholder of `0` or `1`, but the cache
fields are written at request start, are accurate, and dominate. The largest such
sum is the true high-water fill of the live window; a compaction boundary resets it.

```jsonc
// A real transcript turn: input_tokens is a placeholder, cache fields carry the truth.
{ "input_tokens": 1, "output_tokens": 520, "cache_read_input_tokens": 160000, "cache_creation_input_tokens": 4000 }
// used_tokens = 164001, which is 82% of a 200k window
```

### Window resolution

A small resolver maps a model id to its window size, in priority order:

1. an explicit override (`windowOverride` / `ONERING_WINDOW`),
2. a harness-supplied size (OpenCode reports the real per-model limit),
3. a `[1m]` tag or an observed turn that already exceeded 200k, which selects the 1M variant,
4. a known model-family map, otherwise
5. the 200k default.

This is a heuristic until harnesses expose a native `window_size` field, at which
point the adapter passes it straight through and the heuristic dissolves.

## Synthetic events

Two events onering emits that no harness does natively:

- **`context.threshold`** fires when fill crosses a configured boundary (default
  `50, 80, 95`). State is per session; **each boundary fires exactly once per
  ascending pass and re-arms after a compaction boundary.** For command-transport
  harnesses, where every hook fire is a fresh process, the last percentage is
  persisted to a small state file so crossings can be detected at all.
- **compaction token counts.** Where a harness exposes a compaction point but no
  numbers, onering records fill immediately before and after so you can measure what
  compaction cost you.

## Sinks

The envelope fans out to one or more sinks, configured per install. Sinks never
throw, so a misbehaving or unreachable sink can never crash the harness it observes.

| Sink | Default | Behavior |
|---|---|---|
| `ndjson` | **on** | Append one envelope per line to a fleet log, the unified stream every harness writes into. |
| `stderr` | **on** | An operator-visible warning when compaction is imminent. Goes to stderr, so it never enters the model's context or corrupts a JSON stdout contract. |
| `stdout` | **on** | On inject-point events (`session.start`, `prompt.submit`), print a short usage line the model itself sees. |
| `http` | off | `POST` the envelope to a consumer endpoint. The MCP-shaped hookup: any monitor or policy service subscribes to one schema and receives events from every harness. |

### Reference consumer

A minimal fleet monitor demonstrating that a consumer written once works across
harnesses:

```bash
node dist/src/consumer/server.js --port 8787
```

| Route | Method | Purpose |
|---|---|---|
| `/events` | POST | Receive a single envelope (the `http` sink target). |
| `/fleet` | GET | Live per-session fill across all harnesses, as JSON. |
| `/healthz` | GET | Liveness. |

```bash
# Point any harness at the consumer:
ONERING_HTTP_URL=http://127.0.0.1:8787/events \
  node dist/src/bin/onering-cmd.js --harness claude-code < payload.json

curl -s http://127.0.0.1:8787/fleet | jq
```

## Decisions and the policy engine

A hook returns one of: **allow** (proceed), **deny** (block, reason fed back to the
model), **modify** (replace the pending input or prompt), or **annotate** (add context
without blocking). Each harness expresses this differently; onering renders the
canonical decision into the right dialect:

| Harness | Deny renders as |
|---|---|
| Claude Code, Cursor (command) | exit code `2` plus reason on stderr |
| Gemini CLI | `{"decision":"deny","reason":…}` on stdout |
| Cursor (callback) | `2xx` JSON `{ decision }` |
| Codex CLI | no-op (observe-only) |

### Observe first; enforcement is opt-in

The default policy is **allow + annotate**. The engine evaluates ordered rules
(first match wins), and **when `enforcement` is off, any `deny`/`modify` a rule would
produce is downgraded to `annotate`**, so you can ship rules and flip them on later
without rewriting them.

```jsonc
"policy": [
  { "event": "tool.pre", "tool": "Bash", "atOrAbovePct": 95,
    "action": "deny", "reason": "context too full for shell" }
]
```

A rule matches on any combination of canonical `event`, a `tool` name regex, and an
`atOrAbovePct` fill gate.

## Configuration

Resolution order: **built-in defaults, then `onering.config.json` (in cwd), then
environment variables** (highest priority).

```jsonc
// onering.config.json
{
  "thresholds": [50, 80, 95],          // context.threshold boundaries
  "warnPct": 80,                       // compaction_imminent + stderr warning at/above this
  "windowOverride": null,              // hard window size; bypasses model resolution
  "statePath": ".onering/state.json",  // threshold-crossing state store
  "enforcement": false,                // observe-only by default
  "policy": [],                        // decision rules (see above)
  "sinks": {
    "ndjson": { "enabled": true,  "path": ".onering/usage-events.ndjson" },
    "stderr": { "enabled": true },
    "stdout": { "enabled": true,  "injectEvents": ["session.start", "prompt.submit"] },
    "http":   { "enabled": false, "url": "", "headers": {}, "timeoutMs": 2000 }
  }
}
```

### Environment variables

| Variable | Effect |
|---|---|
| `ONERING_CONFIG` | Path to the config file (default `./onering.config.json`). |
| `ONERING_WARN_PCT` | Override `warnPct`. |
| `ONERING_WINDOW` | Hard window-size override (tokens). |
| `ONERING_THRESHOLDS` | Comma-separated threshold list, for example `60,85,95`. |
| `ONERING_LOG` | ndjson fleet-log path. |
| `ONERING_STATE` | Threshold state-store path. |
| `ONERING_HTTP_URL` | Enable the http sink and POST to this URL. |
| `ONERING_ENFORCE` | `1`/`true` turns enforcement on. |
| `ONERING_HARNESS` | Force a specific adapter (alternative to `--harness`). |
| `ONERING_CODEX_SESSIONS` | Codex tailer: sessions directory. |
| `ONERING_CONSUMER_PORT` | Reference consumer: listen port. |

## Programmatic API

onering is a library as well as a set of CLIs. Import the core to drive it yourself:

```ts
import { handle, loadConfig } from "onering/core";
import { claudeCodeAdapter } from "onering/adapters";

const config = loadConfig();
const inbound = claudeCodeAdapter.toInbound(payloadFromStdin);
const { envelope, thresholds, decision, rendered } = await handle(inbound, claudeCodeAdapter, { config });
```

Selected exports from `onering/core`:

- `handle(inbound, adapter, opts)` runs the end-to-end flow and returns the envelope,
  any synthetic threshold envelopes, the decision, and the rendered dialect.
- `usageFromTranscript(path, window?)` / `usageFromText(text, window?)` are the
  placeholder-safe fill parser.
- `resolveWindow(modelId, hint?, override?)` performs window resolution.
- `buildEnvelope(...)` / `thresholdEnvelope(base, t)` assemble envelopes.
- `policy(env, config)` is the decision engine.
- `computeCrossings(prev, pct, thresholds)`, `FileThresholdStore`,
  `MemoryThresholdStore` are the threshold-crossing primitives.
- `emitToSinks(...)`, `builtinSinks`, and the individual sink objects.
- `loadConfig()` / `defaultConfig()` and all the TypeScript types.

`onering/adapters` exports every adapter plus `detectAdapter`, `adapterByName`, and
`cursorCallbackDecision`. `onering/plugin/opencode` exports the OpenCode `Onering`
plugin.

## CLI reference

All binaries live under `dist/src/` after `npm run build`, and are exposed as npm
`bin` entries (`onering-cmd`, `onering-codex`, `onering-install`, `onering-consumer`).

### `onering-cmd`, the command-harness entry

```bash
onering-cmd [--harness <name>]                 # observe + decide on a stdin payload
onering-cmd [--harness <name>] -- ./real-hook  # wrap: also delegate to an existing hook
```

Reads a hook payload as JSON on stdin, runs the core, and renders the decision in the
harness's dialect (exit code plus stdout/stderr). In wrap mode the **original** payload
is handed to the real hook so onering stays transparent; a `deny` short-circuits and
the wrapped hook is skipped. Unknown payloads are passed through untouched. onering
always **fails open**, so observation never crashes the harness.

### `onering-codex`, the out-of-band Codex tailer

```bash
onering-codex [--sessions <dir>] [--interval <ms>] [--once]
```

Tails `~/.codex/sessions` rollouts and reads `token_count` events (a cumulative
running total per session), emitting envelopes and `context.threshold` events.
Observe-only: no deny, no modify, no inject. By default it seeds to end-of-file and
reports only new events; `--once` reads everything present and exits.

### `onering-install`, per-harness registration

```bash
onering-install <claude-code|gemini|cursor|opencode|codex> [--global] [--project <dir>]
```

Merge-safe and idempotent: reads any existing config, adds onering without clobbering
other hooks.

### `onering-consumer`, reference fleet monitor

```bash
onering-consumer [--port <n>]
```

## Project layout

```
src/
  core/
    types.ts        contracts: envelope, usage, decision, adapter, config
    config.ts       defaults, then file, then env
    window.ts       model id to context-window size
    usage.ts        placeholder-safe fill from a transcript (JSONL or JSON)
    threshold.ts    crossing detection + persistent / in-memory state stores
    envelope.ts     envelope assembly
    policy.ts       decision engine (enforcement opt-in)
    core.ts         handle(): the end-to-end flow
    sinks/          ndjson · stderr · stdout-inject · http
  adapters/
    claude-code · gemini · cursor · opencode · codex   (+ dispatch / registry)
  bin/
    onering-cmd · onering-codex · onering-install
  plugin/
    opencode.ts     OpenCode in-process plugin on the shared core
  consumer/
    server.ts       reference http consumer / fleet monitor
test/
    fixtures/        golden payloads + transcripts per harness
    *.test.ts        unit + golden-envelope tests
```

## Testing

```bash
npm test                                  # build + full suite
node --test "dist/test/**/*.test.js"      # after a build, run directly
```

The suite uses Node's built-in test runner (no extra dependencies) and covers:

- **Golden fixtures per harness.** A sample payload plus transcript/event asserting
  one expected envelope.
- **The placeholder edge case.** A transcript that is mostly `input_tokens: 1` still
  computes the correct fill from cache fields.
- **The crossing invariant.** Each threshold fires exactly once per ascending pass
  and re-arms after a compaction boundary (including persistence across process
  boundaries, the command-mode reality).
- **Decision dialects.** A deny renders as exit-code-2 for Claude Code, JSON for
  Gemini, and a no-op for Codex.

## Build status

| Phase | Scope | Status |
|---|---|---|
| P0 | Envelope + core + Claude Code adapter + ndjson sink + threshold synthesis | ✅ |
| P1 | OpenCode in-process adapter | ✅ |
| P2 | Gemini + Cursor command adapters | ✅ |
| P3 | Codex out-of-band tailer (observe-only) | ✅ |
| P4 | http sink + reference consumer + decision policy engine | ✅ |
| P5 | npm package, per-harness installers, docs | ✅ |

## Design principles

- **Observe first.** Default behavior is observe and annotate. Enforcement and
  actuation are opt-in per install, never the default.
- **No harness forks.** onering only uses each harness's existing hook surface.
- **One contract, many transports.** The same envelope works over stdin, HTTP, or an
  in-process callback. Transport is a delivery detail, not a schema.
- **Outside context by default.** Hook output never enters the model's context unless
  the event is explicitly an injection point.
- **Fail open.** Observation must never crash the harness; every sink, store, and
  parser swallows its own failures.
- **Zero runtime dependencies.** The core is harness-agnostic TypeScript with nothing
  but Node's standard library underneath.
- **Dissolvable.** Every backfilled field is something a harness could emit natively.
  As harnesses adopt the envelope, the matching adapter logic is *deleted*, not
  maintained forever.

## Roadmap and open questions

- Push versus pull for usage *between* turns, where a harness offers no per-turn event.
- Exposing usage to hooks without it leaking into the model's own context.
- One canonical decision schema versus mapping each harness's dialect.
- Whose token count defines a full window when harnesses tokenize differently.
- Whether the http sink should be a pull subscription rather than push, to look even
  more like MCP.

The adoption endgame: land the `usage` block, `context.threshold`, and compaction
token counts natively in the harnesses, keep the envelope identical so one consumer
works everywhere, and retire the adapters as that happens.

## Contributing

Issues and pull requests welcome. A good adapter PR adds: the harness's event-name
map, its usage source (native or transcript), its decision dialect, and a golden
fixture under `test/fixtures/<harness>/` with a matching envelope assertion. Run
`npm test` before opening a PR.

## Acknowledgments

onering grew out of a discussion with
[Zlatko Alomerovic](https://www.linkedin.com/in/zlatkoalomerovic/) that spawned both
the original idea and the first proof of concept. Thank you, Zlatko.

## License

[MIT](./LICENSE)
