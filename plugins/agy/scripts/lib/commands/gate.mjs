// Stop-hook review gate. Reads the Claude Stop hook JSON on stdin.
// Output contract: print nothing to allow; print {"decision":"block","reason"} to block. Always exit 0.
import { appendFileSync } from "node:fs";
import { collectDiff } from "../git.mjs";
import { renderPrompt, schemaPath } from "../prompts.mjs";
import { buildAgyArgs, runAgy } from "../process.mjs";
import { summarizeStream } from "../stream.mjs";
import { createJob, updateJob } from "../jobs.mjs";
import { loadState, updateState } from "../state.mjs";
import { pickModel } from "../context.mjs";

export const GATE_TIMEOUT_MS = 300_000;
export const GATE_MAX_CONSECUTIVE_BLOCKS = 2;

function degrade(reason) {
  process.stderr.write(`[gate-degraded] ${reason}\n`);
  return 0;
}

function parseDecision(text) {
  const trimmed = String(text || "").trim();
  const candidates = [trimmed];
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) candidates.unshift(fence[1].trim());
  const brace = trimmed.indexOf("{");
  if (brace > 0) candidates.push(trimmed.slice(brace, trimmed.lastIndexOf("}") + 1));
  for (const c of candidates) {
    try {
      const obj = JSON.parse(c);
      if (obj && (obj.decision === "ALLOW" || obj.decision === "BLOCK")) return { decision: obj.decision, reason: String(obj.reason || "") };
    } catch { /* next */ }
  }
  return null;
}

export async function runGate(ctx, { input }) {
  const state = loadState(ctx.cwd, ctx.env);
  if (!state.config.stopReviewGate) return 0;
  if (input.stop_hook_active) return 0;
  if (!ctx.bin) return degrade("agy binary not found");

  let diff;
  try {
    diff = collectDiff(ctx.cwd, {});
  } catch (err) {
    return degrade(`diff failed: ${err.message}`);
  }
  if (!diff.text.trim()) {
    updateState(ctx.cwd, (s) => { s.session.consecutiveBlocks = 0; }, ctx.env);
    return 0;
  }

  if ((state.session.consecutiveBlocks || 0) >= GATE_MAX_CONSECUTIVE_BLOCKS) {
    updateState(ctx.cwd, (s) => { s.session.consecutiveBlocks = 0; }, ctx.env);
    process.stderr.write(`[gate-limit] ${GATE_MAX_CONSECUTIVE_BLOCKS} consecutive blocks reached; allowing stop.\n`);
    return 0;
  }

  let picked;
  try {
    picked = await pickModel(ctx, { purpose: "gate" });
  } catch (err) {
    return degrade(err.message);
  }
  const prompt = renderPrompt("stop-review-gate", {
    CLAUDE_RESPONSE: String(input.last_assistant_message || "").slice(0, 20_000),
    DIFF: diff.text,
    DIFF_NOTE: diff.truncated ? "\nNote: the diff was truncated." : "",
  });
  const job = createJob(ctx.cwd, { kind: "gate", model: picked.model, effort: picked.effort, mode: "plan", prompt: "stop review gate", claudeSessionId: input.session_id || ctx.sessionId }, ctx.env);
  const args = buildAgyArgs({ model: picked.model, effort: picked.effort, mode: "plan", jsonSchemaPath: schemaPath("gate-decision"), prompt });
  const res = await runAgy({ bin: ctx.bin, args, cwd: ctx.cwd, env: ctx.env, timeoutMs: GATE_TIMEOUT_MS });
  appendFileSync(job.logPath, res.stdout + (res.stderr ? `\n[stderr]\n${res.stderr}` : ""), "utf8");
  const summary = summarizeStream(res.stdout);
  const finish = (status, text) => updateJob(ctx.cwd, job.id, { status, phase: status === "completed" ? "done" : "failed", summary: text, conversationId: summary.conversationId, finishedAt: new Date().toISOString() }, ctx.env);

  if (res.timedOut) { finish("failed", "timeout"); return degrade("agy timed out"); }
  if (summary.status !== "SUCCESS") { finish("failed", `agy exit ${res.code}`); return degrade(`agy exit ${res.code}`); }
  const decision = parseDecision(summary.response);
  if (!decision) { finish("failed", "unparseable decision"); return degrade("could not parse gate decision"); }

  finish("completed", `${decision.decision}: ${decision.reason}`);
  if (decision.decision === "ALLOW") {
    updateState(ctx.cwd, (s) => { s.session.consecutiveBlocks = 0; }, ctx.env);
    return 0;
  }
  updateState(ctx.cwd, (s) => { s.session.consecutiveBlocks = (s.session.consecutiveBlocks || 0) + 1; }, ctx.env);
  process.stdout.write(`${JSON.stringify({ decision: "block", reason: `agy review gate (${picked.model}): ${decision.reason}` })}\n`);
  return 0;
}
