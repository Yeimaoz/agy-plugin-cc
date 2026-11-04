---
description: Run a task through an interactive agy session in tmux (can run shell commands and answer permission prompts), driven by a background subagent
argument-hint: '[--model <alias|id>] [--effort <level>] [what agy should do, including shell steps]'
allowed-tools: Agent, AskUserQuestion
---

Invoke the `agy:agy-driver` subagent via the `Agent` tool (`subagent_type: "agy:agy-driver"`) with `run_in_background: true`, forwarding the raw user request as the prompt.

Raw arguments: `$ARGUMENTS`

Rules:
- Always run the subagent in the background; the interactive loop can take many minutes.
- `--model` and `--effort` are runtime controls: forward them verbatim, not as task text.
- Use this for tasks that need to execute shell commands (Python, tests) or answer prompts; for plain read/edit work prefer `/agy:rescue`.
- Requires `tmux`. If the driver reports `tmux not found`, tell the user to install it.
- If the user supplied no request, ask what agy should do.
- Tell the user the driver is running in the background; its final summary arrives when it finishes.
