// Fake tmux for tests. State lives in the JSON file named by FAKE_TMUX_STATE:
// { sessions: { name: { screen, cmd, args, cwd, keys: [] } } }. Tests preset `screen` to simulate the pane.
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const file = process.env.FAKE_TMUX_STATE;
const load = () => (existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : { sessions: {} });
const save = (s) => writeFileSync(file, JSON.stringify(s));
const a = process.argv.slice(2);
const opt = (flag) => { const i = a.indexOf(flag); return i === -1 ? undefined : a[i + 1]; };
const st = load();
st.sessions ||= {};
const cmd = a[0];

if (cmd === "-V") { process.stdout.write("tmux fake 3.4\n"); process.exit(0); }
if (cmd === "new-session") {
  const dd = a.indexOf("--");
  st.sessions[opt("-s")] = { screen: "starting...", cwd: opt("-c"), cmd: a[dd + 1], args: a.slice(dd + 2), keys: [] };
  save(st);
  process.exit(0);
}
const target = opt("-t");
const s = st.sessions[target];
if (!s) { process.stderr.write(`can't find session: ${target}\n`); process.exit(1); }
if (cmd === "has-session") process.exit(0);
if (cmd === "kill-session") { delete st.sessions[target]; save(st); process.exit(0); }
if (cmd === "capture-pane") { process.stdout.write(`${s.screen}\n`); process.exit(0); }
if (cmd === "send-keys") {
  const literal = a.includes("-l");
  const dd = a.indexOf("--");
  const text = literal ? a[dd === -1 ? a.indexOf("-l") + 1 : dd + 1] : a[a.indexOf(target) + 1];
  s.keys.push({ literal, text });
  save(st);
  process.exit(0);
}
process.stderr.write(`fake-tmux: unsupported ${cmd}\n`);
process.exit(1);
