import { readFileSync } from "node:fs";
import { renderPrompt } from "../prompts.mjs";
import { extractHandoff, formatHandoff, resolveTranscriptPath } from "../transfer.mjs";
import { emit, requireBinary, UsageError } from "../context.mjs";
import { startTask } from "./task.mjs";

export async function runTransfer(ctx, { flags, positional }) {
  requireBinary(ctx);
  const source = flags.source ? String(flags.source) : resolveTranscriptPath({ cwd: ctx.cwd, env: ctx.env });
  if (!source) throw new UsageError("Could not find the current Claude transcript. Pass --source <path-to-claude-jsonl>.");
  let jsonl;
  try { jsonl = readFileSync(source, "utf8"); } catch (err) { throw new UsageError(`Cannot read transcript ${source}: ${err.message}`); }
  const handoff = extractHandoff(jsonl);
  if (handoff.messages.length === 0) throw new UsageError(`Transcript ${source} has no user/assistant text to hand off.`);
  const instruction = positional.join(" ").trim() || "Continue the task from where the Claude session left off.";
  const prompt = renderPrompt("transfer", { HANDOFF: formatHandoff(handoff), INSTRUCTION: instruction });
  const preview = { source, messages: handoff.messages.length, dropped: handoff.dropped, chars: prompt.length, instruction };

  if (flags["dry-run"]) {
    emit(ctx, { ...preview, dryRun: true }, `Transfer preview: ${handoff.messages.length} messages (${handoff.dropped} older omitted), ${prompt.length} chars from ${source}.\nInstruction: ${instruction}\nNothing was sent.`);
    return 0;
  }
  const job = await startTask(ctx, { prompt, model: flags.model, effort: flags.effort, write: Boolean(flags.write), kind: "transfer", extra: { source } });
  emit(ctx, { ...preview, jobId: job.id, model: job.model, effort: job.effort, mode: job.mode },
    `Handed off to agy as job ${job.id} (${job.model}/${job.effort}, mode ${job.mode}).\nCheck /agy:status, fetch with /agy:result ${job.id}.`);
  return 0;
}
