// Sink registry and fan-out (onering-build-spec.md §6).

import type { Envelope, InboundEvent, OneringConfig, Sink } from "../types.js";
import { ndjsonSink } from "./ndjson.js";
import { stderrSink, stdoutInjectSink } from "./console.js";
import { httpSink } from "./http.js";

/** All built-in sinks. Each one self-gates on its config.enabled flag. */
export const builtinSinks: Sink[] = [ndjsonSink, stderrSink, stdoutInjectSink, httpSink];

/** Fan an envelope out to every sink. Sinks never throw; failures are isolated. */
export async function emitToSinks(
  env: Envelope,
  config: OneringConfig,
  inbound: InboundEvent,
  sinks: Sink[] = builtinSinks,
): Promise<void> {
  const ctx = { config, inbound };
  await Promise.all(
    sinks.map(async (s) => {
      try {
        await s.emit(env, ctx);
      } catch {
        /* a misbehaving sink must not break the others or the harness */
      }
    }),
  );
}

export { ndjsonSink, stderrSink, stdoutInjectSink, httpSink };
