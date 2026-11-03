import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  parseModelsOutput,
  resolveModel,
  resolveAgyBinary,
  compareVersions,
  AgyError,
} from "../plugins/agy/scripts/lib/agy.mjs";

const FIXTURE = [
  "Fetching available models...",
  "gemini-4-argon-medium\tGemini 4 Argon (Medium)",
  "gemini-4-argon-high\tGemini 4 Argon (High)",
  "gemini-3.8-flash-low\tGemini 3.8 Flash (Low)",
  "claude-opus-5-5-low\tClaude Opus 5.5 (Low)",
  "gpt-oss-120b-medium\tGPT-OSS 120B (Medium)",
].join("\n");

test("parseModelsOutput splits id into base and effort", () => {
  const cat = parseModelsOutput(FIXTURE);
  assert.equal(cat.length, 5);
  assert.deepEqual(cat[0], { id: "gemini-4-argon-medium", base: "gemini-4-argon", effort: "medium", label: "Gemini 4 Argon (Medium)" });
  assert.equal(cat.find((m) => m.id === "gpt-oss-120b-medium").base, "gpt-oss-120b");
});

test("resolveModel applies purpose defaults", () => {
  const cat = parseModelsOutput(FIXTURE);
  assert.deepEqual(resolveModel({ purpose: "review" }, cat), { model: "gemini-4-argon", effort: "high" });
  assert.deepEqual(resolveModel({ purpose: "task" }, cat), { model: "gemini-4-argon", effort: "medium" });
  assert.deepEqual(resolveModel({ purpose: "gate" }, cat), { model: "gemini-3.8-flash", effort: "low" });
});

test("resolveModel maps aliases and keeps explicit effort", () => {
  const cat = parseModelsOutput(FIXTURE);
  assert.deepEqual(resolveModel({ model: "opus", effort: "low", purpose: "task" }, cat), { model: "claude-opus-5-5", effort: "low" });
});

test("resolveModel rejects unsupported effort without downgrade", () => {
  const cat = parseModelsOutput(FIXTURE);
  assert.throws(() => resolveModel({ model: "gpt-oss", effort: "high", purpose: "task" }, cat), (e) => e instanceof AgyError && /unsupported effort/.test(e.message));
});

test("resolveModel rejects unknown model", () => {
  const cat = parseModelsOutput(FIXTURE);
  assert.throws(() => resolveModel({ model: "nope", purpose: "task" }, cat), /unknown model/);
});

test("resolveAgyBinary honours AGY_BIN when it exists, else reports not found", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "agy-bin-"));
  const bin = path.join(dir, "agy");
  writeFileSync(bin, "");
  assert.equal(resolveAgyBinary({ AGY_BIN: bin, PATH: "" }), bin);
  assert.equal(resolveAgyBinary({ AGY_BIN: path.join(dir, "missing"), PATH: "" }), null);
});

test("compareVersions is numeric per segment", () => {
  assert.equal(compareVersions("1.4.12", "1.4.9"), 1);
  assert.equal(compareVersions("1.4.12", "1.4.12"), 0);
  assert.equal(compareVersions("1.10.0", "1.9.99"), 1);
});
