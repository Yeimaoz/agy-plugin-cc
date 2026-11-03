// Parse agy --output-format stream-json (NDJSON) output.

export function parseStreamLine(line) {
  const trimmed = String(line).trim();
  if (!trimmed) return { event: "unknown", payload: null };
  let obj;
  try {
    obj = JSON.parse(trimmed);
  } catch {
    return { event: "unknown", payload: trimmed };
  }
  const event = obj && typeof obj.event === "string" ? obj.event : "unknown";
  if (event === "init" || event === "step_update" || event === "result") return { event, payload: obj };
  return { event: "unknown", payload: obj };
}

export const NO_OUTPUT_MESSAGE = "agy produced no output: a tool needed a permission that headless mode cannot prompt for and was auto-denied (likely a shell command). Rephrase the task to avoid shell commands, or run it with --write for file edits.";

export function summarizeStream(text) {
  const summary = {
    conversationId: null,
    model: null,
    status: null,
    response: "",
    phase: "starting",
    lastTool: null,
    usage: null,
    durationSeconds: null,
    numTurns: null,
    noOutput: false,
    denied: false,
  };
  if (/no output produced|auto-denied|cannot prompt for/i.test(String(text))) summary.denied = true;
  for (const line of String(text).split(/\r?\n/)) {
    const { event, payload } = parseStreamLine(line);
    if (event === "init") {
      summary.conversationId = payload.conversation_id || summary.conversationId;
      summary.model = payload.init?.model || summary.model;
      summary.phase = "thinking";
    } else if (event === "step_update") {
      const step = payload.step_update || {};
      if (!summary.conversationId && step.conversation_id) summary.conversationId = step.conversation_id;
      if (step.step_type === "tool") {
        const tool = step.tool_name || step.tool_info?.name || "tool";
        summary.lastTool = tool;
        summary.phase = step.state === "ACTIVE" ? `tool:${tool}` : "thinking";
      } else if (step.step_type === "agent_response") {
        summary.phase = "thinking";
      }
    } else if (event === "result") {
      const r = payload.result || {};
      summary.conversationId = r.conversation_id || summary.conversationId;
      summary.status = r.status || "UNKNOWN";
      summary.response = typeof r.response === "string" ? r.response : "";
      summary.usage = r.usage || null;
      summary.durationSeconds = r.duration_seconds ?? null;
      summary.numTurns = r.num_turns ?? null;
      summary.noOutput = summary.status === "SUCCESS" && summary.response.trim() === "";
      summary.phase = summary.status === "SUCCESS" && !summary.noOutput ? "done" : "failed";
    }
  }
  return summary;
}
