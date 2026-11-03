#!/usr/bin/env node
// Claude Code Stop hook. Delegates to the gate command; never fails the stop on its own errors.
import { makeContext } from "./lib/context.mjs";
import { runGate } from "./lib/commands/gate.mjs";

async function readStdin() {
  let data = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) data += chunk;
  return data;
}

async function main() {
  let input = {};
  try {
    const raw = await readStdin();
    input = raw.trim() ? JSON.parse(raw) : {};
  } catch {
    input = {};
  }
  const cwd = input.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const ctx = makeContext({ cwd, flags: {} });
  await runGate(ctx, { input });
}

main().catch((err) => {
  process.stderr.write(`[gate-degraded] hook error: ${err && err.message ? err.message : err}\n`);
}).finally(() => {
  process.exitCode = 0;
});
