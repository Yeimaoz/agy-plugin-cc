// Prompt templates and JSON schemas shipped with the plugin.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export function promptPath(name) {
  return path.join(PLUGIN_ROOT, "prompts", `${name}.md`);
}

export function schemaPath(name) {
  return path.join(PLUGIN_ROOT, "schemas", `${name}.schema.json`);
}

export function renderPrompt(name, vars = {}) {
  const template = readFileSync(promptPath(name), "utf8");
  const missing = new Set();
  const out = template.replace(/\{\{([A-Z_]+)\}\}/g, (_, key) => {
    if (!(key in vars)) {
      missing.add(key);
      return "";
    }
    return String(vars[key] ?? "");
  });
  if (missing.size) throw new Error(`prompt ${name}: missing variable(s) ${[...missing].join(", ")}`);
  return out;
}
