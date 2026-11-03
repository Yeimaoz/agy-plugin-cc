import { readFileSync } from "node:fs";
import { buildAgyArgs, spawnAgy } from "../process.mjs";
import { summarizeStream } from "../stream.mjs";
import { createJob, defaultIsAlive, findResumableJob, reconcileJobs, updateJob } from "../jobs.mjs";
import { loadState } from "../state.mjs";
import { emit, pickModel, requireBinary, UsageError } from "../context.mjs";

const POLL_MS = 1000;

export async function waitForJob(ctx, jobId, { timeoutMs = 0 } = {}) {
  const started = Date.now();
  for (;;) {
    const state = reconcileJobs(ctx.cwd, { isAlive: defaultIsAlive }, ctx.env);
    const job = state.jobs[jobId];
    if (!job || job.status !== "running") return job;
    if (timeoutMs > 0 && Date.now() - started > timeoutMs) return job;
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

export async function startTask(ctx, { prompt, model, effort, write = false, resume = false, addDirs = [], kind = "task", extra = {} }) {
  requireBinary(ctx);
  const picked = await pickModel(ctx, { model, effort, purpose: "task" });
  const mode = write ? "accept-edits" : "plan";
  let conversationId = null;
  let crossSession = false;
  if (resume) {
    const found = findResumableJob(loadState(ctx.cwd, ctx.env), { kind: "task", claudeSessionId: ctx.sessionId });
    if (found) {
      conversationId = found.job.conversationId;
      crossSession = found.crossSession;
    }
  }
  const job = createJob(ctx.cwd, { kind, model: picked.model, effort: picked.effort, mode, prompt, conversationId, claudeSessionId: ctx.sessionId, extra: { crossSession, ...extra } }, ctx.env);
  const args = buildAgyArgs({ model: picked.model, effort: picked.effort, mode, conversationId, addDirs, prompt });
  const { pid } = spawnAgy({ bin: ctx.bin, args, cwd: ctx.cwd, env: ctx.env, logPath: job.logPath, detached: true });
  updateJob(ctx.cwd, job.id, { pid, phase: "starting" }, ctx.env);
  return { ...job, pid, crossSession };
}

export async function runTask(ctx, { flags, positional }) {
  const prompt = positional.join(" ").trim();
  if (!prompt) throw new UsageError("task needs a prompt, e.g. task --background \"explain the failing test\"");
  if (flags.resume && flags.fresh) throw new UsageError("--resume and --fresh are mutually exclusive");
  const job = await startTask(ctx, {
    prompt,
    model: flags.model,
    effort: flags.effort,
    write: Boolean(flags.write),
    resume: Boolean(flags.resume),
    addDirs: flags["add-dir"] || [],
  });
  const note = job.crossSession ? " [cross-session: resumed a conversation from another Claude session]" : "";

  if (!flags.wait) {
    emit(ctx, { jobId: job.id, status: "running", model: job.model, effort: job.effort, mode: job.mode, conversationId: job.conversationId, crossSession: job.crossSession },
      `Started job ${job.id} (${job.model}/${job.effort}, mode ${job.mode}).${note}\nCheck /agy:status, fetch with /agy:result ${job.id}.`);
    return 0;
  }

  const finished = await waitForJob(ctx, job.id);
  const text = (() => { try { return readFileSync(finished.resultPath, "utf8"); } catch { return ""; } })();
  const summary = summarizeStream((() => { try { return readFileSync(finished.logPath, "utf8"); } catch { return ""; } })());
  const payload = { jobId: finished.id, status: finished.status, model: finished.model, effort: finished.effort, conversationId: finished.conversationId, response: text, usage: summary.usage, crossSession: job.crossSession };
  emit(ctx, payload, `${text.trimEnd() || "(no response)"}\n\n[job ${finished.id} ${finished.status}, ${finished.model}/${finished.effort}]${note}`);
  return finished.status === "completed" ? 0 : 1;
}
