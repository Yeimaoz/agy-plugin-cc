---
description: Delegate an investigation, fix or long task to the Antigravity (agy) rescue subagent, picking the model
argument-hint: '[--background|--wait] [--write] [--resume|--fresh] [--model <alias|id>] [--effort <level>] [what agy should investigate or do]'
allowed-tools: Agent, AskUserQuestion
---

Invoke the `agy:agy-rescue` subagent via the `Agent` tool (`subagent_type: "agy:agy-rescue"`), forwarding the raw user request as the prompt.

Raw arguments: `$ARGUMENTS`

Rules:
- `--background` runs the subagent in the background; `--wait` runs it in the foreground. If neither is given, use foreground for a small bounded request and background for anything open-ended or long.
- `--background` and `--wait` are Claude Code execution flags. Do not forward them to the subagent.
- `--model`, `--effort`, `--write`, `--resume`, `--fresh` are runtime controls: forward them verbatim, do not treat them as task text.
- If the user asks to fix, implement, apply or change something, include `--write`; for diagnosis, research or review-like asks leave it out (read-only plan mode).
- Without `--resume` or `--fresh`, do not ask about continuing. The subagent decides from the request wording.
- If the user supplied no request, ask what agy should investigate or do.
- Return the subagent's output verbatim. For background runs, tell the user to check `/agy:status`.
