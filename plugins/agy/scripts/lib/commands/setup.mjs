import { checkVersion, listModels } from "../agy.mjs";
import { loadState, updateState } from "../state.mjs";
import { emit } from "../context.mjs";
import { renderSetup } from "../render.mjs";

export async function runSetup(ctx, { flags }) {
  if (flags["enable-review-gate"] || flags["disable-review-gate"]) {
    updateState(ctx.cwd, (s) => { s.config.stopReviewGate = Boolean(flags["enable-review-gate"]); }, ctx.env);
  }
  const state = loadState(ctx.cwd, ctx.env);
  const info = {
    ready: false,
    agy: { bin: ctx.bin, version: null, ok: false },
    auth: { loggedIn: false, detail: "" },
    models: 0,
    config: { stopReviewGate: Boolean(state.config.stopReviewGate) },
    workspace: ctx.cwd,
  };
  if (ctx.bin) {
    const v = await checkVersion(ctx.bin);
    info.agy.version = v.version;
    info.agy.ok = v.ok;
    try {
      const catalog = await listModels(ctx.bin);
      info.models = catalog.length;
      info.auth = { loggedIn: true, detail: `agy models returned ${catalog.length} models` };
    } catch (err) {
      info.auth = { loggedIn: false, detail: err.message };
    }
  } else {
    info.auth.detail = "agy binary not found on PATH, AGY_BIN or ~/.local/bin";
  }
  info.ready = Boolean(ctx.bin && info.auth.loggedIn);
  if (info.agy.version && !info.agy.ok) info.warning = `agy ${info.agy.version} is below the tested minimum 1.4.12`;
  emit(ctx, info, renderSetup(info));
  return info.ready ? 0 : 1;
}
