// Read all of stdin as utf-8 text (used for prompts that must not travel through argv or a shell).
export async function readStdinText() {
  if (process.stdin.isTTY) return "";
  let data = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) data += chunk;
  return data;
}
