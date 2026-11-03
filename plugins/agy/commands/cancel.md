---
description: Cancel a running Antigravity (agy) job
argument-hint: '<job-id>'
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/agy-companion.mjs" cancel $ARGUMENTS`

Present the output above to the user as-is.
