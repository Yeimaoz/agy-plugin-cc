// Tiny argv parser: --flag, --key value, repeatable keys, positionals.

const REPEATABLE = new Set(["add-dir"]);
const VALUED = new Set(["model", "effort", "base", "focus", "source", "timeout-ms", "lines", "add-dir", "instruction"]);

export function parseArgs(argv, { valued = VALUED, repeatable = REPEATABLE } = {}) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--") {
      positional.push(...argv.slice(i + 1));
      break;
    }
    if (!token.startsWith("--")) {
      positional.push(token);
      continue;
    }
    const eq = token.indexOf("=");
    const key = (eq === -1 ? token.slice(2) : token.slice(2, eq));
    let value;
    if (eq !== -1) {
      value = token.slice(eq + 1);
    } else if (valued.has(key) && i + 1 < argv.length) {
      value = argv[i + 1];
      i += 1;
    } else {
      value = true;
    }
    if (repeatable.has(key)) {
      (flags[key] ||= []).push(value);
    } else {
      flags[key] = value;
    }
  }
  return { flags, positional };
}
