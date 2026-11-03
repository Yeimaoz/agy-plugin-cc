// Antigravity CLI (agy) binary resolution, model catalog and selection.
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";

export const MIN_AGY_VERSION = "1.4.12";
export const EFFORTS = ["low", "medium", "high", "xhigh", "max"];

export const ALIASES = Object.freeze({
  argon: "gemini-4-argon",
  flash: "gemini-3.8-flash",
  opus: "claude-opus-5-5",
  sonnet: "claude-sonnet-5-5",
  "gpt-oss": "gpt-oss-120b",
});

export const PURPOSE_DEFAULTS = Object.freeze({
  review: { model: "gemini-4-argon", effort: "high" },
  task: { model: "gemini-4-argon", effort: "medium" },
  gate: { model: "gemini-3.8-flash", effort: "low" },
});

export class AgyError extends Error {
  constructor(message, code = "AGY_ERROR") {
    super(message);
    this.name = "AgyError";
    this.code = code;
  }
}

const EFFORT_SUFFIX = new RegExp(`-(${EFFORTS.join("|")})$`);

export function resolveAgyBinary(env = process.env) {
  if (env.AGY_BIN && env.AGY_BIN.trim()) {
    const explicit = env.AGY_BIN.trim();
    return existsSync(explicit) ? explicit : null;
  }
  const names = process.platform === "win32" ? ["agy.exe", "agy.cmd", "agy"] : ["agy"];
  const dirs = (env.PATH || "").split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    for (const name of names) {
      const candidate = path.join(dir, name);
      if (existsSync(candidate)) return candidate;
    }
  }
  const home = env.HOME || env.USERPROFILE || os.homedir();
  for (const name of names) {
    const candidate = path.join(home, ".local", "bin", name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export function parseModelsOutput(text) {
  const catalog = [];
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || !line.includes("\t")) continue;
    const [id, ...rest] = line.split("\t");
    const match = id.match(EFFORT_SUFFIX);
    if (!match) continue;
    catalog.push({ id, base: id.slice(0, -match[0].length), effort: match[1], label: rest.join("\t").trim() });
  }
  return catalog;
}

export function resolveModel(spec, catalog) {
  const purpose = spec.purpose || "task";
  const defaults = PURPOSE_DEFAULTS[purpose] || PURPOSE_DEFAULTS.task;
  const requested = (spec.model || "").trim();
  const base = requested ? ALIASES[requested] || requested : defaults.model;
  const effort = (spec.effort || defaults.effort).trim();
  const bases = new Set(catalog.map((m) => m.base));
  if (!bases.has(base)) {
    throw new AgyError(`unknown model "${base}" (available: ${[...bases].join(", ")})`, "UNKNOWN_MODEL");
  }
  if (!EFFORTS.includes(effort)) {
    throw new AgyError(`unsupported effort "${effort}" (valid: ${EFFORTS.join(", ")})`, "UNSUPPORTED_EFFORT");
  }
  const supported = catalog.filter((m) => m.base === base).map((m) => m.effort);
  if (!supported.includes(effort)) {
    throw new AgyError(`unsupported effort "${effort}" for ${base} (supported: ${supported.join(", ")})`, "UNSUPPORTED_EFFORT");
  }
  return { model: base, effort };
}

export function compareVersions(a, b) {
  const pa = String(a).replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0);
  const pb = String(b).replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i += 1) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}

function execAgy(bin, args, { timeoutMs = 60_000 } = {}) {
  return new Promise((resolve) => {
    const cmd = bin.endsWith(".mjs") ? process.execPath : bin;
    const fullArgs = bin.endsWith(".mjs") ? [bin, ...args] : args;
    execFile(cmd, fullArgs, { timeout: timeoutMs, windowsHide: true, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({ code: error ? (typeof error.code === "number" ? error.code : 1) : 0, stdout: stdout || "", stderr: stderr || "", error });
    });
  });
}

export async function listModels(bin) {
  const { code, stdout, stderr } = await execAgy(bin, ["models"]);
  const catalog = parseModelsOutput(stdout);
  if (code !== 0 || catalog.length === 0) {
    throw new AgyError(`agy models failed (exit ${code}): ${(stderr || stdout).trim().slice(0, 300) || "no output"}`, "MODELS_FAILED");
  }
  return catalog;
}

export async function checkVersion(bin) {
  const { code, stdout, stderr } = await execAgy(bin, ["--version"], { timeoutMs: 15_000 });
  const match = (stdout + stderr).match(/(\d+\.\d+\.\d+)/);
  const version = match ? match[1] : null;
  return { version, ok: code === 0 && version !== null && compareVersions(version, MIN_AGY_VERSION) >= 0 };
}
