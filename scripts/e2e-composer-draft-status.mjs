#!/usr/bin/env node
// Built app/Main/renderer/MCP in an isolated profile; no provider or real input.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { connectControl, connectRenderer } from "../apps/desktop/test/e2e/plugin-ui-slots/clients.mjs";
import { repositoryRoot, assertDesktopBuild, resolveElectronBinary } from "./e2e/boot.mjs";
import { resolveHostBinary } from "./e2e/host.mjs";

const root = repositoryRoot();
const scratch = resolve(process.env.PI_SCRATCH_DIR || tmpdir());
const temp = await mkdtemp(join(scratch, "composer-status-e2e-"));
const dataDir = join(temp, "data");
const home = join(temp, "home");
await mkdir(home);
async function port() {
  const server = createServer();
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const value = server.address().port; await new Promise(done => server.close(done)); return value;
}
const cdpPort = await port(), mcpPort = await port();
const { appDir } = assertDesktopBuild(root);
const { electronBinary } = resolveElectronBinary(root);
const env = { ...process.env, USERPROFILE: home, HOME: home,
  PI_CODING_AGENT_DIR: join(home, ".pi", "agent"), PI_DESKTOP_DATA_DIR: dataDir,
  PI_DESKTOP_HOST_BIN: resolveHostBinary(), PI_DESKTOP_MCP_CONTROL: "1", PI_DESKTOP_MCP_PORT: String(mcpPort),
  PI_DESKTOP_JARVIS_BACKGROUND: "1", PI_DESKTOP_START_MAXIMIZED: "0", ELECTRON_RENDERER_URL: "" };
delete env.ELECTRON_RUN_AS_NODE;
delete env.PI_DESKTOP_INSTALL_SETUP;
delete env.PI_DESKTOP_PI_IMPORT_DIR;
const child = spawn(electronBinary, [`--user-data-dir=${join(temp, "profile")}`,
  `--remote-debugging-port=${cdpPort}`, "--remote-debugging-address=127.0.0.1", "."],
{ cwd: appDir, env, windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
let stderr = "", renderer, phase = "boot";
child.stderr.on("data", data => { stderr = (stderr + data).slice(-4_000); });
const exited = once(child, "exit");
try {
  let control;
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error("Isolated app exited before readiness");
    try {
      const info = JSON.parse(await readFile(join(dataDir, "mcp-control.json"), "utf8"));
      if (info.active && new URL(info.url).port === String(mcpPort)) { control = await connectControl(dataDir); break; }
    } catch { /* Own fixture may still be starting. No running user app is used. */ }
    await delay(100);
  }
  assert(control, "isolated MCP started");
  phase = "connect renderer";
  renderer = await connectRenderer(cdpPort);
  const invoke = async (operation, args = [], confirm = false) =>
    (await control.tool("pi_desktop_invoke", { operation, args, confirm })).result;
  await renderer.until(() => Boolean(document.querySelector(".composer-input")), null, "composer");
  const blur = () => renderer.run(() => document.activeElement?.blur());
  const status = () => invoke("app/composerDraftStatus");
  await blur();
  phase = "empty metadata";
  assert.deepEqual({ known: (await status()).known, empty: (await status()).empty }, { known: true, empty: true });
  const first = await invoke("session/create", [{ title: "Draft source fixture", mode: "agent" }]);
  const firstId = first.session.id;
  const select = async id => {
    phase = "select fixture";
    await invoke("session/open", [id]);
    await renderer.run(id => window.__PI_DESKTOP__.selectSession(id), id);
    await renderer.until(() => Boolean(document.querySelector(".composer-input")), null, "selected composer");
  };
  await select(firstId);
  const type = text => renderer.run(text => {
    const element = document.querySelector(".composer-input");
    element.textContent = text;
    element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
    element.blur();
  }, text);
  phase = "type fixture";
  await type("PRIVATE_TEST_DRAFT");
  const typed = await status();
  assert.equal(typed.empty, false); assert(typed.liveDrafts + typed.cachedDrafts > 0);
  assert.doesNotMatch(JSON.stringify(typed), /PRIVATE_TEST_DRAFT|Draft source/);
  const second = await invoke("session/create", [{ title: "Empty target fixture", mode: "agent" }]);
  await select(second.session.id);
  await blur();
  const cached = await status();
  assert.equal(cached.empty, false); assert(cached.cachedDrafts > 0, "inactive draft survived the chat switch");
  await select(firstId);
  await renderer.until(() => document.querySelector(".composer-input")?.textContent === "PRIVATE_TEST_DRAFT", null, "restored draft");
  await type("");
  await select(second.session.id);
  await blur();
  assert.equal((await status()).empty, true, "cleared draft leaves no hidden nonempty slot");
  await renderer.run(() => document.querySelector(".composer-input").focus());
  assert((await status()).busyEditors > 0, "local page focus is busy even before text is serialized");
  await blur();
  const detail = await invoke("session/get", [{ id: firstId, messageLimit: 10 }]);
  assert.equal(detail.session.messages.length, 0, "draft was never submitted");
  console.log("PASS composer status: native MCP, live text, inactive cache, restore/clear, busy focus, no draft text or submission");
} catch (error) {
  throw new Error(`${phase}: ${error.message}\nIsolated app diagnostics: ${stderr}`, { cause: error });
} finally {
  renderer?.close();
  if (child.exitCode === null) {
    if (process.platform === "win32") {
      const stop = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
      await once(stop, "exit");
    } else child.kill("SIGTERM");
  }
  let timer;
  try { await Promise.race([exited, new Promise((_done, reject) => {
    timer = setTimeout(() => reject(new Error("Own fixture did not exit")), 5_000);
  })]); } finally { clearTimeout(timer); }
  assert(resolve(temp).startsWith(scratch + sep), "cleanup stays inside the explicit scratch root");
  await rm(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
