// Shared command context: binary, workspace, catalog, session id, output helpers.
import { AgyError, listModels, resolveAgyBinary, resolveModel } from "./agy.mjs";
import { resolveWorkspaceRoot } from "./git.mjs";
import { loadState } from "./state.mjs";

export class UsageError extends Error {
  constructor(message) {
    super(message);
    this.name = "UsageError";
    this.exitCode = 2;
  }
}

export function makeContext({ env = process.env, cwd = process.cwd(), flags = {} } = {}) {
  const workspace = resolveWorkspaceRoot(env.CLAUDE_PROJECT_DIR || cwd);
  const bin = resolveAgyBinary(env);
  const state = loadState(workspace, env);
  const sessionId = env.AGY_CLAUDE_SESSION_ID || state.session?.id || null;
  return { env, cwd: workspace, bin, json: Boolean(flags.json), sessionId };
}

export function requireBinary(ctx) {
  if (!ctx.bin) throw new UsageError("agy CLI not found. Install the Antigravity CLI and run /agy:setup.");
  return ctx.bin;
}

let catalogCache = null;
export async function getCatalog(ctx) {
  if (catalogCache) return catalogCache;
  requireBinary(ctx);
  try {
    catalogCache = await listModels(ctx.bin);
  } catch (err) {
    if (err instanceof AgyError) throw new UsageError(`${err.message}. Are you signed in? Run /agy:setup.`);
    throw err;
  }
  return catalogCache;
}

export async function pickModel(ctx, { model, effort, purpose }) {
  const catalog = await getCatalog(ctx);
  try {
    return resolveModel({ model, effort, purpose }, catalog);
  } catch (err) {
    if (err instanceof AgyError) throw new UsageError(err.message);
    throw err;
  }
}

export function emit(ctx, payload, humanText) {
  if (ctx.json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else {
    process.stdout.write(`${humanText}\n`);
  }
}
