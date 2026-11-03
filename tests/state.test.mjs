import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveStateDir, loadState, saveState, updateState } from "../plugins/agy/scripts/lib/state.mjs";

const tmp = () => mkdtempSync(path.join(os.tmpdir(), "agy-state-"));

test("resolveStateDir uses CLAUDE_PLUGIN_DATA with slug and hash", () => {
  const data = tmp();
  const cwd = tmp();
  const dir = resolveStateDir(cwd, { CLAUDE_PLUGIN_DATA: data });
  assert.ok(dir.startsWith(path.join(data, "state")));
  assert.match(path.basename(dir), /^[a-z0-9-]+-[0-9a-f]{8}$/);
});

test("resolveStateDir falls back to tmpdir without CLAUDE_PLUGIN_DATA", () => {
  const dir = resolveStateDir(tmp(), {});
  assert.ok(dir.startsWith(path.join(os.tmpdir(), "agy-companion")));
});

test("state roundtrip and update", () => {
  const env = { CLAUDE_PLUGIN_DATA: tmp() };
  const cwd = tmp();
  const fresh = loadState(cwd, env);
  assert.equal(fresh.version, 1);
  assert.equal(fresh.config.stopReviewGate, false);
  assert.deepEqual(fresh.jobs, {});
  updateState(cwd, (s) => { s.config.stopReviewGate = true; }, env);
  assert.equal(loadState(cwd, env).config.stopReviewGate, true);
  saveState(cwd, { ...fresh, session: { id: "s1", consecutiveBlocks: 2 } }, env);
  assert.equal(loadState(cwd, env).session.id, "s1");
  assert.ok(existsSync(path.join(resolveStateDir(cwd, env), "state.json")));
});
