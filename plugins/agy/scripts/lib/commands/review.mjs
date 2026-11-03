import { collectDiff } from "../git.mjs";
import { renderPrompt, schemaPath } from "../prompts.mjs";
import { buildAgyArgs, runAgy } from "../process.mjs";
import { summarizeStream } from "../stream.mjs";
import { createJob, updateJob } from "../jobs.mjs";
import { emit, pickModel, requireBinary } from "../context.mjs";
import { renderReview } from "../render.mjs";
import { appendFileSync } from "node:fs";

export const REVIEW_TIMEOUT_MS = 20 * 60 * 1000;

export function parseFindings(text) {
  const trimmed = String(text || "").trim();
  const candidates = [trimmed];
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) candidates.unshift(fence[1].trim());
  const brace = trimmed.indexOf("{");
  if (brace > 0) candidates.push(trimmed.slice(brace, trimmed.lastIndexOf("}") + 1));
  for (const c of candidates) {
    try {
      const obj = JSON.parse(c);
      if (obj && typeof obj === "object" && (obj.verdict === "approve" || obj.verdict === "needs-attention")) {
        return { verdict: obj.verdict, summary: String(obj.summary || ""), findings: Array.isArray(obj.findings) ? obj.findings : [] };
      }
    } catch { /* try next */ }
  }
  return null;
}

export async function runReview(ctx, { flags, positional }) {
  requireBinary(ctx);
  const adversarial = Boolean(flags.adversarial);
  const kind = adversarial ? "adversarial-review" : "review";
  const diff = collectDiff(ctx.cwd, { base: flags.base, staged: Boolean(flags.staged), paths: positional });
  if (!diff.text.trim()) {
    const result = { kind, model: flags.model || "default", effort: flags.effort || "default", target: diff.label, files: [], truncated: false, verdict: "approve", note: "no-diff", summary: "No changes to review.", findings: [] };
    emit(ctx, result, renderReview(result));
    return 0;
  }
  const { model, effort } = await pickModel(ctx, { model: flags.model, effort: flags.effort, purpose: "review" });
  const base = { kind, model, effort, target: diff.label, files: diff.files, truncated: diff.truncated };

  const prompt = renderPrompt(adversarial ? "adversarial-review" : "review", {
    TARGET_LABEL: diff.label,
    USER_FOCUS: flags.focus ? String(flags.focus) : "none",
    DIFF: diff.text,
    DIFF_NOTE: diff.truncated ? "\nNote: the diff was truncated to fit; review what is shown and say so in the summary." : "",
  });
  const job = createJob(ctx.cwd, { kind, model, effort, mode: "plan", prompt: `${kind} of ${diff.label}`, claudeSessionId: ctx.sessionId }, ctx.env);

  const attempt = async (extra) => {
    const args = buildAgyArgs({ model, effort, mode: "plan", jsonSchemaPath: schemaPath("review-findings"), prompt: prompt + extra });
    const res = await runAgy({ bin: ctx.bin, args, cwd: ctx.cwd, env: ctx.env, timeoutMs: REVIEW_TIMEOUT_MS });
    appendFileSync(job.logPath, res.stdout + (res.stderr ? `\n[stderr]\n${res.stderr}` : ""), "utf8");
    return { res, summary: summarizeStream(res.stdout) };
  };

  let { res, summary } = await attempt("");
  let parsed = summary.status === "SUCCESS" ? parseFindings(summary.response) : null;
  if (!parsed && summary.status === "SUCCESS") {
    ({ res, summary } = await attempt("\n\nReturn only the JSON object. No prose, no code fences."));
    parsed = parseFindings(summary.response);
  }

  if (summary.status !== "SUCCESS") {
    updateJob(ctx.cwd, job.id, { status: "failed", phase: "failed", summary: `agy exit ${res.code}`, finishedAt: new Date().toISOString() }, ctx.env);
    const detail = (res.stderr || summary.response || "").trim().slice(0, 500);
    emit(ctx, { ...base, verdict: "needs-attention", error: `agy failed (exit ${res.code})`, detail, jobId: job.id }, `Review failed: agy exit ${res.code}\n${detail}`);
    return 1;
  }

  const result = parsed
    ? { ...base, ...parsed, jobId: job.id, conversationId: summary.conversationId }
    : { ...base, verdict: "needs-attention", summary: `[unstructured] ${summary.response.trim().slice(0, 2000)}`, findings: [], jobId: job.id, conversationId: summary.conversationId };
  updateJob(ctx.cwd, job.id, { status: "completed", phase: "done", conversationId: summary.conversationId, summary: `${result.verdict}: ${result.findings.length} finding(s)`, finishedAt: new Date().toISOString(), usage: summary.usage }, ctx.env);
  emit(ctx, result, renderReview(result));
  return 0;
}
