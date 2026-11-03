// Job records: creation, reconciliation against process liveness and logs, cancel, resume lookup.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { ensureStateDir, loadState, resolveJobsDir, updateState } from "./state.mjs";
import { NO_OUTPUT_MESSAGE, summarizeStream } from "./stream.mjs";

export function nowIso() {
  return new Date().toISOString();
}

function randomBase36(len) {
  let out = "";
  while (out.length < len) out += Math.random().toString(36).slice(2);
  return out.slice(0, len);
}

export function generateJobId(date = new Date()) {
  const ymd = date.toISOString().slice(0, 10).replace(/-/g, "");
  return `job-${ymd}-${randomBase36(6)}`;
}

export function createJob(cwd, partial, env = process.env) {
  ensureStateDir(cwd, env);
  const id = partial.id || generateJobId();
  const jobsDir = resolveJobsDir(cwd, env);
  const ts = nowIso();
  const job = {
    id,
    kind: partial.kind || "task",
    status: "running",
    phase: "starting",
    model: partial.model || null,
    effort: partial.effort || null,
    mode: partial.mode || null,
    cwd,
    pid: partial.pid ?? null,
    conversationId: partial.conversationId || null,
    claudeSessionId: partial.claudeSessionId || null,
    logPath: path.join(jobsDir, `${id}.log`),
    resultPath: path.join(jobsDir, `${id}.result.txt`),
    prompt: partial.prompt ? String(partial.prompt).slice(0, 500) : null,
    createdAt: ts,
    updatedAt: ts,
    finishedAt: null,
    summary: null,
    exitCode: null,
    ...(partial.extra || {}),
  };
  if (!existsSync(job.logPath)) writeFileSync(job.logPath, "", "utf8");
  updateState(cwd, (s) => { s.jobs[id] = job; }, env);
  return job;
}

export function updateJob(cwd, id, patch, env = process.env) {
  let updated = null;
  updateState(cwd, (s) => {
    if (!s.jobs[id]) return;
    s.jobs[id] = { ...s.jobs[id], ...patch, updatedAt: nowIso() };
    updated = s.jobs[id];
  }, env);
  return updated;
}

export function defaultIsAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err && err.code === "EPERM";
  }
}

export function readJobLog(job) {
  try { return readFileSync(job.logPath, "utf8"); } catch { return ""; }
}

function finishFromSummary(job, summary) {
  const status = summary.status === "SUCCESS" && !summary.noOutput ? "completed" : "failed";
  const text = summary.noOutput ? NO_OUTPUT_MESSAGE : (summary.response || "");
  try { writeFileSync(job.resultPath, text, "utf8"); } catch { /* best effort */ }
  return {
    status,
    phase: summary.phase,
    conversationId: summary.conversationId || job.conversationId,
    summary: (summary.noOutput ? NO_OUTPUT_MESSAGE : (text.trim().split(/\r?\n/)[0] || summary.status || "")).slice(0, 200),
    usage: summary.usage,
    durationSeconds: summary.durationSeconds,
    finishedAt: nowIso(),
  };
}

export function reconcileJobs(cwd, { isAlive = defaultIsAlive } = {}, env = process.env) {
  return updateState(cwd, (s) => {
    for (const job of Object.values(s.jobs)) {
      if (job.status !== "running") continue;
      const summary = summarizeStream(readJobLog(job));
      if (summary.status) {
        Object.assign(job, finishFromSummary(job, summary), { updatedAt: nowIso() });
        continue;
      }
      if (summary.conversationId && !job.conversationId) job.conversationId = summary.conversationId;
      if (summary.phase && summary.phase !== job.phase) job.phase = summary.phase;
      if (!isAlive(job.pid)) {
        Object.assign(job, { status: "failed", phase: "failed", summary: "process exited without result", finishedAt: nowIso(), updatedAt: nowIso() });
      }
    }
  }, env);
}

export function getJob(cwd, id, env = process.env) {
  return loadState(cwd, env).jobs[id] || null;
}

export function listJobs(cwd, env = process.env) {
  return Object.values(loadState(cwd, env).jobs).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function killJob(job) {
  if (!job.pid) return;
  if (process.platform === "win32") {
    await new Promise((resolve) => {
      const child = spawn("taskkill", ["/PID", String(job.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
      child.on("close", resolve);
      child.on("error", resolve);
    });
    return;
  }
  try { process.kill(job.pid, "SIGTERM"); } catch { return; }
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    if (!defaultIsAlive(job.pid)) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  try { process.kill(job.pid, "SIGKILL"); } catch { /* already gone */ }
}

export function findResumableJob(state, { kind = "task", claudeSessionId = null } = {}) {
  const candidates = Object.values(state.jobs || {})
    .filter((j) => j.kind === kind && j.conversationId && j.status !== "cancelled")
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  if (candidates.length === 0) return null;
  const same = claudeSessionId ? candidates.find((j) => j.claudeSessionId === claudeSessionId) : null;
  if (same) return { job: same, crossSession: false };
  return { job: candidates[0], crossSession: true };
}
