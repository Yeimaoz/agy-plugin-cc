import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildAgyArgs, runAgy, spawnAgy } from "../plugins/agy/scripts/lib/process.mjs";

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

test("buildAgyArgs omits -p when the prompt goes over stdin", () => {
  const args = buildAgyArgs({ model: "m", effort: "low", mode: "plan", prompt: "x", viaStdin: true });
  assert.equal(args.includes("-p"), false);
  assert.deepEqual(args.slice(-2), ["--output-format", "stream-json"]);
});

test("runAgy pipes a large prompt with shell metacharacters over stdin intact", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "agy-proc-"));
  const argsFile = path.join(dir, "args.json");
  const prompt = `big $HOME \`cmd\` "q"\n${"x".repeat(300_000)}`;
  const res = await runAgy({ bin: FAKE, args: buildAgyArgs({ model: "m", effort: "low", mode: "plan", prompt, viaStdin: true }), input: prompt, cwd: dir, env: { ...process.env, FAKE_AGY_ARGS_FILE: argsFile } });
  assert.equal(res.code, 0);
  const seen = JSON.parse(readFileSync(argsFile, "utf8"));
  assert.equal(seen[seen.length - 1], `STDIN:${prompt}`);
});

test("spawnAgy detached reports spawn errors through ready and never throws", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "agy-proc-"));
  const { ready } = spawnAgy({ bin: path.join(dir, "missing-agy"), args: ["--output-format", "stream-json"], input: "x", cwd: dir, logPath: path.join(dir, "j.log"), detached: true });
  await assert.rejects(ready, /ENOENT|spawn/);
});

test("spawnAgy detached delivers stdin to the child and resolves ready with a pid", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "agy-proc-"));
  const argsFile = path.join(dir, "args.json");
  const logPath = path.join(dir, "j.log");
  const { ready, child } = spawnAgy({ bin: FAKE, args: ["--output-format", "stream-json"], input: "hello $x", cwd: dir, env: { ...process.env, FAKE_AGY_ARGS_FILE: argsFile }, logPath, detached: true });
  const pid = await ready;
  assert.ok(pid > 0);
  child.ref(); // the test wants to observe exit; production callers leave it unref'd
  await new Promise((r) => child.on("close", r));
  assert.equal(JSON.parse(readFileSync(argsFile, "utf8")).pop(), "STDIN:hello $x");
  assert.ok(readFileSync(logPath, "utf8").includes('"event":"result"'));
});
