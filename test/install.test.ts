import { test } from "node:test";
import assert from "node:assert/strict";
import { installHarness, listHarnesses, HARNESSES } from "../src/install/install.js";
import type { InstallFs } from "../src/install/install.js";

/** In-memory fs honoring the InstallFs slice — no disk, no temp dirs. */
function memFs(seed: Record<string, string> = {}) {
  const files = new Map<string, string>(Object.entries(seed));
  const fs: InstallFs = {
    readFileSync(path: string) {
      if (!files.has(path)) {
        const err: any = new Error(`ENOENT: ${path}`);
        err.code = "ENOENT";
        throw err;
      }
      return files.get(path)!;
    },
    writeFileSync(path: string, data: string) {
      files.set(path, data);
    },
    mkdirSync() {
      /* no-op in memory */
    },
  };
  return { fs, files };
}

const opts = (fs: InstallFs, extra: object = {}) => ({
  fs,
  projectDir: "/repo",
  home: "/home/u",
  cmdPath: "/onering/dist/src/bin/onering-cmd.js",
  ...extra,
});

test("claude-code: project install writes wired hooks for every event", () => {
  const { fs, files } = memFs();
  const r = installHarness("claude-code", opts(fs));
  assert.equal(r.ok, true);
  assert.equal(r.path, "/repo/.claude/settings.json");
  const cfg = JSON.parse(files.get("/repo/.claude/settings.json")!);
  for (const ev of ["SessionStart", "UserPromptSubmit", "PostToolUse", "Stop", "PreCompact"]) {
    assert.ok(cfg.hooks[ev], `missing event ${ev}`);
    const cmd = cfg.hooks[ev][0].hooks[0].command;
    assert.ok(cmd.includes("onering-cmd"), "command must invoke onering-cmd");
    assert.ok(cmd.includes("--harness claude-code"));
  }
});

test("claude-code: --global targets the home config", () => {
  const { fs } = memFs();
  const r = installHarness("claude-code", opts(fs, { global: true }));
  assert.equal(r.path, "/home/u/.claude/settings.json");
});

test("install is idempotent — re-running adds no duplicate group", () => {
  const { fs, files } = memFs();
  installHarness("claude-code", opts(fs));
  installHarness("claude-code", opts(fs));
  const cfg = JSON.parse(files.get("/repo/.claude/settings.json")!);
  assert.equal(cfg.hooks.Stop.length, 1, "should not duplicate the onering group");
});

test("install is merge-safe — preserves a foreign hook", () => {
  const foreign = { hooks: { Stop: [{ matcher: "", hooks: [{ type: "command", command: "echo other" }] }] } };
  const { fs, files } = memFs({ "/repo/.claude/settings.json": JSON.stringify(foreign) });
  installHarness("claude-code", opts(fs));
  const cfg = JSON.parse(files.get("/repo/.claude/settings.json")!);
  assert.equal(cfg.hooks.Stop.length, 2, "foreign hook + onering hook");
  assert.ok(cfg.hooks.Stop.some((g: any) => g.hooks[0].command === "echo other"));
  assert.ok(cfg.hooks.Stop.some((g: any) => g.hooks[0].command.includes("onering-cmd")));
});

test("cursor: writes versioned .cursor/hooks.json", () => {
  const { fs, files } = memFs();
  const r = installHarness("cursor", opts(fs));
  assert.equal(r.path, "/repo/.cursor/hooks.json");
  const cfg = JSON.parse(files.get("/repo/.cursor/hooks.json")!);
  assert.equal(cfg.version, 1);
  assert.ok(cfg.hooks.stop[0].command.includes("onering-cmd"));
});

test("opencode: registers the plugin in opencode.json without dupes", () => {
  const { fs, files } = memFs();
  installHarness("opencode", opts(fs));
  installHarness("opencode", opts(fs));
  const cfg = JSON.parse(files.get("/repo/opencode.json")!);
  assert.deepEqual(cfg.plugin, ["opencode-onering"]);
  assert.equal(cfg["$schema"], "https://opencode.ai/config.json");
});

test("codex: instructions-only, writes nothing", () => {
  const { fs, files } = memFs();
  const r = installHarness("codex", opts(fs));
  assert.equal(r.ok, true);
  assert.equal(r.instructionsOnly, true);
  assert.equal(files.size, 0, "codex must not write any config");
});

test("unknown harness: ok=false with an error", () => {
  const { fs } = memFs();
  const r = installHarness("emacs", opts(fs));
  assert.equal(r.ok, false);
  assert.match(r.error!, /Unknown harness/);
});

test("listHarnesses covers exactly the supported set", () => {
  assert.deepEqual(
    listHarnesses().map((h) => h.id).sort(),
    [...HARNESSES].sort(),
  );
});
