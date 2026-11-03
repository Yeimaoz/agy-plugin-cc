// Spawn the agy CLI without a shell. The prompt travels over stdin (never argv: Linux caps a
// single argv string at 128 KiB and Windows caps the whole command line at 32 K characters).
// Supports AGY_BIN pointing at a .mjs fake for tests.
import { spawn } from "node:child_process";
import { openSync, closeSync } from "node:fs";

export function buildAgyArgs({ model, effort, mode, outputFormat = "stream-json", conversationId, addDirs = [], jsonSchemaPath, prompt, viaStdin = false }) {
  if (typeof prompt !== "string" || !prompt.trim()) throw new Error("prompt is required");
  const args = [];
  if (model) args.push("--model", model);
  if (effort) args.push("--effort", effort);
  if (mode) args.push("--mode", mode);
  if (conversationId) args.push("--conversation", conversationId);
  for (const dir of addDirs) args.push("--add-dir", dir);
  if (jsonSchemaPath) args.push("--json-schema", jsonSchemaPath);
  args.push("--output-format", outputFormat);
  if (!viaStdin) args.push("-p", prompt);
  return args;
}

function commandFor(bin, args) {
  if (String(bin).endsWith(".mjs")) return { cmd: process.execPath, args: [bin, ...args] };
  return { cmd: bin, args };
}

function writeInput(child, input) {
  if (!child.stdin) return;
  if (input === undefined || input === null) {
    child.stdin.end();
    return;
  }
  child.stdin.on("error", () => { /* child exited early; nothing to do */ });
  child.stdin.end(String(input), "utf8");
}

// Detached spawn for background jobs. Returns { child, pid, ready } where `ready` resolves with the
// pid once the process has started, or rejects with the spawn error (ENOENT, EACCES, ...).
export function spawnAgy({ bin, args, cwd, env = process.env, logPath, input, detached = false }) {
  const { cmd, args: fullArgs } = commandFor(bin, args);
  const fd = logPath ? openSync(logPath, "a") : "ignore";
  const child = spawn(cmd, fullArgs, {
    cwd,
    env,
    detached,
    windowsHide: true,
    stdio: ["pipe", fd, fd],
  });
  const closeFd = () => { if (logPath) { try { closeSync(fd); } catch { /* already closed */ } } };
  const ready = new Promise((resolve, reject) => {
    child.once("spawn", () => { closeFd(); resolve(child.pid); });
    child.once("error", (err) => { closeFd(); reject(err); });
  });
  ready.catch(() => { /* consumers await ready; avoid unhandled rejection when they don't */ });
  writeInput(child, input);
  if (detached) child.unref();
  return { child, pid: child.pid, ready };
}

// Foreground run that collects output. `onSpawn(pid)` lets callers record the child pid.
export function runAgy({ bin, args, cwd, env = process.env, input, timeoutMs = 0, onSpawn }) {
  const { cmd, args: fullArgs } = commandFor(bin, args);
  return new Promise((resolve) => {
    const child = spawn(cmd, fullArgs, { cwd, env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });
    let timer = null;
    if (timeoutMs > 0) {
      timer = setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs);
    }
    child.once("spawn", () => { if (onSpawn) onSpawn(child.pid); });
    child.on("error", (error) => {
      if (timer) clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: stderr + String(error), timedOut, error });
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr, timedOut });
    });
    writeInput(child, input);
  });
}
