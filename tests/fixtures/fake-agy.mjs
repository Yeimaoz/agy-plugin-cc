// Fake agy binary for tests. Records argv to FAKE_AGY_ARGS_FILE, prints a stream-json
// sample (or FAKE_AGY_RESPONSE as the result response), exits FAKE_AGY_EXIT (default 0).
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
if (!args.includes("-p") && args[0] !== "models" && args[0] !== "--version") {
  let stdin = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) stdin += chunk;
  args.push(`STDIN:${stdin}`);
}
if (process.env.FAKE_AGY_ARGS_FILE) writeFileSync(process.env.FAKE_AGY_ARGS_FILE, JSON.stringify(args));

if (args[0] === "models") {
  process.stdout.write(["gemini-4-argon-medium\tGemini 4 Argon (Medium)", "gemini-4-argon-high\tGemini 4 Argon (High)", "gemini-3.8-flash-low\tGemini 3.8 Flash (Low)", "claude-opus-5-5-low\tClaude Opus 5.5 (Low)", ""].join("\n"));
  process.exit(0);
}
if (args[0] === "--version") { process.stdout.write("1.4.12\n"); process.exit(0); }

const here = path.dirname(fileURLToPath(import.meta.url));
let out = readFileSync(path.join(here, "stream-sample.ndjson"), "utf8");
if (process.env.FAKE_AGY_RESPONSE !== undefined) {
  out = out.split("\n").map((line) => {
    if (!line.includes('"event":"result"')) return line;
    const e = JSON.parse(line);
    e.result.response = process.env.FAKE_AGY_RESPONSE;
    return JSON.stringify(e);
  }).join("\n");
}
if (process.env.FAKE_AGY_DELAY_MS) await new Promise((r) => setTimeout(r, Number(process.env.FAKE_AGY_DELAY_MS)));
process.stdout.write(out);
process.exit(Number(process.env.FAKE_AGY_EXIT || 0));
