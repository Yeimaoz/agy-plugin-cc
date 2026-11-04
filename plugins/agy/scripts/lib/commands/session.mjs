// `session`: drive an interactive agy (agy -i) running inside tmux. Unlike headless `task`, the
// permission prompts stay visible so a driver can read the screen and answer them.
import { createJob, getJob, listJobs, reconcileJobs, updateJob } from "../jobs.mjs";
import { emit, pickModel, requireBinary, UsageError } from "../context.mjs";
import { readStdinText } from "../stdin.mjs";
import { table, truncate } from "../render.mjs";
import * as tmux from "../tmux.mjs";

const MAX_PROMPT_BYTES = 60 * 1024; // -i takes the prompt over argv; stay far below ARG_MAX
const SETTLE_MS = 500;
const TAIL_LINES = 15;

// Strong signals: an actual approval menu / question about running something.
export const STRONG_PERMISSION_PATTERNS = [
  /Requesting permission for/i,
  /Run this command\?/i,
  /Do you trust/i,
  /\(y\/n\)/i,
  /\[y\/N\]/i,
  /Yes, allow/i,
  /Yes, (and )?run/i,
  /allow this/i,
];
// Weak signals (prose can contain these words): only count when the pane is not sitting at an idle prompt.
export const WEAK_PERMISSION_PATTERNS = [/\ballow\b/i, /\bapprove\b/i, /\bpermission\b/i];
export const QUESTION_PATTERNS = [/↑\/↓ Navigate/, /enter (to )?(confirm|select)/i];
export const IDLE_PATTERNS = [/\? for shortcuts/];
export const WORKING_PATTERNS = [/esc to interrupt/i, /\bthinking\b/i, /\bworking\b/i];

function tailLines(text, n) {
  return String(text || "").split(/\r?\n/).filter((l) => l.trim() !== "").slice(-n);
}

// Classify a captured pane. `patterns` lets tests override any list.
export function detectPrompt(text, patterns = {}) {
  const strong = patterns.permission || STRONG_PERMISSION_PATTERNS;
  const weak = patterns.permission ? [] : (patterns.weakPermission || WEAK_PERMISSION_PATTERNS);
  const question = patterns.question || QUESTION_PATTERNS;
  const idle = patterns.idle || IDLE_PATTERNS;
  const working = patterns.working || WORKING_PATTERNS;
  const lines = tailLines(text, TAIL_LINES);
  const joined = lines.join("\n");
  const any = (list, s = joined) => list.some((re) => re.test(s));
  const excerpt = (n) => lines.slice(-n).join("\n");
  if (lines.length === 0) return { kind: "working", excerpt: "" };
  if (any(strong)) return { kind: "permission", excerpt: excerpt(TAIL_LINES) };
  const last = lines.slice(-4).join("\n");
  const atIdle = any(idle, last);
  if (any(working, last)) return { kind: "working", excerpt: excerpt(5) };
  if (any(question)) return { kind: "question", excerpt: excerpt(TAIL_LINES) };
  if (!atIdle && any(weak)) return { kind: "permission", excerpt: excerpt(TAIL_LINES) };
  if (atIdle) return { kind: "idle", excerpt: excerpt(5) };
  return { kind: "working", excerpt: excerpt(5) };
}

function requireTmux(ctx) {
  if (!tmux.hasTmux({ env: ctx.env })) throw new UsageError("tmux not found. Install tmux (e.g. `sudo apt install tmux` or `brew install tmux`) to use `session`.");
}

function getSessionJob(ctx, id) {
  if (!id) throw new UsageError("session needs a job id");
  const job = getJob(ctx.cwd, id, ctx.env);
  if (!job) throw new UsageError(`unknown job ${id}`);
  if (job.kind !== "session" || !job.tmuxSession) throw new UsageError(`job ${id} is not a session job`);
  return job;
}

function markGone(ctx, job) {
  if (job.status !== "running") return job;
  return updateJob(ctx.cwd, job.id, { status: "completed", phase: "finished", summary: "tmux session ended", finishedAt: new Date().toISOString() }, ctx.env) || job;
}

function observe(ctx, job, lines) {
  if (!tmux.hasSession(job.tmuxSession, { env: ctx.env })) {
    markGone(ctx, job);
    return { jobId: job.id, state: "gone", excerpt: "", screen: "" };
  }
  const screen = tmux.capturePane(job.tmuxSession, { lines, env: ctx.env });
  const { kind, excerpt } = detectPrompt(screen);
  return { jobId: job.id, state: kind, excerpt, screen };
}

function renderObservation(o) {
  return `[state: ${o.state}]${o.screen ? `\n${o.screen}` : ""}`;
}

async function sessionStart(ctx, { flags, positional }) {
  const prompt = flags["prompt-stdin"] ? (await readStdinText()).trim() : positional.join(" ").trim();
  if (!prompt) throw new UsageError("session start needs a prompt: pass it as the last argument or pipe it with --prompt-stdin");
  if (Buffer.byteLength(prompt, "utf8") > MAX_PROMPT_BYTES) throw new UsageError(`prompt is over ${MAX_PROMPT_BYTES} bytes; agy -i takes it on argv, shorten it (point agy at a file instead).`);
  requireBinary(ctx);
  requireTmux(ctx);
  const picked = await pickModel(ctx, { model: flags.model, effort: flags.effort, purpose: "task" });
  const mode = flags.write ? "accept-edits" : "plan";
  const job = createJob(ctx.cwd, { kind: "session", model: picked.model, effort: picked.effort, mode, prompt, claudeSessionId: ctx.sessionId }, ctx.env);
  const name = `agy-${job.id}`;
  const agyArgs = ["-i", prompt, "--model", picked.model, "--effort", picked.effort, "--mode", mode];
  for (const dir of flags["add-dir"] || []) agyArgs.push("--add-dir", dir);
  const viaNode = String(ctx.bin).endsWith(".mjs");
  try {
    tmux.newSession({ name, cwd: ctx.cwd, cmd: viaNode ? process.execPath : ctx.bin, args: viaNode ? [ctx.bin, ...agyArgs] : agyArgs, env: ctx.env });
  } catch (err) {
    updateJob(ctx.cwd, job.id, { status: "failed", phase: "failed", summary: err.message, finishedAt: new Date().toISOString() }, ctx.env);
    throw new UsageError(err.message);
  }
  updateJob(ctx.cwd, job.id, { tmuxSession: name, phase: "interactive" }, ctx.env);
  emit(ctx, { jobId: job.id, tmuxSession: name, model: picked.model, effort: picked.effort, mode },
    `Started session ${job.id} (tmux ${name}, ${picked.model}/${picked.effort}, mode ${mode}).\nWatch with: session peek ${job.id}   Answer with: session send ${job.id} [--key] <text>   End with: session stop ${job.id}`);
  return 0;
}

async function sessionPeek(ctx, { flags, positional }) {
  const job = getSessionJob(ctx, positional[0]);
  const lines = flags.lines === undefined ? 60 : Number(flags.lines);
  if (!Number.isFinite(lines) || lines < 1) throw new UsageError("--lines must be a positive number");
  const o = observe(ctx, job, lines);
  emit(ctx, o, renderObservation(o));
  return 0;
}

async function sessionSend(ctx, { flags, positional }) {
  const job = getSessionJob(ctx, positional[0]);
  const text = positional.slice(1).join(" ");
  if (!text) throw new UsageError("session send needs text (or a key name with --key)");
  if (!tmux.hasSession(job.tmuxSession, { env: ctx.env })) {
    markGone(ctx, job);
    throw new UsageError(`session for job ${job.id} no longer exists`);
  }
  try {
    tmux.sendKeys(job.tmuxSession, text, { key: Boolean(flags.key), env: ctx.env });
  } catch (err) {
    throw new UsageError(err.message);
  }
  await new Promise((r) => setTimeout(r, SETTLE_MS));
  const o = observe(ctx, job, 40);
  emit(ctx, { jobId: job.id, sent: text, key: Boolean(flags.key), state: o.state, excerpt: o.excerpt }, `sent ${flags.key ? "key" : "text"}: ${text}\n[state: ${o.state}]`);
  return 0;
}

async function sessionStop(ctx, { positional }) {
  const job = getSessionJob(ctx, positional[0]);
  const killed = tmux.killSession(job.tmuxSession, { env: ctx.env });
  const updated = job.status === "running"
    ? updateJob(ctx.cwd, job.id, { status: "cancelled", phase: "cancelled", finishedAt: new Date().toISOString(), summary: "stopped by driver" }, ctx.env)
    : job;
  emit(ctx, { job: updated, killed }, `Session ${job.id} stopped${killed ? "" : " (tmux session was already gone)"}.`);
  return 0;
}

async function sessionList(ctx) {
  reconcileJobs(ctx.cwd, {}, ctx.env);
  const jobs = listJobs(ctx.cwd, ctx.env).filter((j) => j.kind === "session" && j.status === "running" && j.tmuxSession && tmux.hasSession(j.tmuxSession, { env: ctx.env }));
  const text = jobs.length === 0 ? "No live agy sessions." : table(["job", "tmux", "model/effort", "mode", "prompt"], jobs.map((j) => [j.id, j.tmuxSession, `${j.model}/${j.effort}`, j.mode, truncate(j.prompt, 50)]));
  emit(ctx, { sessions: jobs }, text);
  return 0;
}

const ACTIONS = { start: sessionStart, peek: sessionPeek, send: sessionSend, stop: sessionStop, list: sessionList };

export async function runSession(ctx, { flags, positional }) {
  const [action, ...rest] = positional;
  const handler = ACTIONS[action];
  if (!handler) throw new UsageError(`session needs an action: ${Object.keys(ACTIONS).join("|")}`);
  return handler(ctx, { flags, positional: rest });
}
