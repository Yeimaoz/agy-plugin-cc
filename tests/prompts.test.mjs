import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderPrompt, promptPath, schemaPath } from "../plugins/agy/scripts/lib/prompts.mjs";

const vars = { TARGET_LABEL: "wt", USER_FOCUS: "none", DIFF: "+x", DIFF_NOTE: "", CLAUDE_RESPONSE: "r" };

for (const name of ["review", "adversarial-review", "stop-review-gate", "transfer"]) {
  test(`prompt ${name} renders without leftover placeholders`, () => {
    const out = renderPrompt(name, { ...vars, HANDOFF: "h", INSTRUCTION: "i" });
    assert.doesNotMatch(out, /\{\{[A-Z_]+\}\}/);
    assert.ok(out.length > 100);
  });
}

test("renderPrompt throws on missing variable", () => {
  assert.throws(() => renderPrompt("review", { TARGET_LABEL: "x" }), /missing/);
});

test("schemas are valid JSON with required arrays", () => {
  for (const name of ["review-findings", "gate-decision"]) {
    const s = JSON.parse(readFileSync(schemaPath(name), "utf8"));
    assert.ok(Array.isArray(s.required));
  }
  assert.ok(promptPath("review").endsWith(path.join("prompts", "review.md")));
});
