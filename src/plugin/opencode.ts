// onering — OpenCode plugin (onering-build-spec.md §4.4).
//
// Unlike the command harnesses, OpenCode hooks are in-process, so this registers as
// a native plugin. It does NOT parse a transcript: OpenCode hands token usage
// straight to plugins on message.updated (info.tokens). The plugin builds an
// InboundEvent and drives the SHARED core, so the envelope, threshold synthesis,
// and sinks are byte-for-byte identical to every other harness.
//
// Install (pick one):
//   npm:     add "opencode-onering" to opencode.json "plugin" (this file is the entry)
//   project: a thin .opencode/plugin/onering.ts that re-exports { Onering } from "onering/plugin/opencode"
//
// Enforcement (optional, off by default): when ONERING_ENFORCE=1 and fill crosses
// the top threshold, the plugin calls client.session.summarize to compact early.

import { loadConfig } from "../core/config.js";
import { handle } from "../core/core.js";
import { MemoryThresholdStore } from "../core/threshold.js";
import { opencodeAdapter } from "../adapters/opencode.js";
import type { InboundEvent } from "../core/types.js";

// Minimal local shape so we don't hard-depend on @opencode-ai/plugin at build time.
type PluginFn = (ctx: any) => Promise<Record<string, (...args: any[]) => any>>;

export const Onering: PluginFn = async (ctx: any) => {
  const config = loadConfig();
  const store = new MemoryThresholdStore();

  async function drive(raw: Record<string, unknown>) {
    const inbound: InboundEvent = opencodeAdapter.toInbound(raw);
    return handle(inbound, opencodeAdapter, { config, store });
  }

  return {
    event: async ({ event }: any) => {
      if (event?.type !== "message.updated") return;
      const info = event.properties?.info ?? event.data?.info ?? event.data;
      if (!info || info.role !== "assistant" || !info.finish || !info.tokens) return;

      const sessionId = info.sessionID ?? info.session_id ?? "unknown";
      const result = await drive({
        event: "message.updated",
        tokens: info.tokens,
        window: Number(process.env.ONERING_WINDOW) || undefined,
        sessionId,
        model: info.modelID ?? info.providerID,
      });

      // Optional enforcement: act on the top threshold, not just observe.
      if (config.enforcement && result.thresholds.length && ctx?.client?.session?.summarize) {
        const top = Math.max(...config.thresholds);
        if (result.thresholds.some((t) => t.threshold === top)) {
          try {
            await ctx.client.session.summarize({ sessionID: sessionId });
          } catch {
            /* best effort */
          }
        }
      }
    },

    "experimental.session.compacting": async (input: any) => {
      const sessionId = input?.sessionID ?? input?.session_id ?? "unknown";
      await drive({ event: "experimental.session.compacting", sessionId, isCompactionBoundary: true });
    },
  };
};

export default Onering;
