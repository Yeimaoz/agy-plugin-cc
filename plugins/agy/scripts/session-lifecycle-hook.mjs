#!/usr/bin/env node
// Claude Code SessionStart / SessionEnd hook: record the session id, expose it to later Bash calls,
// and mark background jobs orphaned when the session ends (they are not killed).
import { appendFileSync } from "node:fs";
import { resolveWorkspaceRoot } from "./lib/git.mjs";
import { updateState } from "./lib/state.mjs";

async function readStdin() {
  let data = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) data += chunk;
  return data;
}

function exportEnv(name, value) {
  const file = process.env.CLAUDE_ENV_FILE;
  if (!file || !value) return;
  const quoted = `'${String(value).replace(/'/g, "'\\''")}'`;
  try { appendFileSync(file, `export ${name}=${quoted}\n`, "utf8"); } catch { /* best effort */ }
}

async function main() {
  let input = {};
  try {
    const raw = await readStdin();
    input = raw.trim() ? JSON.parse(raw) : {};
  } catch {
    input = {};
  }
  const event = process.argv[2] || input.hook_event_name || "";
  const cwd = resolveWorkspaceRoot(input.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd());
  const sessionId = input.session_id || null;

  if (event === "SessionStart") {
    updateState(cwd, (s) => { s.session.id = sessionId; s.session.consecutiveBlocks = 0; });
    exportEnv("AGY_CLAUDE_SESSION_ID", sessionId);
    exportEnv("AGY_CLAUDE_TRANSCRIPT_PATH", input.transcript_path || null);
    return;
  }
  if (event === "SessionEnd") {
    updateState(cwd, (s) => {
      for (const job of Object.values(s.jobs)) {
        if (job.status === "running" && (!sessionId || job.claudeSessionId === sessionId)) job.orphaned = true;
      }
    });
  }
}

main().catch((err) => {
  process.stderr.write(`agy lifecycle hook: ${err && err.message ? err.message : err}\n`);
}).finally(() => {
  process.exitCode = 0;
});
