---
description: Run an adversarial Antigravity (agy) review that tries to break the change rather than validate it
argument-hint: '[--base <ref>] [--staged] [--model <alias|id>] [--effort <level>] [--focus <text>] [paths...]'
disable-model-invocation: true
allowed-tools: Bash(node:*), Bash(git:*)
---

Run an adversarial agy review. Review-only: never fix anything here.

Raw arguments: `$ARGUMENTS`

Run exactly one Bash call. Put any `--focus` text in a single-quoted heredoc with `--focus-stdin` so the shell cannot expand it:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/agy-companion.mjs" review --adversarial <flags and paths without --focus> --focus-stdin <<'AGY_FOCUS'
<focus text verbatim>
AGY_FOCUS
```

Without `--focus`, it is simply `node "${CLAUDE_PLUGIN_ROOT}/scripts/agy-companion.mjs" review --adversarial <arguments>`.

- Pass the user's other arguments through unchanged. The focus text tells the reviewer what to weight most.
- Default model is Gemini 4 Argon at high effort.
- For large diffs run the Bash call with `run_in_background: true` and say so.
- Return the output verbatim, including the ship/no-ship summary.
- If agy is missing or not signed in, tell the user to run `/agy:setup`.
