import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseStreamLine, summarizeStream } from "../plugins/agy/scripts/lib/stream.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = readFileSync(path.join(here, "fixtures/stream-sample.ndjson"), "utf8");

test("parseStreamLine classifies events", () => {
  assert.equal(parseStreamLine('{"event":"init","conversation_id":"c1","init":{}}').event, "init");
  assert.equal(parseStreamLine("garbage").event, "unknown");
});

test("summarizeStream extracts conversation, model, status, phase and last tool", () => {
  const s = summarizeStream(fixture);
  assert.equal(s.conversationId, "9d6dec87-dd82-46a0-a229-393eeb66f505");
  assert.equal(s.model, "gemini-3.8-flash");
  assert.equal(s.status, "SUCCESS");
  assert.equal(s.phase, "done");
  assert.equal(s.lastTool, "write_file");
  assert.ok(s.response.length > 0);
  assert.ok(s.usage && typeof s.usage.total_tokens === "number");
});

test("summarizeStream reports thinking phase before result", () => {
  const partial = fixture.split("\n").filter((l) => !l.includes('"event":"result"')).join("\n");
  const s = summarizeStream(partial);
  assert.equal(s.status, null);
  assert.equal(s.phase, "thinking");
});
