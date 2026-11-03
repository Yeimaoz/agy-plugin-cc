// Human-readable rendering (no emoji). JSON output is handled by the commands.

export function elapsed(job) {
  const start = Date.parse(job.createdAt);
  const end = job.finishedAt ? Date.parse(job.finishedAt) : Date.now();
  const secs = Math.max(0, Math.round((end - start) / 1000));
  if (secs < 60) return `${secs}s`;
  const m = Math.floor(secs / 60);
  return `${m}m${String(secs % 60).padStart(2, "0")}s`;
}

export function truncate(text, max) {
  const s = String(text ?? "").replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max - 3)}...` : s;
}

export function table(headers, rows) {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i] ?? "").length)));
  const line = (cells) => `| ${cells.map((c, i) => String(c ?? "").padEnd(widths[i])).join(" | ")} |`;
  return [line(headers), `| ${widths.map((w) => "-".repeat(w)).join(" | ")} |`, ...rows.map(line)].join("\n");
}

export function renderJobs(jobs) {
  if (jobs.length === 0) return "No agy jobs recorded for this workspace.";
  const rows = jobs.map((j) => [j.id, j.kind, j.status, j.phase || "", `${j.model || "?"}/${j.effort || "?"}`, elapsed(j), truncate(j.summary || j.prompt || "", 60)]);
  return table(["job", "kind", "status", "phase", "model/effort", "elapsed", "summary"], rows);
}

export function renderJobDetail(job, resultText) {
  const lines = [
    `Job ${job.id} (${job.kind})`,
    `status: ${job.status}  phase: ${job.phase || ""}  model: ${job.model || "?"}/${job.effort || "?"}  mode: ${job.mode || "?"}`,
    `created: ${job.createdAt}  finished: ${job.finishedAt || "-"}  elapsed: ${elapsed(job)}`,
    `conversation: ${job.conversationId || "-"}  pid: ${job.pid || "-"}`,
    `log: ${job.logPath}`,
  ];
  if (job.summary) lines.push(`summary: ${job.summary}`);
  if (resultText) lines.push("", resultText.trimEnd());
  return lines.join("\n");
}

export function renderReview(result) {
  const lines = [`Verdict: ${result.verdict}  (${result.kind}, ${result.model}/${result.effort}, target: ${result.target})`];
  if (result.note) lines.push(`Note: ${result.note}`);
  lines.push("", result.summary || "");
  if (result.findings && result.findings.length) {
    lines.push("", table(
      ["#", "file:lines", "sev", "conf", "title"],
      result.findings.map((f, i) => [i + 1, `${f.file}:${f.line_start}-${f.line_end}`, f.severity, Number(f.confidence).toFixed(2), truncate(f.title, 60)]),
    ));
    result.findings.forEach((f, i) => {
      lines.push("", `${i + 1}. ${f.title} (${f.file}:${f.line_start}-${f.line_end})`, `   ${f.detail}`, `   Recommendation: ${f.recommendation}`);
    });
  } else if (result.verdict === "approve") {
    lines.push("", "No material findings.");
  }
  if (result.truncated) lines.push("", "[diff was truncated before review]");
  return lines.join("\n");
}

export function renderSetup(info) {
  const lines = [
    `agy plugin setup: ${info.ready ? "READY" : "NOT READY"}`,
    `agy binary: ${info.agy.bin || "not found"}${info.agy.version ? ` (version ${info.agy.version}${info.agy.ok ? "" : ", below minimum"})` : ""}`,
    `auth: ${info.auth.loggedIn ? "logged in" : "not logged in"} - ${info.auth.detail}`,
    `models available: ${info.models}`,
    `stop review gate: ${info.config.stopReviewGate ? "enabled" : "disabled"}`,
  ];
  if (!info.agy.bin) lines.push("", "Install the Antigravity CLI: https://antigravity.google/cli/ then rerun /agy:setup.");
  else if (!info.auth.loggedIn) lines.push("", "Run `agy` once in a terminal to sign in, then rerun /agy:setup.");
  return lines.join("\n");
}
