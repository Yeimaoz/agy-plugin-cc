---
description: Hand the current Claude session's context to Antigravity (agy) so it can continue the task
argument-hint: '[--model <alias|id>] [--effort <level>] [--write] [instruction for agy]'
disable-model-invocation: true
allowed-tools: Bash(node:*), AskUserQuestion
---

Raw arguments: `$ARGUMENTS`

1. Preview what would be sent:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/agy-companion.mjs" transfer --dry-run <flags> -- '<instruction text, single-quoted>'
```

Keep the instruction single-quoted (or omit it) so the shell does not expand it.

2. Show the preview (message count, size, instruction) and use `AskUserQuestion` exactly once with two options, first one `Send to agy (Recommended)`, second `Cancel`. Explain in one line that the condensed conversation leaves Claude and is sent to the selected model through Google Antigravity.

3. Only if the user chose to send, run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/agy-companion.mjs" transfer <flags> -- '<instruction text, single-quoted>'
```

Return the output verbatim and point the user to `/agy:status` and `/agy:result <job-id>`.
If the user cancelled, say nothing was sent.
