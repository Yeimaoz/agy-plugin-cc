import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildAgyArgs, runAgy } from "../plugins/agy/scripts/lib/process.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const FAKE = path.join(here, "fixtures/fake-agy.mjs");

test("buildAgyArgs puts flags first and the prompt last, verbatim", () => {
  const prompt = 'say "hi" $x\n`tick`';
  const args = buildAgyArgs({ model: "gemini-4-argon", effort: "high", mode: "plan", conversationId: "c1", addDirs: ["/a", "/b"], jsonSchemaPath: "/s.json", prompt });
  assert.deepEqual(args, ["--model", "gemini-4-argon", "--effort", "high", "--mode", "plan", "--conversation", "c1", "--add-dir", "/a", "--add-dir", "/b", "--json-schema", "/s.json", "--output-format", "stream-json", "-p", prompt]);
});

test("runAgy passes the prompt intact without a shell", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "agy-proc-"));
  const argsFile = path.join(dir, "args.json");
  const prompt = 'say "hi" $x\n`tick`';
  const res = await runAgy({ bin: FAKE, args: buildAgyArgs({ model: "m", effort: "low", mode: "plan", prompt }), cwd: dir, env: { ...process.env, FAKE_AGY_ARGS_FILE: argsFile } });
  assert.equal(res.code, 0);
  const seen = JSON.parse(readFileSync(argsFile, "utf8"));
  assert.equal(seen[seen.length - 1], prompt);
  assert.ok(res.stdout.includes('"event":"result"'));
});
