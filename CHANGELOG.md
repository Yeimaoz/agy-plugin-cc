# Changelog

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
