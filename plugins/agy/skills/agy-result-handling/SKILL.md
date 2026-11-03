---
name: agy-result-handling
description: How to present agy review findings and task results to the user without distorting them. Load when rendering output from agy-companion.mjs.
---

# Presenting agy results

## Review output

- Lead with the verdict line (`approve` or `needs-attention`) and the one-line summary exactly as given.
- Keep the findings table and numbered details verbatim: file:lines, severity, confidence, title, detail, recommendation.
- Do not re-rank, merge, drop or soften findings. If you disagree with one, say so after the verbatim output, clearly marked as your own view.
- `[unstructured]` in the summary means the model did not return valid JSON; show the text and say the findings table is unavailable.
- `[diff was truncated before review]` means the review covered only the first 200k characters; say so.

## Task and transfer output

- Print the response text as-is, followed by the job line (`[job <id> <status>, <model>/<effort>]`).
- For background jobs, give the user the job id and the two follow-ups: `/agy:status <id>` and `/agy:result <id>`.
- `[cross-session]` means the conversation was resumed from a different Claude session; mention it once.

## Status output

- Render the table compactly, no extra prose, no emoji.
- `failed` with summary `process exited without result` means agy died or was killed externally; suggest rerunning or `/agy:status <id>` for the log path.
