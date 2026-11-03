// Build a condensed handoff from a Claude Code transcript (.jsonl).
import { existsSync, readdirSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export const HANDOFF_BUDGET_CHARS = 80_000;

function textOf(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((part) => part && part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n");
}

function stripReminders(text) {
  return text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "").trim();
}

export function extractHandoff(jsonlText, { budgetChars = HANDOFF_BUDGET_CHARS } = {}) {
  const messages = [];
  for (const line of String(jsonlText).split(/\r?\n/)) {
    if (!line.trim()) continue;
    let row;
    try { row = JSON.parse(line); } catch { continue; }
    const role = row.type === "user" || row.type === "assistant" ? row.type : row.message?.role;
    if (role !== "user" && role !== "assistant") continue;
    const text = stripReminders(textOf(row.message?.content ?? row.content));
    if (!text) continue;
    messages.push({ role, text });
  }
  let used = 0;
  let keepFrom = messages.length;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const cost = messages[i].text.length + 16;
    if (used + cost > budgetChars) break;
    used += cost;
    keepFrom = i;
  }
  return { messages: messages.slice(keepFrom), dropped: keepFrom };
}

export function formatHandoff({ messages, dropped }) {
  const lines = [];
  if (dropped > 0) lines.push(`[${dropped} earlier messages omitted]`, "");
  for (const m of messages) lines.push(`${m.role.toUpperCase()}: ${m.text}`, "");
  return lines.join("\n").trimEnd();
}

export function encodeProjectDir(cwd) {
  return String(cwd).replace(/[^A-Za-z0-9]/g, "-");
}

export function resolveTranscriptPath({ cwd, env = process.env, home = env.HOME || env.USERPROFILE || os.homedir() } = {}) {
  if (env.AGY_CLAUDE_TRANSCRIPT_PATH && env.AGY_CLAUDE_TRANSCRIPT_PATH.trim()) return env.AGY_CLAUDE_TRANSCRIPT_PATH.trim();
  const dir = path.join(home, ".claude", "projects", encodeProjectDir(cwd));
  if (!existsSync(dir)) return null;
  let best = null;
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".jsonl")) continue;
    const full = path.join(dir, name);
    const mtime = statSync(full).mtimeMs;
    if (!best || mtime > best.mtime) best = { full, mtime };
  }
  return best ? best.full : null;
}
