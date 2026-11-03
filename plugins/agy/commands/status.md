---
description: Show active and recent Antigravity (agy) jobs for this workspace, including review-gate status
argument-hint: '[job-id] [--wait] [--timeout-ms <ms>] [--all]'
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/agy-companion.mjs" status $ARGUMENTS`

If the user did not pass a job id, present the table above compactly and nothing else.
If the user passed a job id, present the full output without condensing it.
Jobs marked `[cross-session]` resumed a conversation started in another Claude session.
