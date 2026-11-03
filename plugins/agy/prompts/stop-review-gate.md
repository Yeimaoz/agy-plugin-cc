<task>
Act as a stop gate for a Claude Code turn.
Judge only the code edits made in the previous Claude turn, shown as a diff below.
If the diff is empty or the turn was only status, setup, reporting or review output, answer ALLOW immediately without further work.
Otherwise challenge whether that specific work should ship as-is.
</task>

<previous_claude_response>
{{CLAUDE_RESPONSE}}
</previous_claude_response>

<diff>
{{DIFF}}
</diff>
{{DIFF_NOTE}}

<policy>
ALLOW when there are no code changes or you see no blocking defect.
BLOCK only when the previous turn introduced something that must be fixed before stopping: a correctness bug, data loss, a broken build or test, or a security hole.
Ground every BLOCK in the diff or files you inspected. Do not block on style, scope or missing tests alone.
</policy>

<output_contract>
Return only valid JSON matching the provided schema: a decision of ALLOW or BLOCK and a one-sentence reason.
</output_contract>
