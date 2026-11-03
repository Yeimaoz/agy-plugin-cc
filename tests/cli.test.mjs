import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(here, "../plugins/agy/scripts/agy-companion.mjs");
const FAKE = path.join(here, "fixtures/fake-agy.mjs");
const tmp = (p) => mkdtempSync(path.join(os.tmpdir(), p));

function repo() {
  const dir = tmp("agy-cli-repo-");
  const git = (...a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8" });
  git("init", "-q"); git("config", "user.email", "t@t"); git("config", "user.name", "t");
  writeFileSync(path.join(dir, "a.txt"), "one\n"); git("add", "a.txt"); git("commit", "-q", "-m", "init");
  return dir;
}

function run(args, { cwd, env = {} } = {}) {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8", env: { ...process.env, AGY_BIN: FAKE, ...env } });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

test("setup --json reports ready with fake agy", () => {
  const data = tmp("agy-data-");
  const r = run(["setup", "--json"], { cwd: repo(), env: { CLAUDE_PLUGIN_DATA: data } });
  assert.equal(r.code, 0, r.err);
  const j = JSON.parse(r.out);
  assert.equal(j.ready, true);
  assert.equal(j.agy.version, "1.4.12");
  assert.equal(j.config.stopReviewGate, false);
  assert.ok(j.models >= 3);
});

test("setup --enable-review-gate persists the flag", () => {
  const data = tmp("agy-data-");
  const cwd = repo();
  run(["setup", "--json", "--enable-review-gate"], { cwd, env: { CLAUDE_PLUGIN_DATA: data } });
  const j = JSON.parse(run(["setup", "--json"], { cwd, env: { CLAUDE_PLUGIN_DATA: data } }).out);
  assert.equal(j.config.stopReviewGate, true);
});

test("missing agy binary gives a setup hint and exit 2", () => {
  const r = run(["status"], { cwd: repo(), env: { AGY_BIN: path.join(os.tmpdir(), "definitely-missing-agy"), CLAUDE_PLUGIN_DATA: tmp("agy-data-") } });
  assert.equal(r.code, 2);
  assert.match(r.out + r.err, /agy:setup/);
});

test("review --json with no changes does not invoke agy", () => {
  const data = tmp("agy-data-");
  const argsFile = path.join(data, "args.json");
  const r = run(["review", "--json"], { cwd: repo(), env: { CLAUDE_PLUGIN_DATA: data, FAKE_AGY_ARGS_FILE: argsFile } });
  assert.equal(r.code, 0, r.err);
  const j = JSON.parse(r.out);
  assert.equal(j.verdict, "approve");
  assert.equal(j.note, "no-diff");
  assert.equal(existsSync(argsFile), false);
});

test("review --json runs agy in plan mode with the findings schema and parses the result", () => {
  const data = tmp("agy-data-");
  const cwd = repo();
  writeFileSync(path.join(cwd, "a.txt"), "two\n");
  const argsFile = path.join(data, "args.json");
  const response = JSON.stringify({ verdict: "needs-attention", summary: "nope", findings: [{ file: "a.txt", line_start: 1, line_end: 1, severity: "high", confidence: 0.9, title: "t", detail: "d", recommendation: "r" }] });
  const r = run(["review", "--json", "--adversarial"], { cwd, env: { CLAUDE_PLUGIN_DATA: data, FAKE_AGY_ARGS_FILE: argsFile, FAKE_AGY_RESPONSE: response } });
  assert.equal(r.code, 0, r.err);
  const seen = JSON.parse(readFileSync(argsFile, "utf8"));
  assert.ok(seen.includes("--mode") && seen[seen.indexOf("--mode") + 1] === "plan");
  assert.ok(seen.includes("--json-schema"));
  assert.equal(seen[seen.indexOf("--model") + 1], "gemini-4-argon");
  assert.equal(seen[seen.indexOf("--effort") + 1], "high");
  assert.ok(seen[seen.length - 1].includes("adversarial"));
  const j = JSON.parse(r.out);
  assert.equal(j.verdict, "needs-attention");
  assert.equal(j.findings.length, 1);
  assert.equal(j.kind, "adversarial-review");
});

test("review falls back to unstructured when agy returns non-JSON", () => {
  const data = tmp("agy-data-");
  const cwd = repo();
  writeFileSync(path.join(cwd, "a.txt"), "two\n");
  const r = run(["review", "--json"], { cwd, env: { CLAUDE_PLUGIN_DATA: data, FAKE_AGY_RESPONSE: "just prose" } });
  const j = JSON.parse(r.out);
  assert.equal(j.verdict, "needs-attention");
  assert.match(j.summary, /\[unstructured\]/);
});

test("task --background then status --json shows a completed job and result prints it", async () => {
  const data = tmp("agy-data-");
  const cwd = repo();
  const r = run(["task", "--background", "--json", "hello", "there"], { cwd, env: { CLAUDE_PLUGIN_DATA: data, FAKE_AGY_RESPONSE: "the answer" } });
  assert.equal(r.code, 0, r.err);
  const started = JSON.parse(r.out);
  assert.match(started.jobId, /^job-/);
  let status;
  for (let i = 0; i < 40; i += 1) {
    status = JSON.parse(run(["status", "--json"], { cwd, env: { CLAUDE_PLUGIN_DATA: data } }).out);
    if (status.jobs[0].status === "completed") break;
    await new Promise((res) => setTimeout(res, 100));
  }
  assert.equal(status.jobs[0].status, "completed");
  assert.equal(status.jobs[0].id, started.jobId);
  const res = run(["result", started.jobId], { cwd, env: { CLAUDE_PLUGIN_DATA: data } });
  assert.match(res.out, /the answer/);
});

test("task --wait prints the response and uses accept-edits with --write", () => {
  const data = tmp("agy-data-");
  const argsFile = path.join(data, "args.json");
  const r = run(["task", "--wait", "--write", "--model", "flash", "--effort", "low", "do it"], { cwd: repo(), env: { CLAUDE_PLUGIN_DATA: data, FAKE_AGY_ARGS_FILE: argsFile, FAKE_AGY_RESPONSE: "done!" } });
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /done!/);
  const seen = JSON.parse(readFileSync(argsFile, "utf8"));
  assert.equal(seen[seen.indexOf("--mode") + 1], "accept-edits");
  assert.equal(seen[seen.indexOf("--model") + 1], "gemini-3.8-flash");
  assert.equal(seen.includes("--dangerously-skip-permissions"), false);
});

test("task --resume passes the previous conversation id", () => {
  const data = tmp("agy-data-");
  const cwd = repo();
  run(["task", "--wait", "first"], { cwd, env: { CLAUDE_PLUGIN_DATA: data } });
  const argsFile = path.join(data, "args.json");
  run(["task", "--wait", "--resume", "second"], { cwd, env: { CLAUDE_PLUGIN_DATA: data, FAKE_AGY_ARGS_FILE: argsFile } });
  const seen = JSON.parse(readFileSync(argsFile, "utf8"));
  assert.equal(seen[seen.indexOf("--conversation") + 1], "9d6dec87-dd82-46a0-a229-393eeb66f505");
});

test("cancel on a finished job reports not running; cancel on running job cancels", async () => {
  const data = tmp("agy-data-");
  const cwd = repo();
  const done = JSON.parse(run(["task", "--background", "--json", "x"], { cwd, env: { CLAUDE_PLUGIN_DATA: data } }).out);
  for (let i = 0; i < 40; i += 1) {
    const s = JSON.parse(run(["status", "--json"], { cwd, env: { CLAUDE_PLUGIN_DATA: data } }).out);
    if (s.jobs.find((j) => j.id === done.jobId).status === "completed") break;
    await new Promise((res) => setTimeout(res, 100));
  }
  assert.match(run(["cancel", done.jobId], { cwd, env: { CLAUDE_PLUGIN_DATA: data } }).out, /not running/);
  const slow = JSON.parse(run(["task", "--background", "--json", "y"], { cwd, env: { CLAUDE_PLUGIN_DATA: data, FAKE_AGY_DELAY_MS: "20000" } }).out);
  const c = run(["cancel", slow.jobId], { cwd, env: { CLAUDE_PLUGIN_DATA: data } });
  assert.match(c.out, /cancelled/);
  const s = JSON.parse(run(["status", "--json", "--all"], { cwd, env: { CLAUDE_PLUGIN_DATA: data } }).out);
  assert.equal(s.jobs.find((j) => j.id === slow.jobId).status, "cancelled");
});

test("review reports a headless permission denial instead of an empty unstructured result", () => {
  const data = tmp("agy-data-");
  const cwd = repo();
  writeFileSync(path.join(cwd, "a.txt"), "two\n");
  const r = run(["review", "--json"], { cwd, env: { CLAUDE_PLUGIN_DATA: data, FAKE_AGY_RESPONSE: "" } });
  assert.equal(r.code, 1);
  const j = JSON.parse(r.out);
  assert.match(j.error, /no output/i);
  assert.match(j.detail, /permission/i);
});
