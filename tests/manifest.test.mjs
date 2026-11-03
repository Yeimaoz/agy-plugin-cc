import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (p) => JSON.parse(readFileSync(path.join(root, p), "utf8"));

test("marketplace manifest points at the agy plugin", () => {
  const m = readJson(".claude-plugin/marketplace.json");
  assert.equal(m.name, "agy-plugin-cc");
  assert.equal(m.plugins[0].name, "agy");
  assert.equal(m.plugins[0].source, "./plugins/agy");
});

test("plugin manifest has name and semver version", () => {
  const p = readJson("plugins/agy/.claude-plugin/plugin.json");
  assert.equal(p.name, "agy");
  assert.match(p.version, /^\d+\.\d+\.\d+$/);
});
