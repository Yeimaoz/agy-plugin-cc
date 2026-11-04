import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { detectPrompt } from "../plugins/agy/scripts/lib/commands/session.mjs";
import { reconcileJobs, createJob } from "../plugins/agy/scripts/lib/jobs.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(here, "../plugins/agy/scripts/agy-companion.mjs");
const FAKE_AGY = path.join(here, "fixtures/fake-agy.mjs");
const FAKE_TMUX = path.join(here, "fixtures/fake-tmux.mjs");
const tmp = (p) => mkdtempSync(path.join(os.tmpdir(), p));

function repo() {
  const dir = tmp("agy-sess-repo-");
  const git = (...a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8" });
  git("init", "-q"); git("config", "user.email", "t@t"); git("config", "user.name", "t");
  writeFileSync(path.join(dir, "a.txt"), "one\n"); git("add", "a.txt"); git("commit", "-q", "-m", "init");
  return dir;
}

function setup() {
  const cwd = repo();
  const stateFile = path.join(tmp("agy-tmux-"), "state.json");
  const env = { AGY_BIN: FAKE_AGY, AGY_TMUX_BIN: FAKE_TMUX, FAKE_TMUX_STATE: stateFile, CLAUDE_PLUGIN_DATA: tmp("agy-data-") };
  const run = (args, extraEnv = {}) => {
    const r = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8", env: { ...process.env, ...env, ...extraEnv } });
    return { code: r.status, out: r.stdout, err: r.stderr };
  };
  const tmuxState = () => JSON.parse(readFileSync(stateFile, "utf8"));
  const setScreen = (name, screen) => {
    const s = tmuxState();
    s.sessions[name].screen = screen;
    writeFileSync(stateFile, JSON.stringify(s));
  };
  return { cwd, env, run, tmuxState, setScreen, stateFile };
}

const PERMISSION_SCREEN = ["> run it", "Requesting permission for:", "  echo hi", "Run this command?", "> 1. Yes, run command", "  4. No, cancel", "  ↑/↓ Navigate"].join("\n");
const IDLE_SCREEN = ["> run it", "● Ran (echo hi)", "  hi", "────", "> Accept-edits mode", "────", "? for shortcuts  accept-edits"].join("\n");

test("detectPrompt classifies permission, question, idle and working screens", () => {
  assert.equal(detectPrompt(PERMISSION_SCREEN).kind, "permission");
  assert.match(detectPrompt(PERMISSION_SCREEN).excerpt, /Run this command/);
  assert.equal(detectPrompt("Do you trust the contents of this project?\n> Yes, I trust this folder").kind, "permission");
  assert.equal(detectPrompt("Install now (y/n)").kind, "permission");
  assert.equal(detectPrompt("Which file?\n> a.py\n  b.py\n  ↑/↓ Navigate · enter Confirm").kind, "question");
  assert.equal(detectPrompt(IDLE_SCREEN).kind, "idle");
  assert.equal(detectPrompt("Thinking...\nesc to interrupt").kind, "working");
  assert.equal(detectPrompt("starting...").kind, "working");
  assert.equal(detectPrompt("").kind, "working");
});

test("detectPrompt weak keywords count only when not idle, and patterns are overridable", () => {
  assert.equal(detectPrompt("Please approve the change").kind, "permission");
  assert.equal(detectPrompt("I got permission denied earlier\n> x\n? for shortcuts").kind, "idle");
  assert.equal(detectPrompt("foo BANANA", { permission: [/BANANA/] }).kind, "permission");
  assert.equal(detectPrompt("Run this command?", { permission: [/BANANA/] }).kind, "working");
});

test("session start launches agy -i in tmux and records the job", () => {
  const t = setup();
  const r = t.run(["session", "start", "--write", "--json", "--add-dir", "/extra", "say", "hi"]);
  assert.equal(r.code, 0, r.err);
  const j = JSON.parse(r.out);
  assert.equal(j.tmuxSession, `agy-${j.jobId}`);
  assert.equal(j.mode, "accept-edits");
  const s = t.tmuxState().sessions[j.tmuxSession];
  assert.equal(s.cmd, process.execPath);
  assert.deepEqual(s.args.slice(0, 3), [FAKE_AGY, "-i", "say hi"]);
  assert.ok(s.args.includes("--mode") && s.args[s.args.indexOf("--mode") + 1] === "accept-edits");
  assert.deepEqual(s.args.slice(s.args.indexOf("--add-dir"), s.args.indexOf("--add-dir") + 2), ["--add-dir", "/extra"]);
  assert.ok(!s.args.includes("--dangerously-skip-permissions"));
});

test("session start defaults to plan mode and rejects empty or oversized prompts", () => {
  const t = setup();
  const j = JSON.parse(t.run(["session", "start", "--json", "x"]).out);
  assert.equal(j.mode, "plan");
  assert.equal(t.run(["session", "start"]).code, 2);
  const big = t.run(["session", "start", "a".repeat(61 * 1024)]);
  assert.equal(big.code, 2);
  assert.match(big.err, /shorten/);
});

test("session start without tmux is a UsageError with install hint", () => {
  const t = setup();
  const r = t.run(["session", "start", "x"], { AGY_TMUX_BIN: path.join(os.tmpdir(), "no-such-tmux") });
  assert.equal(r.code, 2);
  assert.match(r.err, /tmux not found/);
});

test("session peek reports state, screen and excerpt; human mode prints a state line", () => {
  const t = setup();
  const { jobId, tmuxSession } = JSON.parse(t.run(["session", "start", "--json", "x"]).out);
  t.setScreen(tmuxSession, PERMISSION_SCREEN);
  const j = JSON.parse(t.run(["session", "peek", jobId, "--json", "--lines", "40"]).out);
  assert.equal(j.state, "permission");
  assert.equal(j.jobId, jobId);
  assert.match(j.screen, /Requesting permission/);
  assert.match(j.excerpt, /Run this command/);
  t.setScreen(tmuxSession, IDLE_SCREEN);
  const human = t.run(["session", "peek", jobId]);
  assert.match(human.out, /^\[state: idle\]\n/);
});

test("session peek on a vanished tmux session reports gone and finishes the job", () => {
  const t = setup();
  const { jobId, tmuxSession } = JSON.parse(t.run(["session", "start", "--json", "x"]).out);
  const s = t.tmuxState();
  delete s.sessions[tmuxSession];
  writeFileSync(t.stateFile, JSON.stringify(s));
  assert.equal(JSON.parse(t.run(["session", "peek", jobId, "--json"]).out).state, "gone");
  const st = JSON.parse(t.run(["status", jobId, "--json"]).out);
  assert.equal(st.job.status, "completed");
});

test("session send types text with Enter, or a raw key with --key", () => {
  const t = setup();
  const { jobId, tmuxSession } = JSON.parse(t.run(["session", "start", "--json", "x"]).out);
  t.setScreen(tmuxSession, IDLE_SCREEN);
  const a = t.run(["session", "send", jobId, "--json", "no", "rm", "-rf"]);
  assert.equal(a.code, 0, a.err);
  assert.equal(JSON.parse(a.out).state, "idle");
  const b = t.run(["session", "send", jobId, "--key", "y"]);
  assert.equal(b.code, 0, b.err);
  assert.match(b.out, /\[state: idle\]/);
  const keys = t.tmuxState().sessions[tmuxSession].keys;
  assert.deepEqual(keys[0], { literal: true, text: "no rm -rf" });
  assert.deepEqual(keys[1], { literal: false, text: "Enter" });
  assert.deepEqual(keys[2], { literal: false, text: "y" });
  assert.equal(t.run(["session", "send", jobId, "--key", "bad key;"]).code, 2);
});

test("session stop kills tmux and marks the job cancelled; list shows only live sessions", () => {
  const t = setup();
  const a = JSON.parse(t.run(["session", "start", "--json", "one"]).out);
  const b = JSON.parse(t.run(["session", "start", "--json", "two"]).out);
  const listed = JSON.parse(t.run(["session", "list", "--json"]).out).sessions.map((x) => x.id).sort();
  assert.deepEqual(listed, [a.jobId, b.jobId].sort());
  const stop = t.run(["session", "stop", a.jobId, "--json"]);
  assert.equal(stop.code, 0, stop.err);
  assert.equal(JSON.parse(stop.out).job.status, "cancelled");
  assert.ok(!(a.tmuxSession in t.tmuxState().sessions));
  assert.deepEqual(JSON.parse(t.run(["session", "list", "--json"]).out).sessions.map((x) => x.id), [b.jobId]);
});

test("session rejects unknown actions, unknown jobs and non-session jobs", () => {
  const t = setup();
  assert.equal(t.run(["session", "bogus"]).code, 2);
  assert.equal(t.run(["session", "peek", "job-nope"]).code, 2);
  assert.equal(t.run(["session", "peek"]).code, 2);
});

test("reconcileJobs judges session jobs by tmux, leaving task jobs on pid logic", () => {
  const cwd = tmp("agy-rec-");
  const env = { ...process.env, CLAUDE_PLUGIN_DATA: tmp("agy-data-") };
  const s = createJob(cwd, { kind: "session", extra: { tmuxSession: "agy-x" } }, env);
  const live = createJob(cwd, { kind: "session", extra: { tmuxSession: "agy-y" } }, env);
  const task = createJob(cwd, { kind: "task", pid: 999999 }, env);
  const state = reconcileJobs(cwd, { isAlive: () => false, isSessionAlive: (n) => n === "agy-y" }, env);
  assert.equal(state.jobs[s.id].status, "completed");
  assert.equal(state.jobs[live.id].status, "running");
  assert.equal(state.jobs[task.id].status, "failed");
  assert.ok(existsSync(cwd));
});
