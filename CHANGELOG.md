# Changelog

## 0.2.0 - 2026-11-04

- New `session` companion subcommand (`start|peek|send|stop|list`): runs `agy -i` in a tmux session so permission prompts stay answerable; `peek` classifies the screen (`permission|question|idle|working|gone`).
- New `agy:agy-driver` subagent and `/agy:drive` command to run a task in an interactive session with rule-based permission handling.
- Session jobs are reconciled by tmux session liveness instead of pid; `cancel` kills the tmux session.
- `AGY_TMUX_BIN` overrides the tmux binary (tests use a fake).

## 0.1.0 - 2026-11-04

Initial release. Feature parity with openai/codex-plugin-cc 1.0.6, driven by the Antigravity CLI (`agy` >= 1.4.12).

- Commands: `setup`, `review`, `adversarial-review`, `rescue`, `status`, `result`, `cancel`, `transfer`.
- `agy:agy-rescue` subagent for proactive delegation.
- Model and effort selection with aliases (`argon`, `flash`, `opus`, `sonnet`, `gpt-oss`); unsupported combinations error instead of downgrading.
- Detached background jobs with liveness reconciliation; `--resume` reuses the last conversation.
- Optional stop-time review gate (off by default; fail-open; two-strike limit).
- Headless permission denials (empty `SUCCESS` responses) are surfaced as failures instead of empty results.
- Never uses `--dangerously-skip-permissions`; writes go through `--mode accept-edits`.
- Prompts travel over stdin (`--prompt-stdin`, `--focus-stdin`); no argv length limits, no shell expansion.
- Cross-process state lock, NUL-separated git listings (non-ASCII file names), foreground jobs tracked by pid, `export`-ed quoted env file lines.
