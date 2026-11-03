import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, utimesSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractHandoff, encodeProjectDir, resolveTranscriptPath, formatHandoff } from "../plugins/agy/scripts/lib/transfer.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = readFileSync(path.join(here, "fixtures/transcript-sample.jsonl"), "utf8");

test("extractHandoff keeps only user/assistant text and strips tool and system-reminder content", () => {
  const h = extractHandoff(fixture);
  assert.equal(h.messages.length, 5);
  const all = h.messages.map((m) => m.text).join("\n");
  assert.doesNotMatch(all, /tool_use|tool_result|def login|ignore me/);
  assert.match(all, /missing null check/);
  assert.equal(h.messages[0].role, "user");
  assert.equal(h.dropped, 0);
});

test("extractHandoff drops oldest messages when over budget but keeps order", () => {
  const h = extractHandoff(fixture, { budgetChars: 60 });
  assert.ok(h.dropped > 0);
  assert.equal(h.messages[h.messages.length - 1].text, "Added test_login_null.");
});

test("encodeProjectDir replaces non-alphanumerics with dashes", () => {
  assert.equal(encodeProjectDir("/home/me/My Proj"), "-home-me-My-Proj");
  assert.equal(encodeProjectDir("C:\\Users\\me\\proj"), "C--Users-me-proj");
});

test("resolveTranscriptPath prefers env override then newest jsonl in the project dir", () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "agy-home-"));
  const cwd = mkdtempSync(path.join(os.tmpdir(), "agy-cwd-"));
  const projDir = path.join(home, ".claude", "projects", encodeProjectDir(cwd));
  mkdirSync(projDir, { recursive: true });
  const old = path.join(projDir, "old.jsonl");
  const fresh = path.join(projDir, "new.jsonl");
  writeFileSync(old, "{}\n");
  writeFileSync(fresh, "{}\n");
  const past = new Date(Date.now() - 60_000);
  utimesSync(old, past, past);
  assert.equal(resolveTranscriptPath({ cwd, env: { AGY_CLAUDE_TRANSCRIPT_PATH: "/x/y.jsonl" } }), "/x/y.jsonl");
  assert.equal(resolveTranscriptPath({ cwd, env: {}, home }), fresh);
  assert.equal(resolveTranscriptPath({ cwd: mkdtempSync(path.join(os.tmpdir(), "agy-none-")), env: {}, home }), null);
});

test("formatHandoff renders role-prefixed lines", () => {
  const text = formatHandoff({ messages: [{ role: "user", text: "a" }, { role: "assistant", text: "b" }], dropped: 2 });
  assert.match(text, /^\[2 earlier messages omitted\]/);
  assert.match(text, /USER: a/);
  assert.match(text, /ASSISTANT: b/);
});
