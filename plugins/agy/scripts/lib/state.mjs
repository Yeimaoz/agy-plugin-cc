// Per-workspace state file: config, session info and job records.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export const STATE_FILE_NAME = "state.json";
export const JOBS_DIR_NAME = "jobs";

function defaultState() {
  return { version: 1, config: { stopReviewGate: false }, session: { id: null, consecutiveBlocks: 0 }, jobs: {} };
}

export function resolveStateDir(cwd, env = process.env) {
  let real = cwd;
  try { real = realpathSync(cwd); } catch { /* keep as given */ }
  const slug = (path.basename(real) || "workspace").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "workspace";
  const hash = createHash("sha1").update(real).digest("hex").slice(0, 8);
  const pluginData = env.CLAUDE_PLUGIN_DATA && env.CLAUDE_PLUGIN_DATA.trim();
  const root = pluginData ? path.join(pluginData, "state") : path.join(os.tmpdir(), "agy-companion");
  return path.join(root, `${slug}-${hash}`);
}

export function resolveStateFile(cwd, env) {
  return path.join(resolveStateDir(cwd, env), STATE_FILE_NAME);
}

export function resolveJobsDir(cwd, env) {
  return path.join(resolveStateDir(cwd, env), JOBS_DIR_NAME);
}

export function ensureStateDir(cwd, env) {
  const dir = resolveStateDir(cwd, env);
  mkdirSync(path.join(dir, JOBS_DIR_NAME), { recursive: true });
  return dir;
}

export function loadState(cwd, env = process.env) {
  const file = resolveStateFile(cwd, env);
  const base = defaultState();
  if (!existsSync(file)) return base;
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    return {
      ...base,
      ...parsed,
      config: { ...base.config, ...(parsed.config || {}) },
      session: { ...base.session, ...(parsed.session || {}) },
      jobs: parsed.jobs && typeof parsed.jobs === "object" ? parsed.jobs : {},
    };
  } catch {
    return base;
  }
}

export function saveState(cwd, state, env = process.env) {
  ensureStateDir(cwd, env);
  const file = resolveStateFile(cwd, env);
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2), "utf8");
  renameSync(tmp, file);
  return state;
}

export function updateState(cwd, mutate, env = process.env) {
  const state = loadState(cwd, env);
  const result = mutate(state);
  return saveState(cwd, result && typeof result === "object" ? result : state, env);
}
