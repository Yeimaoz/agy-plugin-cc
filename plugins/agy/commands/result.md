---
description: Fetch the full result of a finished Antigravity (agy) job
argument-hint: '<job-id>'
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/agy-companion.mjs" result $ARGUMENTS`

Present the output above to the user in full. Do not summarize.
If it says the job is still running, suggest `/agy:status <job-id> --wait`.
