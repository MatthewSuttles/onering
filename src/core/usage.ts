// Usage acquisition from a transcript (onering-build-spec.md §3.3).
//
// The placeholder-safe formula: fill = input + cache_creation + cache_read, taken
// as the MAX across assistant turns since the last compaction boundary.
//
// Why max-since-compaction and not last-turn: `input_tokens` is frequently a
// streaming placeholder of 0 or 1, but the cache fields are written at request
// start and are accurate and dominant. The largest such sum is the true high-water
// fill of the live window; compaction resets it, so we only look back to the most
// recent boundary.

import { readFileSync } from "node:fs";
import type { Breakdown, UsageBlock } from "./types.js";

interface RawUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

function sumInput(u: RawUsage): number {
  return (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
}

function toBreakdown(u: RawUsage): Breakdown {
  return {
    input_tokens: u.input_tokens || 0,
    output_tokens: u.output_tokens || 0,
    cache_read_input_tokens: u.cache_read_input_tokens || 0,
    cache_creation_input_tokens: u.cache_creation_input_tokens || 0,
  };
}

/** Is this record a compaction/summary boundary that resets the window? */
function isBoundary(o: any): boolean {
  return (
    o?.type === "summary" ||
    o?.isCompactSummary === true ||
    o?.subtype === "compact_boundary" ||
    o?.compact === true
  );
}

/** Pull a usage object off a transcript record, across known shapes. */
function usageOf(o: any): RawUsage | null {
  // Claude Code / Cursor: { message: { usage, model, role } }
  if (o?.message?.usage) return o.message.usage as RawUsage;
  // Gemini: usage may live at the top level or under tokens/usageMetadata.
  if (o?.usage) return o.usage as RawUsage;
  if (o?.usageMetadata) {
    const m = o.usageMetadata;
    return {
      input_tokens: m.promptTokenCount ?? m.prompt_tokens,
      output_tokens: m.candidatesTokenCount ?? m.completion_tokens,
      cache_read_input_tokens: m.cachedContentTokenCount ?? m.cached_tokens,
      cache_creation_input_tokens: 0,
    };
  }
  return null;
}

function modelOf(o: any): string | undefined {
  return o?.message?.model || o?.model || o?.modelVersion || undefined;
}

/**
 * Parse a transcript file into a UsageBlock, or null if no usage is found.
 * Accepts JSONL (one record per line) and a single JSON array (Gemini).
 */
export function usageFromTranscript(path: string | null | undefined, windowForPct?: number): UsageBlock | null {
  if (!path) return null;
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return null;
  }
  return usageFromText(text, windowForPct);
}

/** Same as usageFromTranscript but from an in-memory string (testable). */
export function usageFromText(text: string, windowForPct?: number): UsageBlock | null {
  const records = parseRecords(text);

  let best: { input: number; breakdown: Breakdown } | null = null;
  let lastModel: string | undefined;
  let exceeds200k = false;

  for (const o of records) {
    if (isBoundary(o)) {
      best = null; // window reset after compaction
      continue;
    }
    const u = usageOf(o);
    if (!u) continue;
    const m = modelOf(o);
    if (m) lastModel = m;
    const input = sumInput(u);
    if (input > 200_000) exceeds200k = true;
    if (!best || input > best.input) best = { input, breakdown: toBreakdown(u) };
  }

  if (!best) return null;

  const window = windowForPct && windowForPct > 0 ? windowForPct : 200_000;
  const usedPct = Math.round((best.input / window) * 1000) / 10;
  return {
    context: {
      used_tokens: best.input,
      window_size: window,
      used_pct: usedPct,
      remaining_pct: Math.round((100 - usedPct) * 10) / 10,
    },
    breakdown: best.breakdown,
    lastModel,
    exceeds200k,
  };
}

/** Records from JSONL or a single JSON array/object. */
function parseRecords(text: string): any[] {
  const trimmed = text.trimStart();
  if (trimmed.startsWith("[") || (trimmed.startsWith("{") && !trimmed.includes("\n{"))) {
    // Possibly a single JSON document (Gemini stores transcripts as JSON).
    try {
      const doc = JSON.parse(text);
      if (Array.isArray(doc)) return doc;
      // A wrapper object may hold the turns under common keys.
      if (doc && typeof doc === "object") {
        const turns = doc.messages || doc.history || doc.turns || doc.entries;
        if (Array.isArray(turns)) return turns;
        return [doc];
      }
    } catch {
      // fall through to line parsing
    }
  }
  const out: any[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      /* skip malformed line */
    }
  }
  return out;
}
