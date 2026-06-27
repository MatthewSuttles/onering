// stderr + stdout sinks (onering-build-spec.md §6).
//
// stderr: an operator-visible warning when compaction is imminent. Goes to stderr
//   so it never enters the model's context and never corrupts a stdout JSON
//   decision contract.
// stdout: on inject-point events (session.start, prompt.submit), print a short
//   usage line the model itself sees. Gated to canonical events the harness treats
//   as injection points (hook-architecture-reference.md §3, principle 2).

import type { Sink } from "../types.js";

export const stderrSink: Sink = {
  name: "stderr",
  emit(env, { config }) {
    if (!config.sinks.stderr?.enabled) return;
    if (!env.compaction_imminent || !env.context) return;
    const c = env.context;
    process.stderr.write(
      `onering: context ${c.used_pct}% (${c.used_tokens}/${c.window_size}) — ` +
        `compaction imminent [${env.event}]\n`,
    );
  },
};

export const stdoutInjectSink: Sink = {
  name: "stdout",
  emit(env, { config }) {
    const cfg = config.sinks.stdout;
    if (!cfg?.enabled || !env.context) return;
    // Never inject on a synthetic threshold event; it is an observation, not a turn.
    if (env.canonical_event === "context.threshold") return;
    const injectOn = cfg.injectEvents ?? [];
    if (!injectOn.includes(env.canonical_event)) return;
    process.stdout.write(`Context window: ${env.context.used_pct}% used (${env.context.used_tokens}/${env.context.window_size}).\n`);
  },
};
