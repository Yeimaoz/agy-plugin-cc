import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "plugins", "agy");
const USER_ONLY = ["review", "adversarial-review", "status", "result", "cancel", "transfer"];
const MODEL_OK = ["setup", "rescue"];

function frontmatter(file) {
  const text = readFileSync(file, "utf8");
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  assert.ok(m, `${file} has frontmatter`);
  return { fm: m[1], body: text.slice(m[0].length) };
}

for (const name of [...USER_ONLY, ...MODEL_OK]) {
  test(`command ${name} exists with the right invocation policy`, () => {
    const file = path.join(root, "commands", `${name}.md`);
    assert.ok(existsSync(file), `${file} missing`);
    const { fm, body } = frontmatter(file);
    assert.match(fm, /^description: .+/m);
    if (USER_ONLY.includes(name)) assert.match(fm, /^disable-model-invocation: true$/m);
    else assert.doesNotMatch(fm, /disable-model-invocation: true/);
    if (name !== "rescue") assert.match(body, /"\$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/agy-companion\.mjs"/);
    assert.doesNotMatch(body, /dangerously-skip-permissions/);
    assert.ok(body.split("\n").length <= 60, `${name}.md should stay short`);
  });
}

test("rescue agent is registered with Bash only and the runtime skill", () => {
  const { fm, body } = frontmatter(path.join(root, "agents", "agy-rescue.md"));
  assert.match(fm, /^name: agy-rescue$/m);
  assert.match(fm, /^model: sonnet$/m);
  assert.match(fm, /^tools: Bash$/m);
  assert.match(fm, /agy-cli-runtime/);
  assert.match(body, /"\$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/agy-companion\.mjs" task/);
  assert.match(body, /--prompt-stdin <<'AGY_PROMPT'/, "task text must go through a single-quoted heredoc");
});

test("review commands route focus text through --focus-stdin heredocs, never bare $ARGUMENTS in bash", () => {
  for (const name of ["review", "adversarial-review"]) {
    const text = readFileSync(path.join(root, "commands", `${name}.md`), "utf8");
    assert.match(text, /--focus-stdin <<'AGY_FOCUS'/, name);
    assert.doesNotMatch(text, /agy-companion\.mjs" review[^\n]*\$ARGUMENTS/, `${name} must not splice $ARGUMENTS into bash`);
  }
});

test("skills exist and document the never-skip-permissions rule and defaults", () => {
  const runtime = readFileSync(path.join(root, "skills", "agy-cli-runtime", "SKILL.md"), "utf8");
  assert.match(runtime, /^name: agy-cli-runtime$/m);
  assert.match(runtime, /never.*dangerously-skip-permissions/i);
  assert.match(runtime, /gemini-4-argon/);
  assert.match(runtime, /accept-edits/);
  const results = readFileSync(path.join(root, "skills", "agy-result-handling", "SKILL.md"), "utf8");
  assert.match(results, /^name: agy-result-handling$/m);
});

test("hooks.json quotes CLAUDE_PLUGIN_ROOT and keeps Stop timeout above the gate timeout", () => {
  const hooks = JSON.parse(readFileSync(path.join(root, "hooks", "hooks.json"), "utf8"));
  for (const entries of Object.values(hooks.hooks)) for (const e of entries) for (const h of e.hooks) assert.match(h.command, /"\$\{CLAUDE_PLUGIN_ROOT\}/);
  assert.ok(hooks.hooks.Stop[0].hooks[0].timeout >= 310);
});
