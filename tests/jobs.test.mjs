import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadState } from "../plugins/agy/scripts/lib/state.mjs";
import { createJob, reconcileJobs, findResumableJob, updateJob } from "../plugins/agy/scripts/lib/jobs.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = readFileSync(path.join(here, "fixtures/stream-sample.ndjson"), "utf8");
const tmp = () => mkdtempSync(path.join(os.tmpdir(), "agy-jobs-"));

function setup() {
  return { cwd: tmp(), env: { CLAUDE_PLUGIN_DATA: tmp() } };
}

test("createJob writes a record with id format and log/result paths", () => {
  const { cwd, env } = setup();
  const job = createJob(cwd, { kind: "task", model: "m", effort: "low", mode: "plan", pid: 123 }, env);
  assert.match(job.id, /^job-\d{8}-[0-9a-z]{6}$/);
  assert.equal(job.status, "running");
  assert.ok(job.logPath.endsWith(`${job.id}.log`));
  assert.equal(loadState(cwd, env).jobs[job.id].kind, "task");
});

test("reconcileJobs completes a running job whose log has a result", () => {
  const { cwd, env } = setup();
  const job = createJob(cwd, { kind: "task", pid: 1 }, env);
  writeFileSync(job.logPath, fixture);
  const state = reconcileJobs(cwd, { isAlive: () => true }, env);
  const j = state.jobs[job.id];
  assert.equal(j.status, "completed");
  assert.equal(j.conversationId, "9d6dec87-dd82-46a0-a229-393eeb66f505");
  assert.ok(j.finishedAt);
});

test("reconcileJobs fails a running job whose process is gone without a result", () => {
  const { cwd, env } = setup();
  const job = createJob(cwd, { kind: "task", pid: 999999 }, env);
  writeFileSync(job.logPath, "");
  const state = reconcileJobs(cwd, { isAlive: () => false }, env);
  assert.equal(state.jobs[job.id].status, "failed");
  assert.match(state.jobs[job.id].summary, /exited without result/);
});

test("findResumableJob prefers same session and flags cross-session fallback", () => {
  const { cwd, env } = setup();
  const a = createJob(cwd, { kind: "task", pid: 1, claudeSessionId: "other" }, env);
  updateJob(cwd, a.id, { status: "completed", conversationId: "conv-a" }, env);
  const state1 = loadState(cwd, env);
  const r1 = findResumableJob(state1, { kind: "task", claudeSessionId: "mine" });
  assert.equal(r1.job.id, a.id);
  assert.equal(r1.crossSession, true);
  const b = createJob(cwd, { kind: "task", pid: 2, claudeSessionId: "mine" }, env);
  updateJob(cwd, b.id, { status: "completed", conversationId: "conv-b" }, env);
  const r2 = findResumableJob(loadState(cwd, env), { kind: "task", claudeSessionId: "mine" });
  assert.equal(r2.job.id, b.id);
  assert.equal(r2.crossSession, false);
  assert.equal(findResumableJob({ jobs: {} }, { kind: "task" }), null);
});

test("reconcileJobs marks SUCCESS-with-empty-response as failed (headless permission denial)", () => {
  const { cwd, env } = setup();
  const job = createJob(cwd, { kind: "task", pid: 1 }, env);
  const emptyResult = fixture.split("\n").map((l) => {
    if (!l.includes('"event":"result"')) return l;
    const e = JSON.parse(l); e.result.response = ""; return JSON.stringify(e);
  }).join("\n") + '\n[stderr]\njetski: no output produced — a tool required the "command" permission that headless mode cannot prompt for, so it was auto-denied.\n';
  writeFileSync(job.logPath, emptyResult);
  const state = reconcileJobs(cwd, { isAlive: () => true }, env);
  assert.equal(state.jobs[job.id].status, "failed");
  assert.match(state.jobs[job.id].summary, /no output/);
  assert.match(state.jobs[job.id].summary, /permission/);
});
