// Thin tmux wrapper (spawnSync, never a shell). AGY_TMUX_BIN overrides the binary; a .mjs value is
// run through node so tests can plug in a fake.
import { spawnSync } from "node:child_process";

function resolve(env) {
  const bin = (env.AGY_TMUX_BIN && env.AGY_TMUX_BIN.trim()) || "tmux";
  if (bin.endsWith(".mjs")) return { cmd: process.execPath, pre: [bin] };
  return { cmd: bin, pre: [] };
}

function run(args, env = process.env) {
  const { cmd, pre } = resolve(env);
  const r = spawnSync(cmd, [...pre, ...args], { encoding: "utf8", env, windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
  return { status: r.error ? -1 : (r.status ?? -1), stdout: r.stdout || "", stderr: r.stderr || "", error: r.error || null };
}

export function hasTmux({ env = process.env } = {}) {
  return run(["-V"], env).status === 0;
}

export function newSession({ name, cwd, cmd, args = [], env = process.env }) {
  const r = run(["new-session", "-d", "-s", name, "-c", cwd, "-x", "200", "-y", "50", "--", cmd, ...args], env);
  if (r.status !== 0) throw new Error(`tmux new-session failed: ${(r.stderr || String(r.error || "")).trim()}`);
}

// key=true sends `text` as a tmux key name (y, n, Enter, C-c, Escape, ...); otherwise it is typed
// literally (-l) and followed by Enter unless enter=false.
export function sendKeys(name, text, { enter = true, key = false, env = process.env } = {}) {
  if (key) {
    if (!/^[A-Za-z0-9_-]+$/.test(text)) throw new Error(`invalid tmux key name: ${text}`);
    const r = run(["send-keys", "-t", name, text], env);
    if (r.status !== 0) throw new Error(`tmux send-keys failed: ${r.stderr.trim()}`);
    return;
  }
  const r = run(["send-keys", "-t", name, "-l", "--", text], env);
  if (r.status !== 0) throw new Error(`tmux send-keys failed: ${r.stderr.trim()}`);
  if (enter) {
    const e = run(["send-keys", "-t", name, "Enter"], env);
    if (e.status !== 0) throw new Error(`tmux send-keys failed: ${e.stderr.trim()}`);
  }
}

export function capturePane(name, { lines = 60, env = process.env } = {}) {
  const n = Math.max(1, Math.floor(Number(lines) || 60));
  const r = run(["capture-pane", "-p", "-t", name, "-S", `-${n}`], env);
  if (r.status !== 0) throw new Error(`tmux capture-pane failed: ${r.stderr.trim()}`);
  return r.stdout.replace(/\s+$/, "");
}

export function hasSession(name, { env = process.env } = {}) {
  return run(["has-session", "-t", name], env).status === 0;
}

export function killSession(name, { env = process.env } = {}) {
  return run(["kill-session", "-t", name], env).status === 0;
}
