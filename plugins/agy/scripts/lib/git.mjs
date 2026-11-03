// Collect a reviewable diff: tracked changes plus untracked files, capped in size.
import { execFileSync } from "node:child_process";
import path from "node:path";

export const DIFF_CHAR_CAP = 200_000;
const NULL_DEVICE = process.platform === "win32" ? "NUL" : "/dev/null";

function git(cwd, args, { allowFail = false } = {}) {
  try {
    return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", windowsHide: true, maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
  } catch (err) {
    if (allowFail) return typeof err.stdout === "string" ? err.stdout : "";
    throw new Error(`git ${args[0]} failed: ${(err.stderr || err.message || "").toString().trim().slice(0, 300)}`);
  }
}

export function isGitRepo(cwd) {
  try {
    return git(cwd, ["rev-parse", "--is-inside-work-tree"]).trim() === "true";
  } catch {
    return false;
  }
}

export function resolveWorkspaceRoot(cwd) {
  try {
    return git(cwd, ["rev-parse", "--show-toplevel"]).trim() || cwd;
  } catch {
    return cwd;
  }
}

export function collectDiff(cwd, { base, staged = false, paths = [] } = {}) {
  const pathArgs = paths.length ? ["--", ...paths] : [];
  let label;
  let text;
  if (base) {
    label = `${base}..working tree`;
    text = git(cwd, ["diff", base, ...pathArgs]);
  } else if (staged) {
    label = "staged vs HEAD";
    text = git(cwd, ["diff", "--staged", ...pathArgs]);
  } else {
    label = "working tree vs HEAD";
    text = git(cwd, ["diff", "HEAD", ...pathArgs], { allowFail: true });
  }
  const files = new Set(git(cwd, ["diff", "--name-only", ...(base ? [base] : staged ? ["--staged"] : ["HEAD"]), ...pathArgs], { allowFail: true }).split(/\r?\n/).filter(Boolean));

  if (!staged) {
    const untracked = git(cwd, ["ls-files", "--others", "--exclude-standard", ...pathArgs]).split(/\r?\n/).filter(Boolean);
    for (const file of untracked) {
      files.add(file);
      // --no-index exits 1 when files differ; that is the expected case.
      text += git(cwd, ["diff", "--no-index", "--", NULL_DEVICE, path.join(cwd, file)], { allowFail: true });
    }
  }

  let truncated = false;
  if (text.length > DIFF_CHAR_CAP) {
    const dropped = text.length - DIFF_CHAR_CAP;
    text = `${text.slice(0, DIFF_CHAR_CAP)}\n[truncated ${dropped} chars]\n`;
    truncated = true;
  }
  return { text, truncated, files: [...files], label };
}
