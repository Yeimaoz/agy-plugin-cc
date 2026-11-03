import { readFileSync } from "node:fs";
import { defaultIsAlive, getJob, killJob, listJobs, reconcileJobs, updateJob } from "../jobs.mjs";
import { emit, requireBinary, UsageError } from "../context.mjs";
import { renderJobDetail, renderJobs } from "../render.mjs";
import { waitForJob } from "./task.mjs";

function readResult(job) {
  try { return readFileSync(job.resultPath, "utf8"); } catch { return ""; }
}

export async function runStatus(ctx, { flags, positional }) {
  requireBinary(ctx);
  reconcileJobs(ctx.cwd, { isAlive: defaultIsAlive }, ctx.env);
  const id = positional[0];
  if (id) {
    let job = getJob(ctx.cwd, id, ctx.env);
    if (!job) throw new UsageError(`unknown job ${id}`);
    if (flags.wait && job.status === "running") job = await waitForJob(ctx, id, { timeoutMs: Number(flags["timeout-ms"] || 0) });
    emit(ctx, { job }, renderJobDetail(job, job.status === "running" ? "" : readResult(job)));
    return 0;
  }
  let jobs = listJobs(ctx.cwd, ctx.env);
  if (!flags.all) {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    jobs = jobs.filter((j) => j.status === "running" || Date.parse(j.updatedAt) >= cutoff).slice(0, 20);
  }
  emit(ctx, { workspace: ctx.cwd, jobs }, renderJobs(jobs));
  return 0;
}

export async function runResult(ctx, { positional }) {
  requireBinary(ctx);
  const id = positional[0];
  if (!id) throw new UsageError("result needs a job id");
  reconcileJobs(ctx.cwd, { isAlive: defaultIsAlive }, ctx.env);
  const job = getJob(ctx.cwd, id, ctx.env);
  if (!job) throw new UsageError(`unknown job ${id}`);
  if (job.status === "running") {
    emit(ctx, { job, response: null }, `Job ${id} is still running (phase ${job.phase}). Try again or use /agy:status ${id} --wait.`);
    return 0;
  }
  const text = readResult(job);
  emit(ctx, { job, response: text }, renderJobDetail(job, text || "(no response captured)"));
  return job.status === "completed" ? 0 : 1;
}

export async function runCancel(ctx, { positional }) {
  requireBinary(ctx);
  const id = positional[0];
  if (!id) throw new UsageError("cancel needs a job id");
  reconcileJobs(ctx.cwd, { isAlive: defaultIsAlive }, ctx.env);
  const job = getJob(ctx.cwd, id, ctx.env);
  if (!job) throw new UsageError(`unknown job ${id}`);
  if (job.status !== "running") {
    emit(ctx, { job, cancelled: false }, `Job ${id} is not running (status ${job.status}).`);
    return 0;
  }
  await killJob(job);
  const updated = updateJob(ctx.cwd, id, { status: "cancelled", phase: "cancelled", finishedAt: new Date().toISOString(), summary: "cancelled by user" }, ctx.env);
  emit(ctx, { job: updated, cancelled: true }, `Job ${id} cancelled.`);
  return 0;
}
