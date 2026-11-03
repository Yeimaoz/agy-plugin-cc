import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { collectDiff, DIFF_CHAR_CAP } from "../plugins/agy/scripts/lib/git.mjs";

function repo() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "agy-git-"));
  const git = (...a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8" });
  git("init", "-q");
  git("config", "user.email", "t@t");
  git("config", "user.name", "t");
  writeFileSync(path.join(dir, "a.txt"), "one\n");
  git("add", "a.txt");
  git("commit", "-q", "-m", "init");
  return { dir, git };
}

test("collectDiff includes modified and untracked files", () => {
  const { dir } = repo();
  writeFileSync(path.join(dir, "a.txt"), "two\n");
  writeFileSync(path.join(dir, "new.txt"), "fresh\n");
  const d = collectDiff(dir, {});
  assert.deepEqual(d.files.sort(), ["a.txt", "new.txt"]);
  assert.ok(d.text.includes("-one"));
  assert.ok(d.text.includes("+fresh"));
  assert.equal(d.truncated, false);
  assert.equal(d.label, "working tree vs HEAD");
});

test("collectDiff returns empty when nothing changed", () => {
  const { dir } = repo();
  const d = collectDiff(dir, {});
  assert.equal(d.text, "");
  assert.deepEqual(d.files, []);
});

test("collectDiff caps output and marks truncation", () => {
  const { dir } = repo();
  writeFileSync(path.join(dir, "big.txt"), "x".repeat(DIFF_CHAR_CAP + 50_000));
  const d = collectDiff(dir, {});
  assert.equal(d.truncated, true);
  assert.ok(d.text.length <= DIFF_CHAR_CAP + 200);
  assert.match(d.text, /\[truncated \d+ chars\]/);
});

test("collectDiff with --base uses that ref and labels it", () => {
  const { dir, git } = repo();
  writeFileSync(path.join(dir, "a.txt"), "two\n");
  git("commit", "-q", "-am", "second");
  const d = collectDiff(dir, { base: "HEAD~1" });
  assert.ok(d.text.includes("+two"));
  assert.equal(d.label, "HEAD~1..working tree");
});
