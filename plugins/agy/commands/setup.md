---
description: Check whether the Antigravity CLI (agy) is installed and signed in, and optionally toggle the stop-time review gate
argument-hint: '[--enable-review-gate|--disable-review-gate]'
allowed-tools: Bash(node:*)
---

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/agy-companion.mjs" setup $ARGUMENTS
```

Present the command output to the user as-is.

- If agy is not installed, point the user at https://antigravity.google/cli/ (macOS/Linux: `curl -fsSL https://antigravity.google/cli/install.sh | bash`; Windows: the `install.ps1` from the same page). Do not install it yourself.
- If agy is installed but not signed in, tell the user to run `! agy` once in their terminal to complete Google sign-in, then rerun `/agy:setup`.
- If the output mentions the review gate being enabled, remind the user that every stop will spend a Gemini 3.8 Flash call and that at most two consecutive blocks are enforced.
