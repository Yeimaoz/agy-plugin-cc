---
description: Run an Antigravity (agy) code review against local git state and return the findings
argument-hint: '[--base <ref>] [--staged] [--model <alias|id>] [--effort <low|medium|high|xhigh|max>] [--focus <text>] [paths...]'
disable-model-invocation: true
allowed-tools: Bash(node:*), Bash(git:*)
---

Run an agy review. This command is review-only: do not fix anything, do not suggest you are about to edit.

Raw arguments: `$ARGUMENTS`

Run exactly one Bash call:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/agy-companion.mjs" review $ARGUMENTS
```

- Pass the user's arguments through unchanged. Do not add flags they did not ask for.
- Default model is Gemini 4 Argon at high effort; the user can pick another with `--model opus|sonnet|flash|argon|gpt-oss`.
- If the review is likely to take more than a minute (many files), run the Bash call with `run_in_background: true` and tell the user it is running.
- Return the command output to the user verbatim. Do not summarize or soften findings.
- If the output says agy is missing or not signed in, tell the user to run `/agy:setup`.
