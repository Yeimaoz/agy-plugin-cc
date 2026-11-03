import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadState } from "../plugins/agy/scripts/lib/state.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(here, "../plugins/agy/scripts/agy-companion.mjs");
const HOOK = path.resolve(here, "../plugins/agy/scripts/stop-review-gate-hook.mjs");
const LIFECYCLE = path.resolve(here, "../plugins/agy/scripts/session-lifecycle-hook.mjs");
const FAKE = path.join(here, "fixtures/fake-agy.mjs");
const tmp = (p) => mkdtempSync(path.join(os.tmpdir(), p));

function repo() {
  const dir = tmp("agy-gate-repo-");
  const git = (...a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8" });
  git("init", "-q"); git("config", "user.email", "t@t"); git("config", "user.name", "t");
  writeFileSync(path.join(dir, "a.txt"), "one\n"); git("add", "a.txt"); git("commit", "-q", "-m", "init");
  return dir;
}

function runHook(script, input, { cwd, env = {} }) {
  const r = spawnSync(process.execPath, [script], { cwd, encoding: "utf8", input: JSON.stringify(input), env: { ...process.env, AGY_BIN: FAKE, ...env } });
  return { code: r.status, out: r.stdout.trim(), err: r.stderr };
}

function enableGate(cwd, data) {
  spawnSync(process.execPath, [CLI, "setup", "--json", "--enable-review-gate"], { cwd, encoding: "utf8", env: { ...process.env, AGY_BIN: FAKE, CLAUDE_PLUGIN_DATA: data } });
}

test("gate is silent when disabled", () => {
  const data = tmp("agy-data-");
  const cwd = repo();
  writeFileSync(path.join(cwd, "a.txt"), "two\n");
  const r = runHook(HOOK, { session_id: "s1", cwd, last_assistant_message: "edited" }, { cwd, env: { CLAUDE_PLUGIN_DATA: data, FAKE_AGY_RESPONSE: '{"decision":"BLOCK","reason":"x"}' } });
  assert.equal(r.code, 0, r.err);
  assert.equal(r.err, "");
  assert.equal(r.out, "");
});

test("gate allows silently when there is no diff and never calls agy", () => {
  const data = tmp("agy-data-");
  const cwd = repo();
  enableGate(cwd, data);
  const argsFile = path.join(data, "args.json");
  const r = runHook(HOOK, { session_id: "s1", cwd, last_assistant_message: "status only" }, { cwd, env: { CLAUDE_PLUGIN_DATA: data, FAKE_AGY_ARGS_FILE: argsFile } });
  assert.equal(r.code, 0, r.err);
  assert.equal(r.err, "");
  assert.equal(r.out, "");
  assert.equal(existsSync(argsFile), false);
});

test("gate blocks on BLOCK and enforces the two-strike limit", () => {
  const data = tmp("agy-data-");
  const cwd = repo();
  enableGate(cwd, data);
  writeFileSync(path.join(cwd, "a.txt"), "two\n");
  const env = { CLAUDE_PLUGIN_DATA: data, FAKE_AGY_RESPONSE: '{"decision":"BLOCK","reason":"needs a test"}' };
  const input = { session_id: "s1", cwd, last_assistant_message: "I edited a.txt" };
  const r1 = runHook(HOOK, input, { cwd, env });
  assert.equal(JSON.parse(r1.out).decision, "block");
  assert.match(JSON.parse(r1.out).reason, /needs a test/);
  const r2 = runHook(HOOK, input, { cwd, env });
  assert.equal(JSON.parse(r2.out).decision, "block");
  const r3 = runHook(HOOK, input, { cwd, env });
  assert.equal(r3.out, "", "third consecutive block must be forced to allow");
  assert.equal(loadState(cwd, { CLAUDE_PLUGIN_DATA: data }).session.consecutiveBlocks, 0);
});

test("gate fails open when agy returns garbage or exits non-zero", () => {
  const data = tmp("agy-data-");
  const cwd = repo();
  enableGate(cwd, data);
  writeFileSync(path.join(cwd, "a.txt"), "two\n");
  const input = { session_id: "s1", cwd, last_assistant_message: "edited" };
  const g1 = runHook(HOOK, input, { cwd, env: { CLAUDE_PLUGIN_DATA: data, FAKE_AGY_RESPONSE: "???" } });
  assert.equal(g1.code, 0, g1.err);
  assert.equal(g1.out, "");
  assert.match(g1.err, /gate-degraded/);
  const g2 = runHook(HOOK, input, { cwd, env: { CLAUDE_PLUGIN_DATA: data, FAKE_AGY_EXIT: "3" } });
  assert.equal(g2.code, 0, g2.err);
  assert.equal(g2.out, "");
  assert.match(g2.err, /gate-degraded/);
});

test("gate skips when stop_hook_active is set", () => {
  const data = tmp("agy-data-");
  const cwd = repo();
  enableGate(cwd, data);
  writeFileSync(path.join(cwd, "a.txt"), "two\n");
  const r = runHook(HOOK, { session_id: "s1", cwd, stop_hook_active: true, last_assistant_message: "x" }, { cwd, env: { CLAUDE_PLUGIN_DATA: data, FAKE_AGY_RESPONSE: '{"decision":"BLOCK","reason":"x"}' } });
  assert.equal(r.code, 0, r.err);
  assert.equal(r.out, "");
});

test("session lifecycle hook records the session id and writes env file", () => {
  const data = tmp("agy-data-");
  const cwd = repo();
  const envFile = path.join(data, "env.sh");
  const r = spawnSync(process.execPath, [LIFECYCLE, "SessionStart"], { cwd, encoding: "utf8", input: JSON.stringify({ session_id: "sess-42", transcript_path: "/t/x.jsonl", cwd }), env: { ...process.env, AGY_BIN: FAKE, CLAUDE_PLUGIN_DATA: data, CLAUDE_ENV_FILE: envFile } });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(loadState(cwd, { CLAUDE_PLUGIN_DATA: data }).session.id, "sess-42");
  const envText = readFileSync(envFile, "utf8");
  assert.match(envText, /^export AGY_CLAUDE_SESSION_ID='sess-42'$/m);
  assert.match(envText, /^export AGY_CLAUDE_TRANSCRIPT_PATH='\/t\/x.jsonl'$/m);
});
