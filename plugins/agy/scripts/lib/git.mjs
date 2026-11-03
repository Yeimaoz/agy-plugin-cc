// Collect a reviewable diff: tracked changes plus untracked files, capped in size.
import { execFileSync } from "node:child_process";

export const DIFF_CHAR_CAP = 200_000;
const NULL_DEVICE = process.platform === "win32" ? "NUL" : "/dev/null";

export class GitError extends Error {
  constructor(message) {
    super(message);
    this.name = "GitError";
  }
}

function git(cwd, args, { allowFail = false } = {}) {
  try {
    return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", windowsHide: true, maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
  } catch (err) {
    if (allowFail) return typeof err.stdout === "string" ? err.stdout : "";
    throw new GitError(`git ${args[0]} failed: ${(err.stderr || err.message || "").toString().trim().slice(0, 300)}`);
  }
}

function splitZ(text) {
  return String(text).split("\0").filter(Boolean);
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

function hasHead(cwd) {
  try {
    git(cwd, ["rev-parse", "--verify", "-q", "HEAD"]);
    return true;
  } catch {
    return false;
  }
}

// Render an untracked file as an "added file" diff with repo-relative paths, like `git add -N` would.
function untrackedDiff(cwd, file) {
  // --no-index exits 1 when the files differ, which is the expected case.
  const raw = git(cwd, ["diff", "--no-index", "--", NULL_DEVICE, file], { allowFail: true });
  const nullQuoted = NULL_DEVICE.replace(/\\/g, "/");
  return raw
    .replace(new RegExp(`^diff --git a/${nullQuoted.replace(/[./]/g, "\\$&")} b/.*$`, "m"), `diff --git a/${file} b/${file}`)
    .replace(/^--- (?:a\/)?(?:\/dev\/null|NUL)$/m, "--- /dev/null")
    .replace(/^\+\+\+ b\/.*$/m, `+++ b/${file}`);
}

export function collectDiff(cwd, { base, staged = false, paths = [] } = {}) {
  if (!isGitRepo(cwd)) throw new GitError(`not a git repository: ${cwd}`);
  const pathArgs = paths.length ? ["--", ...paths] : [];
  const headRef = hasHead(cwd) ? "HEAD" : "4b825dc642cb6eb9a060e54bf8d69288fbee4904"; // empty tree
  let label;
  let rangeArgs;
  if (base) {
    label = `${base}..working tree`;
    rangeArgs = [base];
  } else if (staged) {
    label = "staged vs HEAD";
    rangeArgs = ["--staged", headRef];
  } else {
    label = "working tree vs HEAD";
    rangeArgs = [headRef];
  }
  let text = git(cwd, ["diff", ...rangeArgs, ...pathArgs]);
  const files = new Set(splitZ(git(cwd, ["diff", "--name-only", "-z", ...rangeArgs, ...pathArgs])));

  if (!staged) {
    const untracked = splitZ(git(cwd, ["ls-files", "--others", "--exclude-standard", "-z", ...pathArgs]));
    for (const file of untracked) {
      files.add(file);
      if (text.length > DIFF_CHAR_CAP) break;
      text += untrackedDiff(cwd, file);
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
