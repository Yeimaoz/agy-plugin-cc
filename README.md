# agy-plugin-cc

Use Google Antigravity CLI (`agy`) from Claude Code: multi-model code review, rescue and task delegation.
Command-for-command parity with [openai/codex-plugin-cc](https://github.com/openai/codex-plugin-cc), plus real model choice:
Gemini 4 Argon, Gemini 3.8 Flash, Claude Opus 5.5, Claude Sonnet 5.5 and GPT-OSS 120B, each at several reasoning efforts.

Zero npm dependencies. Node >= 18.18. Works on macOS, Linux/WSL and Windows.

## Install

Inside Claude Code:

```
/plugin marketplace add Yeimaoz/agy-plugin-cc
/plugin install agy@agy-plugin-cc
/agy:setup
```

Or from a terminal: `claude plugin marketplace add Yeimaoz/agy-plugin-cc && claude plugin install agy@agy-plugin-cc`.
Restart Claude Code after installing so the `/agy:*` commands and the rescue subagent are registered.

Requirements:

- The Antigravity CLI installed and signed in. macOS/Linux: `curl -fsSL https://antigravity.google/cli/install.sh | bash`; Windows: the `install.ps1` from https://antigravity.google/cli/. Run `agy` once to sign in with your Google account.
- `agy` on `PATH`, or `AGY_BIN=/path/to/agy` in the environment.

## Commands

| command | what it does | who can trigger it |
|---|---|---|
| `/agy:setup [--enable-review-gate\|--disable-review-gate]` | check agy, sign-in and model catalog; toggle the stop-time review gate | you or Claude |
| `/agy:review [--base ref] [--staged] [--model m] [--effort e] [--focus text] [paths]` | structured code review of the working tree (or a base/staged range) | you |
| `/agy:adversarial-review ...` | same, but the reviewer tries to break the change | you |
| `/agy:rescue [--background\|--wait] [--write] [--resume\|--fresh] [--model m] [--effort e] <task>` | hand a diagnosis, fix or long task to agy through the `agy:agy-rescue` subagent | you or Claude |
| `/agy:status [job-id] [--wait] [--all]` | table of running and recent jobs, or one job in detail | you |
| `/agy:result <job-id>` | full response of a finished job | you |
| `/agy:cancel <job-id>` | kill a running job | you |
| `/agy:transfer [--model m] [--effort e] [--write] [instruction]` | hand the current Claude conversation to agy to continue (asks for confirmation first) | you |

"you" means the command has `disable-model-invocation: true`: Claude will not run it on its own.
Claude may proactively use the `agy:agy-rescue` subagent when it is stuck or wants a second opinion from another model.

## Models and effort

Pick with `--model <alias|id>` and `--effort <low|medium|high|xhigh|max>`. Unsupported combinations are rejected, never silently downgraded.

| alias | model | default for |
|---|---|---|
| `argon` | `gemini-4-argon` | review (high), rescue/transfer (medium) |
| `flash` | `gemini-3.8-flash` | review gate (low) |
| `opus` | `claude-opus-5-5` | |
| `sonnet` | `claude-sonnet-5-5` | |
| `gpt-oss` | `gpt-oss-120b` | (medium only) |

`agy models` lists what your account can use.

## Safety model

- The plugin never passes `--dangerously-skip-permissions`. Reviews and plain rescues run in agy `--mode plan` (read-only); `--write` switches to `--mode accept-edits`, which is enough for headless file edits.
- Prompts, diffs and transcripts are sent to agy over stdin, never on the command line, so shell metacharacters stay intact and Windows' 32K command-line limit does not apply. Claude is told to pass task text through a single-quoted heredoc with `--prompt-stdin`.
- A headless agy run that tries a shell command is auto-denied by agy and returns an empty response. The plugin detects that, marks the job `failed` with an explanation, and the review prompts tell the model not to run shell commands.
- `/agy:transfer` shows a preview and asks before sending your conversation to a non-Claude model.
- Background jobs are detached processes. Closing Claude Code does not kill them; `/agy:status` keeps tracking them.

## Review gate (optional, off by default)

`/agy:setup --enable-review-gate` adds a Stop hook: every time Claude wants to stop after editing code, Gemini 3.8 Flash reviews the diff and may block the stop with a reason. Limits: 300 s timeout, fail-open on any error (logged as `[gate-degraded]`), and at most two consecutive blocks per session. It costs one Flash call per stop; disable with `--disable-review-gate`.

## Where state lives

Per workspace under `$CLAUDE_PLUGIN_DATA/state/<slug>-<hash>/` (falls back to the OS temp dir): `state.json` plus `jobs/<id>.log` (raw agy stream-json) and `jobs/<id>.result.txt`.

## Development

```
npm test              # node --test, mocks agy; no sign-in needed
```

Design and plan: `docs/superpowers/specs/` and `docs/superpowers/plans/`. Live checks (real agy) are described in the plan's Task 9.

## License

MIT
