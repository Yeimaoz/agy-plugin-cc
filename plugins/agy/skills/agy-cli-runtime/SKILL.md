---
name: agy-cli-runtime
description: How the agy plugin invokes the Antigravity CLI headlessly through agy-companion.mjs; flags, model aliases, defaults and hard rules. Load before calling the companion script.
---

# agy companion runtime

Entry point: `node "${CLAUDE_PLUGIN_ROOT}/scripts/agy-companion.mjs" <command> [flags] [args]`

## Commands

| command | purpose | runs agy as |
|---|---|---|
| `setup [--enable-review-gate\|--disable-review-gate]` | binary, sign-in, model catalog, gate flag | `agy --version`, `agy models` |
| `review [--adversarial] [--base ref] [--staged] [--focus t] [paths]` | structured findings for a diff | `--mode plan` + findings JSON schema |
| `task [--background\|--wait] [--write] [--resume\|--fresh] [--add-dir d] --prompt-stdin` | delegate work (prompt on stdin) | `--mode plan`, or `--mode accept-edits` with `--write` |
| `status [id] [--wait] [--all]`, `result <id>`, `cancel <id>` | job management | none |
| `transfer [--dry-run] [instruction]` | hand over the Claude transcript | background task |
| `gate` | Stop-hook review gate (stdin JSON) | Flash low + decision schema |

Add `--json` to any command for machine-readable output.

## Models and effort

Selection is `--model <base> --effort <level>`; effort levels are `low|medium|high|xhigh|max`. Unsupported combinations error out; nothing is downgraded silently.

| alias | model | notes |
|---|---|---|
| `argon` | `gemini-4-argon` | default for review (high) and task (medium) |
| `flash` | `gemini-3.8-flash` | default for the review gate (low); fastest |
| `opus` | `claude-opus-5-5` | strongest second opinion |
| `sonnet` | `claude-sonnet-5-5` | |
| `gpt-oss` | `gpt-oss-120b` | medium only |

Run `agy models` to see the live catalog.

## Hard rules

- Never pass `--dangerously-skip-permissions`. Headless writes work with `--mode accept-edits`; read-only work uses `--mode plan`.
- Prompts and focus text go over stdin, never argv: use `--prompt-stdin` / `--focus-stdin` with a single-quoted heredoc (`<<'AGY_PROMPT'`). This keeps `$`, backticks and quotes intact and avoids the OS command-line length limits (Windows 32K chars). The companion itself also feeds agy over stdin for the same reason.
- Background jobs are detached processes; they survive the Bash call. Track them with `status`, fetch with `result`, stop with `cancel`.
- `--resume` reuses the most recent task conversation from this Claude session (falls back to this workspace, flagged `[cross-session]`).
- If the companion prints `agy CLI not found` or a sign-in error, stop and tell the user to run `/agy:setup`.
