# agy plugin v0.1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Claude Code plugin `agy` that drives Google Antigravity CLI headlessly with feature parity to openai/codex-plugin-cc 1.0.6 (setup / review / adversarial-review / rescue / status / result / cancel / transfer / rescue subagent / optional stop review gate).

**Architecture:** One zero-dependency Node ESM CLI (`plugins/agy/scripts/agy-companion.mjs`) does all the work; Claude Code command `.md` files just invoke it and render its output. Jobs are detached `agy -p` child processes whose stream-json stdout is written to a per-job log; a JSON state file per workspace tracks job records. Hooks are thin wrappers around the same CLI.

**Tech Stack:** Node ≥ 18.18, ESM, `node:test`, `node:child_process`, no npm deps. agy ≥ 1.4.12.

**Spec:** `docs/superpowers/specs/2026-11-04-agy-plugin-design.md`

## Global Constraints

- Node `>=18.18`; `"type": "module"`; zero runtime npm dependencies.
- Never pass `--dangerously-skip-permissions` to agy. Writes use `--mode accept-edits`; read-only uses `--mode plan`.
- Model selection: `--model <bare-id> --effort <low|medium|high|xhigh|max>`. Unsupported effort for a model → error, no downgrade.
- Defaults: review/adversarial-review `gemini-4-argon` + `high`; rescue/task/transfer `gemini-4-argon` + `medium`; gate `gemini-3.8-flash` + `low`.
- Aliases: `argon→gemini-4-argon`, `flash→gemini-3.8-flash`, `opus→claude-opus-5-5`, `sonnet→claude-sonnet-5-5`, `gpt-oss→gpt-oss-120b`.
- `disable-model-invocation: true` on review, adversarial-review, status, result, cancel, transfer. Not on setup, rescue.
- State dir: `$CLAUDE_PLUGIN_DATA/state/<slug>-<hash8>/` else `os.tmpdir()/agy-companion/<slug>-<hash8>/`.
- Cross-platform: `node:path`, `spawn(bin, args)` without shell, `windowsHide: true`, no emoji in output, stdout utf-8.
- Review gate default off; fail-open ALLOW on any error/timeout with `[gate-degraded]` in reason; max 2 consecutive BLOCK per session.
- Diff cap 200_000 chars; untracked files included.
- Transfer: strip tool_use/tool_result/system-reminder, user+assistant text only, 80_000 char budget, user confirmation required before sending.
- agy prompt must be the value of `-p`; all other flags precede `-p`.

## Review Focus

1. `agy` not on PATH or not logged in → every command prints a clear "run /agy:setup" message, exits non-zero, never hangs. (Task 2 test `resolveAgyBinary` / `checkAuth`.)
2. Job process dies without writing a `result` event (killed, network drop) → `status` shows `failed`, not `running` forever. (Task 4 test pid-liveness reconciliation.)
3. Prompt containing quotes, newlines, `$`, backticks → passed intact (no shell). (Task 3 test spawn args array.)
4. Review on a repo with no changes → verdict `approve` with "no diff" note, agy not invoked. (Task 6 test empty diff.)
5. Windows path with spaces in `CLAUDE_PLUGIN_ROOT` → commands still resolve (quoted in `.md`, `path.join` in code). (Task 8 lint: every command uses `"${CLAUDE_PLUGIN_ROOT}"` quoted.)

---

### Task 1: Repo scaffold, manifests, CI

**Files:**
- Create: `package.json`, `.gitignore`, `.claude-plugin/marketplace.json`, `plugins/agy/.claude-plugin/plugin.json`, `.github/workflows/ci.yml`, `README.md`, `CHANGELOG.md`
- Test: `tests/manifest.test.mjs`

**Interfaces:**
- Produces: marketplace name `agy-plugin-cc`, plugin name `agy`, source `./plugins/agy`.

- [ ] **Step 1: Write failing test** `tests/manifest.test.mjs`: reads both JSON files; asserts `marketplace.name === "agy-plugin-cc"`, `plugins[0].name === "agy"`, `plugins[0].source === "./plugins/agy"`, `plugin.name === "agy"`, `semver-ish version`.
- [ ] **Step 2: Run** `node --test tests/` → FAIL (ENOENT).
- [ ] **Step 3: Create** `package.json` (`{"name":"agy-plugin-cc","private":true,"type":"module","engines":{"node":">=18.18"},"scripts":{"test":"node --test tests/"}}`), both manifests (copy field shape from openai-codex marketplace, author `Yeimaoz`), `.gitignore` (`node_modules/`, `*.tmp`, `.envrc`, `.claude/`), `ci.yml` (matrix ubuntu-latest + windows-latest, node 20, `npm test`), README stub (install commands, command table), CHANGELOG `0.1.0 - Unreleased`.
- [ ] **Step 4: Run** `node --test tests/` → PASS.
- [ ] **Step 5: Commit** `[dev] chore: scaffold plugin manifests and CI`

### Task 2: `lib/agy.mjs` — binary resolution, models, aliases, effort validation

**Files:**
- Create: `plugins/agy/scripts/lib/agy.mjs`
- Test: `tests/agy.test.mjs`

**Interfaces:**
- Produces:
  - `resolveAgyBinary(env = process.env): string | null` — `env.AGY_BIN` → PATH lookup (`agy` / `agy.exe`) → `~/.local/bin/agy`; null if none.
  - `parseModelsOutput(text: string): Array<{id: string, base: string, effort: string, label: string}>` — parses `agy models` lines `<id>\t<label>`; base = id with trailing `-(low|medium|high|xhigh|max)` removed.
  - `resolveModel(spec: {model?: string, effort?: string, purpose: "review"|"task"|"gate"}, catalog: ReturnType<typeof parseModelsOutput>): {model: string, effort: string}` — applies alias table + purpose defaults; throws `AgyError("unsupported effort ...")` if `{base, effort}` not in catalog; throws `AgyError("unknown model ...")` if base not in catalog.
  - `listModels(bin): Promise<catalog>` — runs `agy models`, parses.
  - `checkVersion(bin): Promise<{version: string, ok: boolean}>` — `agy --version`, ok if ≥ `1.4.12`.
  - `class AgyError extends Error { code: string }`.

- [ ] **Step 1: Write failing tests**: `parseModelsOutput` on fixture string (3 lines incl. `gpt-oss-120b-medium`); `resolveModel({purpose:"review"})` → `{model:"gemini-4-argon", effort:"high"}`; `resolveModel({model:"opus", effort:"low", purpose:"task"})` → `claude-opus-5-5/low`; `resolveModel({model:"gpt-oss", effort:"high"})` throws `/unsupported effort/`; `resolveModel({model:"nope"})` throws `/unknown model/`; `resolveAgyBinary({AGY_BIN:"/x/agy", PATH:""})` → `/x/agy`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** per signatures. Version compare: split on `.`, numeric.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `[dev] feat: agy binary/model resolution`

### Task 3: `lib/process.mjs` + `lib/stream.mjs` — spawn agy, parse stream-json

**Files:**
- Create: `plugins/agy/scripts/lib/process.mjs`, `plugins/agy/scripts/lib/stream.mjs`
- Test: `tests/stream.test.mjs`, `tests/process.test.mjs`
- Fixture: `tests/fixtures/stream-sample.ndjson` (move `docs/superpowers/plans/.agy-stream-sample.ndjson.tmp` here)
- Fixture: `tests/fixtures/fake-agy.mjs` — fake binary: echoes args as JSON to a file given by `FAKE_AGY_ARGS_FILE`, then prints the sample ndjson.

**Interfaces:**
- Produces:
  - `buildAgyArgs({model, effort, mode, outputFormat="stream-json", conversationId, addDirs=[], jsonSchemaPath, prompt}): string[]` — order: `--model m --effort e --mode mode [--conversation id] [--add-dir d]* [--json-schema path] --output-format fmt -p <prompt>`.
  - `spawnAgy({bin, args, cwd, logPath, detached: boolean}): {child, pid}` — stdout+stderr → logPath fd (append), `windowsHide:true`, `detached` → `child.unref()`.
  - `runAgy({bin, args, cwd, timeoutMs}): Promise<{code, stdout, stderr}>` — foreground, collects output.
  - `parseStreamLine(line): {event:"init"|"step_update"|"result"|"unknown", payload}`.
  - `summarizeStream(text): {conversationId, model, status, response, phase, lastTool, usage}` — phase = `"starting"` until init, `"thinking"` on agent_response ACTIVE, `"tool:<tool_name>"` on tool ACTIVE, `"done"|"failed"` on result status.

- [ ] **Step 1: Write failing tests**: `buildAgyArgs` ordering and that prompt is last element verbatim (`'say "hi" $x\n`'`); `summarizeStream(fixture)` → conversationId `9d6dec87-...`, model `gemini-3.8-flash`, status `SUCCESS`, phase `done`, lastTool `write_file`; `runAgy` with fake binary returns code 0 and args file shows prompt intact.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** Fake binary invoked as `node tests/fixtures/fake-agy.mjs`; `spawnAgy` must accept `bin` being a `{cmd, prefixArgs}` or plain string — use plain string plus env `AGY_BIN` pointing to a `.mjs` → when `bin.endsWith(".mjs")` spawn `process.execPath` with `[bin, ...args]` (test-only convenience, documented).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `[dev] feat: agy process spawn and stream-json parsing`

### Task 4: `lib/state.mjs` + `lib/jobs.mjs` — state dir, job records, liveness

**Files:**
- Create: `plugins/agy/scripts/lib/state.mjs`, `plugins/agy/scripts/lib/jobs.mjs`
- Test: `tests/state.test.mjs`, `tests/jobs.test.mjs`

**Interfaces:**
- Produces:
  - `resolveStateDir(cwd, env): string` — slug = basename sanitized `[a-z0-9-]`, hash8 = sha1(realpath) first 8.
  - `loadState(cwd): State` / `saveState(cwd, state)` / `updateState(cwd, fn)` — `State = {version:1, config:{stopReviewGate:boolean}, session:{id?:string, consecutiveBlocks:number}, jobs: Record<string, Job>}`.
  - `Job = {id, kind:"review"|"adversarial-review"|"task"|"transfer"|"gate", status:"running"|"completed"|"failed"|"cancelled", phase, model, effort, mode, cwd, pid, conversationId?, claudeSessionId?, logPath, resultPath, createdAt, updatedAt, finishedAt?, summary?, exitCode?}`.
  - `createJob(cwd, partial): Job` — id `job-<yyyymmdd>-<6 base36>`.
  - `reconcileJobs(cwd, {isAlive = defaultIsAlive}): State` — for each running job: parse its log with `summarizeStream`; if result event → completed/failed + summary; else if `!isAlive(pid)` → failed, summary `"process exited without result"`.
  - `defaultIsAlive(pid): boolean` — `process.kill(pid, 0)` try/catch (EPERM → true).
  - `killJob(job): Promise<void>` — POSIX SIGTERM then SIGKILL after 3s; Windows `taskkill /PID /T /F` via spawn.
  - `findResumableJob(state, {kind:"task", claudeSessionId}): Job | null` — latest completed task with conversationId; prefer same session; flag `crossSession: true` when falling back.

- [ ] **Step 1: Write failing tests** (use `CLAUDE_PLUGIN_DATA` pointed at tmpdir): state roundtrip; `createJob` id format; `reconcileJobs` with a running job whose log is the fixture → `completed` + conversationId; running job with empty log and `isAlive:()=>false` → `failed`; `findResumableJob` prefers same session and flags cross-session.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** Writes atomic (`tmp` + `renameSync`).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `[dev] feat: job state and reconciliation`

### Task 5: `lib/git.mjs` + `lib/prompts.mjs` + prompt files + schema

**Files:**
- Create: `plugins/agy/scripts/lib/git.mjs`, `plugins/agy/scripts/lib/prompts.mjs`, `plugins/agy/prompts/review.md`, `plugins/agy/prompts/adversarial-review.md`, `plugins/agy/prompts/stop-review-gate.md`, `plugins/agy/prompts/transfer.md`, `plugins/agy/schemas/review-findings.schema.json`, `plugins/agy/schemas/gate-decision.schema.json`
- Test: `tests/git.test.mjs`, `tests/prompts.test.mjs`

**Interfaces:**
- Produces:
  - `collectDiff(cwd, {base?: string, staged?: boolean, paths?: string[]}): {text, truncated, files: string[], label}` — `git diff [base] [--staged] -- paths` plus untracked via `git ls-files --others --exclude-standard` rendered as `git diff --no-index /dev/null <f>` (use `NUL` on win32); cap 200_000 chars → truncated true + footer `[truncated N chars]`.
  - `renderPrompt(name, vars: Record<string,string>): string` — reads `prompts/<name>.md`, replaces `{{KEY}}`; throws on unknown placeholder left.
  - Schema: findings `{verdict:"approve"|"needs-attention", summary, findings:[{file,line_start,line_end,severity:"high"|"medium"|"low",confidence:number,title,detail,recommendation}]}`; gate `{decision:"ALLOW"|"BLOCK", reason}`.
  - Prompt files: own wording (not copied) covering: role, target label, user focus, review method, finding bar, JSON-only output. Adversarial adds skeptic stance + attack surface list. Gate prompt: only judge previous turn's code edits, ALLOW if none.

- [ ] **Step 1: Write failing tests**: `collectDiff` in a temp git repo with one modified + one untracked file → both names in `files`, text contains both; cap test with 250k-char file → `truncated === true`; `renderPrompt("review", {...})` has no `{{` left; schema files parse and have `required` arrays.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `[dev] feat: diff collection, prompts and schemas`

### Task 6: `agy-companion.mjs` CLI — setup, review, task, status, result, cancel

**Files:**
- Create: `plugins/agy/scripts/agy-companion.mjs`, `plugins/agy/scripts/lib/args.mjs`, `plugins/agy/scripts/lib/render.mjs`, `plugins/agy/scripts/lib/commands/{setup,review,task,status,result,cancel}.mjs`
- Test: `tests/cli.test.mjs` (runs CLI with `AGY_BIN=tests/fixtures/fake-agy.mjs`, `CLAUDE_PLUGIN_DATA=tmp`)

**Interfaces:**
- Consumes: Tasks 2–5.
- Produces CLI:
  - `setup [--json] [--enable-review-gate|--disable-review-gate]` → `{ready, agy:{bin,version,ok}, auth:{loggedIn, detail}, models: catalog.length, config:{stopReviewGate}}`. Auth check = `agy models` exit 0 and ≥1 line.
  - `review [--adversarial] [--base ref] [--staged] [--model m] [--effort e] [--focus text] [--json] [paths...]` → foreground; empty diff → print `No changes to review.` exit 0 without spawning; else job kind review, `--mode plan`, `--json-schema schemas/review-findings.schema.json`; parse `result.response` as JSON (retry once with "Return only JSON" appended on parse failure; then fall back to `{verdict:"needs-attention", summary:"[unstructured] ...", findings:[]}`); render markdown table (file:line, severity, confidence, title) + summary.
  - `task [--background] [--wait] [--write] [--resume|--fresh] [--model m] [--effort e] [--add-dir d]* [--json] <prompt...>` → mode `accept-edits` if `--write` else `plan`; `--resume` → `findResumableJob` + `--conversation`; background: spawn detached, print `Started job <id>. Check /agy:status.`; wait: spawn, poll log every 1s until result or exit, print response.
  - `status [job-id] [--all] [--json]` → `reconcileJobs`; table: id | kind | status | phase | model/effort | elapsed | summary(60 chars).
  - `result <job-id>` → full response text from resultPath, or "still running".
  - `cancel <job-id>` → `killJob`, status cancelled.
  - Every command: on `resolveAgyBinary() === null` print `agy CLI not found. Run /agy:setup.` exit 2.
  - `--json` output is one JSON document on stdout; human output otherwise.

- [ ] **Step 1: Write failing tests**: `setup --json` with fake binary → `ready:true`; `review --json` in temp repo with empty diff → `{verdict:"approve", note:"no-diff"}` and fake args file absent; `review --json` with a change → fake invoked with `--mode plan` and `--json-schema`; `task --background hello` → status shows one job; `status --json` after log has result → completed; `cancel` on completed → message "not running".
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** `args.mjs` (tiny parser: `--k v`, `--flag`, repeatable `--add-dir`, rest = positional), `render.mjs` (table, no emoji), commands.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `[dev] feat: companion CLI core commands`

### Task 7: transfer + gate commands + hook scripts

**Files:**
- Create: `plugins/agy/scripts/lib/transfer.mjs`, `plugins/agy/scripts/lib/commands/{transfer,gate}.mjs`, `plugins/agy/scripts/session-lifecycle-hook.mjs`, `plugins/agy/scripts/stop-review-gate-hook.mjs`, `plugins/agy/hooks/hooks.json`
- Test: `tests/transfer.test.mjs`, `tests/gate.test.mjs`
- Fixture: `tests/fixtures/transcript-sample.jsonl` (hand-written: 2 user, 2 assistant text, 1 tool_use, 1 tool_result, 1 system-reminder in text)

**Interfaces:**
- Produces:
  - `extractHandoff(jsonlText, {budgetChars=80_000}): {messages:[{role, text}], dropped: number}` — keeps only text content of `user`/`assistant`; strips `<system-reminder>…</system-reminder>` blocks; newest-first fill until budget, then chronological.
  - `resolveTranscriptPath({cwd, env}): string|null` — `env.AGY_CLAUDE_TRANSCRIPT_PATH` else newest `*.jsonl` in `~/.claude/projects/<encoded cwd>/` (encode = replace `[^A-Za-z0-9]` with `-`).
  - `transfer [--dry-run] [--model m] [--effort e] [--json] [instruction...]` → builds prompt from `prompts/transfer.md` + handoff; `--dry-run` prints size and message count only; otherwise `task --background` (fresh conversation).
  - `gate` (stdin = hook JSON) → if `config.stopReviewGate` false → print nothing, exit 0; if `stop_hook_active` true → exit 0; collect diff; if empty → ALLOW; run agy Flash low with gate prompt + `--json-schema gate-decision`; timeout 300s; any error → ALLOW + log `[gate-degraded]`; BLOCK → `{"decision":"block","reason"}` on stdout; consecutiveBlocks ≥ 2 → force ALLOW with reason `[gate-limit]`.
  - `session-lifecycle-hook.mjs SessionStart|SessionEnd` — SessionStart: write `session.id` to state, append `AGY_CLAUDE_SESSION_ID=` and `AGY_CLAUDE_TRANSCRIPT_PATH=` to `$CLAUDE_ENV_FILE` if set; SessionEnd: mark running jobs `orphaned: true` (not killed).
  - `hooks.json`: SessionStart/SessionEnd timeout 5, Stop timeout 320.

- [ ] **Step 1: Write failing tests**: `extractHandoff(fixture)` → 4 messages, no `tool_use`, no `system-reminder`; budget 50 chars → dropped > 0; gate with `stopReviewGate:false` → stdout empty exit 0; gate with fake binary returning `{"decision":"BLOCK","reason":"x"}` → stdout JSON decision block; third consecutive BLOCK → no block output + state consecutiveBlocks reset.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** Fake agy needs a mode: `FAKE_AGY_RESPONSE` env overrides the result response text.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `[dev] feat: transfer, stop review gate, lifecycle hooks`

### Task 8: Commands, agent, skills (the Claude-facing layer)

**Files:**
- Create: `plugins/agy/commands/{setup,review,adversarial-review,rescue,status,result,cancel,transfer}.md`, `plugins/agy/agents/agy-rescue.md`, `plugins/agy/skills/agy-cli-runtime/SKILL.md`, `plugins/agy/skills/agy-result-handling/SKILL.md`
- Test: `tests/commands.test.mjs`

**Interfaces:**
- Consumes: CLI from Tasks 6–7.
- Produces: frontmatter per spec §4.6; every command invokes `node "${CLAUDE_PLUGIN_ROOT}/scripts/agy-companion.mjs" <sub> ...` (quoted). `rescue.md`: parse `--background|--wait|--write|--resume|--fresh|--model|--effort`, dispatch `agy:agy-rescue` subagent via Agent tool with raw request; agent runs `task` and returns result. `transfer.md`: run `transfer --dry-run`, then `AskUserQuestion` (Send / Cancel), then `transfer`. `status.md`/`result.md`/`cancel.md`: `!`-embedded CLI call, render per CLI output.

- [ ] **Step 1: Write failing test**: for each of 8 commands file exists; frontmatter `disable-model-invocation: true` exactly on the 6 user-only ones and absent on setup/rescue; every `.md` referencing the CLI uses the quoted `"${CLAUDE_PLUGIN_ROOT}"`; agent frontmatter has `name: agy-rescue`, `tools: Bash`, `model: sonnet`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Write files.** Keep each command ≤ 40 lines; skills describe flags, defaults table, "never skip-permissions", result rendering rules.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `[dev] feat: commands, rescue agent, skills`

### Task 9: Live smoke (real agy), README, version, release

**Files:**
- Modify: `README.md`, `CHANGELOG.md`, `plugins/agy/.claude-plugin/plugin.json` (0.1.0), `.claude-plugin/marketplace.json`

- [ ] **Step 1:** `node plugins/agy/scripts/agy-companion.mjs setup --json` with real agy → `ready:true`.
- [ ] **Step 2:** In a temp git repo with a deliberate bug diff: `review --json` → ≥1 finding; `review` (human) renders table.
- [ ] **Step 3:** `task --background "explain what git rebase does in 3 lines"` → `status` running → within 60s `status` completed → `result <id>` prints text.
- [ ] **Step 4:** `task --write --wait "create hello.txt containing hi"` in temp dir → file exists.
- [ ] **Step 5:** `task --background` then `cancel <id>` → status cancelled, pid gone.
- [ ] **Step 6:** README: install, commands table, model/effort table, aliases, gate warning, Windows note. CHANGELOG 0.1.0 dated.
- [ ] **Step 7:** `npm test` green. Commit `[dev] docs: README and 0.1.0 release notes`. Push branch, open PR, merge to main, tag `v0.1.0`.
- [ ] **Step 8:** Install globally: `claude plugin marketplace add Yeimaoz/agy-plugin-cc && claude plugin install agy@agy-plugin-cc`; `claude plugin list` shows `agy` enabled; record install in agent-config `registry/vendors.json` if schema fits (else README note).
