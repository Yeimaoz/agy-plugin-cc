#!/usr/bin/env node
// agy companion: single entry point used by the Claude Code commands, agent and hooks.
import { parseArgs } from "./lib/args.mjs";
import { makeContext, UsageError } from "./lib/context.mjs";
import { runSetup } from "./lib/commands/setup.mjs";
import { runReview } from "./lib/commands/review.mjs";
import { runTask } from "./lib/commands/task.mjs";
import { runCancel, runResult, runStatus } from "./lib/commands/jobs.mjs";

const USAGE = `agy-companion <command> [options]

  setup [--json] [--enable-review-gate|--disable-review-gate]
  review [--adversarial] [--base <ref>] [--staged] [--model <m>] [--effort <e>] [--focus <text>] [--json] [paths...]
  task [--background|--wait] [--write] [--resume|--fresh] [--model <m>] [--effort <e>] [--add-dir <d>]... [--json] <prompt...>
  status [job-id] [--wait] [--timeout-ms <ms>] [--all] [--json]
  result <job-id> [--json]
  cancel <job-id> [--json]
  transfer [--dry-run] [--model <m>] [--effort <e>] [--source <jsonl>] [--json] [instruction...]
  gate            (reads Claude Stop hook JSON on stdin)
`;

const COMMANDS = {
  setup: runSetup,
  review: runReview,
  task: runTask,
  status: runStatus,
  result: runResult,
  cancel: runCancel,
};

async function loadOptional(name) {
  try {
    const mod = await import(`./lib/commands/${name}.mjs`);
    return mod[`run${name[0].toUpperCase()}${name.slice(1)}`];
  } catch (err) {
    if (err && err.code === "ERR_MODULE_NOT_FOUND") return null;
    throw err;
  }
}

async function main(argv) {
  const [command, ...rest] = argv;
  if (!command || command === "--help" || command === "-h" || command === "help") {
    process.stdout.write(USAGE);
    return 0;
  }
  const { flags, positional } = parseArgs(rest);
  const handler = COMMANDS[command] || (await loadOptional(command));
  if (!handler) {
    process.stderr.write(`Unknown command "${command}".\n${USAGE}`);
    return 2;
  }
  const ctx = makeContext({ flags });
  return handler(ctx, { flags, positional });
}

process.stdout.setDefaultEncoding?.("utf8");
main(process.argv.slice(2)).then(
  (code) => { process.exitCode = typeof code === "number" ? code : 0; },
  (err) => {
    if (err instanceof UsageError) {
      process.stderr.write(`${err.message}\n`);
      process.exitCode = err.exitCode;
      return;
    }
    process.stderr.write(`agy-companion error: ${err && err.stack ? err.stack : err}\n`);
    process.exitCode = 1;
  },
);
