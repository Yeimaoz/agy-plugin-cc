// Spawn the agy CLI without a shell. Supports AGY_BIN pointing at a .mjs fake for tests.
import { spawn } from "node:child_process";
import { openSync, closeSync } from "node:fs";

export function buildAgyArgs({ model, effort, mode, outputFormat = "stream-json", conversationId, addDirs = [], jsonSchemaPath, prompt }) {
  if (typeof prompt !== "string" || !prompt.trim()) throw new Error("prompt is required");
  const args = [];
  if (model) args.push("--model", model);
  if (effort) args.push("--effort", effort);
  if (mode) args.push("--mode", mode);
  if (conversationId) args.push("--conversation", conversationId);
  for (const dir of addDirs) args.push("--add-dir", dir);
  if (jsonSchemaPath) args.push("--json-schema", jsonSchemaPath);
  args.push("--output-format", outputFormat);
  args.push("-p", prompt);
  return args;
}

function commandFor(bin, args) {
  if (String(bin).endsWith(".mjs")) return { cmd: process.execPath, args: [bin, ...args] };
  return { cmd: bin, args };
}

export function spawnAgy({ bin, args, cwd, env = process.env, logPath, detached = false }) {
  const { cmd, args: fullArgs } = commandFor(bin, args);
  const fd = logPath ? openSync(logPath, "a") : "ignore";
  const child = spawn(cmd, fullArgs, {
    cwd,
    env,
    detached,
    windowsHide: true,
    stdio: ["ignore", fd, fd],
  });
  if (logPath) child.on("spawn", () => closeSync(fd));
  if (detached) child.unref();
  return { child, pid: child.pid };
}

export function runAgy({ bin, args, cwd, env = process.env, timeoutMs = 0 }) {
  const { cmd, args: fullArgs } = commandFor(bin, args);
  return new Promise((resolve) => {
    const child = spawn(cmd, fullArgs, { cwd, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
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
    child.on("error", (error) => {
      if (timer) clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: stderr + String(error), timedOut, error });
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr, timedOut });
    });
  });
}
