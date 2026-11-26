// Functional acceptance of the built Pi app in an isolated profile and local-model fixture.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFile, mkdir, writeFile, link, readdir, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { nativeJsonRpcWebSocketTransport } from "@pi-desktop/racp";
import { connectControl, connectRenderer } from "../apps/desktop/test/e2e/plugin-ui-slots/clients.mjs";
import { assertDesktopBuild, resolveElectronBinary } from "./e2e/boot.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const runtime = process.env.CODEX_PI_SYNC_RUNTIME;
assert(runtime, "An explicit fixture runtime is required");
const config = JSON.parse(await readFile(join(runtime, "bridge.json"), "utf8"));
assert.equal(config.testFixture, true, "Refusing to touch a non-fixture installation");
const metadata = JSON.parse(await readFile(join(runtime, "connection.json"), "utf8"));
const token = (await readFile(metadata.tokenFile, "utf8")).trim();
const wire = await nativeJsonRpcWebSocketTransport({ url: metadata.url, token })();
let sequence = 0;
const replies = new Map(), notices = [];
wire.onError(() => {});
wire.onMessage(frame => {
  const value = JSON.parse(frame);
  if (value.method) { notices.push(value); return; }
  const waiter = replies.get(value.id);
  if (!waiter) return;
  replies.delete(value.id); clearTimeout(waiter.timer);
  value.error ? waiter.reject(new Error(value.error.message)) : waiter.resolve(value.result);
});
const request = (method, params) => new Promise((resolveResult, reject) => {
  const id = `desktop-app-fixture-${++sequence}`;
  const timer = setTimeout(() => reject(new Error("Native request deadline exceeded")), 25000);
  replies.set(id, { resolve: resolveResult, reject, timer });
  wire.send(JSON.stringify({ id, method, params }));
});
async function completed(id) {
  const deadline = Date.now() + 25000;
  while (Date.now() < deadline) {
    const notice = notices.find(value => value.method === "turn/completed" && value.params.turn.id === id);
    if (notice) { assert.equal(notice.params.turn.status, "completed"); return; }
    await delay(25);
  }
  throw new Error("Native fixture completion deadline exceeded");
}
async function port() {
  const server = createServer();
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const value = server.address().port; await new Promise(done => server.close(done)); return value;
}
let child, renderer, packagedShell, phase = "native setup", diagnostics = "";
async function cloneInstalledFiles(source, destination) {
  await mkdir(destination, { recursive: true });
  for (const entry of await readdir(source, { withFileTypes: true })) {
    assert(!entry.isSymbolicLink(), "Installed fixture payload must not contain links");
    const original = join(source, entry.name), target = join(destination, entry.name);
    if (entry.isDirectory()) await cloneInstalledFiles(original, target);
    else await link(original, target);
  }
}
try {
  await request("initialize", { clientInfo: { name: "desktop-app-fixture", version: "1" }, capabilities: { experimentalApi: true } });
  wire.send(JSON.stringify({ method: "initialized", params: {} }));
  const cwd = process.platform === "win32" ? "C:\\" : config.codexHome;
  const thread = (await request("thread/start", { cwd })).thread;
  const initial = await request("turn/start", { threadId: thread.id, input: [{ type: "text", text: "A conversation started in Codex" }] });
  await completed(initial.turn.id);
  await request("thread/name/set", { threadId: thread.id, name: "Shared chat fixture" });
  const fixture = join(config.codexHome, "pi-app-fixture");
  const home = join(fixture, "home"), dataDir = join(fixture, "data");
  for (const path of [home, dataDir, join(home, "AppData/Local"), join(home, "AppData/Roaming")]) await mkdir(path, { recursive: true });
  const cdp = await port(), mcp = await port();
  const { appDir } = assertDesktopBuild(root), { electronBinary } = resolveElectronBinary(root);
  const env = { ...process.env, USERPROFILE: home, HOME: home,
    LOCALAPPDATA: join(home, "AppData/Local"), APPDATA: join(home, "AppData/Roaming"),
    PI_CODING_AGENT_DIR: join(home, ".pi/agent"), PI_DESKTOP_DATA_DIR: dataDir,
    PI_DESKTOP_HOST_BIN: join(root, "target/release/pi-desktop-host-core.exe"),
    PI_DESKTOP_MCP_CONTROL: "1", PI_DESKTOP_MCP_PORT: String(mcp),
    PI_DESKTOP_JARVIS_BACKGROUND: "1", PI_DESKTOP_START_MAXIMIZED: "0", ELECTRON_RENDERER_URL: "" };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.PI_DESKTOP_INSTALL_SETUP;
  delete env.PI_DESKTOP_PI_IMPORT_DIR;
  let executable = electronBinary;
  let launchArgs = [`--user-data-dir=${join(fixture, "profile")}`,
    `--remote-debugging-port=${cdp}`, "--remote-debugging-address=127.0.0.1", process.env.CODEX_SYNC_PI_ARCHIVE ?? "."];
  if (process.env.CODEX_SYNC_INSTALLED_PI_DIRECTORY) {
    assert(process.env.CODEX_SYNC_PI_ARCHIVE, "A reviewed candidate archive is required");
    packagedShell = join(fixture, "packaged-shell");
    await cloneInstalledFiles(resolve(process.env.CODEX_SYNC_INSTALLED_PI_DIRECTORY), packagedShell);
    await rm(join(packagedShell, "resources/app.asar"));
    await link(resolve(process.env.CODEX_SYNC_PI_ARCHIVE), join(packagedShell, "resources/app.asar"));
    executable = join(packagedShell, "PI-Desktop.exe");
    launchArgs = launchArgs.slice(0, -1);
    delete env.PI_DESKTOP_HOST_BIN;
  }
  phase = "isolated app startup";
  child = spawn(executable, launchArgs,
    { cwd: appDir, env, windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
  child.stderr.on("data", data => { diagnostics = (diagnostics + data).slice(-4000); });
  let control;
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    assert.equal(child.exitCode, null, "Own fixture app must still be running");
    try {
      const info = JSON.parse(await readFile(join(dataDir, "mcp-control.json"), "utf8"));
      if (info.active && new URL(info.url).port === String(mcp)) { control = await connectControl(dataDir); break; }
    } catch { /* Only our just-started fixture is polled. */ }
    await delay(100);
  }
  assert(control, "The app's actual MCP server became ready");
  const invoke = async (operation, args = []) => (await control.tool("pi_desktop_invoke", { operation, args })).result;
  renderer = await connectRenderer(cdp);
  phase = "shared conversation visibility";
  let selected;
  const visibleDeadline = Date.now() + 15000;
  while (Date.now() < visibleDeadline) {
    const list = await control.tool("pi_session_list");
    selected = list.sessions.find(value => value.id === `remote:codex-shared:${thread.id}`);
    if (selected) break;
    await delay(100);
  }
  assert(selected, "Codex conversation is present in the real Pi app catalog");
  assert.equal(selected.source, "codex");
  await renderer.run(id => window.__PI_DESKTOP__.selectSession(id), selected.id);
  await renderer.until(() => document.body.innerText.includes("A conversation started in Codex"), null, "native user message");
  await renderer.until(() => document.body.innerText.includes("Fixture reply 1"), null, "native answer");
  phase = "continue through Pi composer";
  await renderer.until(() => Boolean(document.querySelector(".composer-input")), null, "actual composer");
  await renderer.run(text => {
    const input = document.querySelector(".composer-input");
    input.textContent = text;
    input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
    input.blur();
  }, "Continued through Pi's interface");
  await renderer.until(() => { const button = document.querySelector(".send-btn"); return button && !button.disabled; }, null, "enabled send button");
  await renderer.run(() => document.querySelector(".send-btn").click());
  await renderer.until(() => document.body.innerText.includes("Fixture reply 2"), null, "shared second answer", 25000);
  await control.waitForTurn(selected.id);
  const history = await request("thread/items/list", { threadId: thread.id, limit: 50, sortDirection: "asc" });
  assert.equal(history.data.length, 4, "One user and assistant pair per submitted turn");
  assert(JSON.stringify(history).includes("Continued through Pi's interface"));
  const detail = await invoke("session/get", [{ id: selected.id, messageLimit: 100 }]);
  assert.equal(detail.session.messages.length, 4);
  await renderer.until(() => !document.querySelector(".startup-splash"), null, "completed app startup", 30000);
  if (packagedShell) await renderer.until(() => !document.querySelector(".backend-banner"), null, "healthy installed Host and sidecar", 30000);
  const screenshot = await renderer.screenshot();
  await writeFile(join(fixture, "pi-shared-chat.png"), Buffer.from(screenshot, "base64"));
  console.log(JSON.stringify({ passed: true, builtPiApp: true, packagedArchive: Boolean(process.env.CODEX_SYNC_PI_ARCHIVE), installedRuntimePayloads: Boolean(packagedShell), nativeMcpRouting: true,
    realRendererDisplay: true, submittedThroughPiComposer: true, sameNativeChat: true,
    duplicateMessages: false, liveModelRequests: 0 }));
} catch (error) {
  throw new Error(`${phase}: ${error.message}\nOwn fixture diagnostics: ${diagnostics}`, { cause: error });
} finally {
  renderer?.close(); wire.close();
  for (const waiter of replies.values()) clearTimeout(waiter.timer);
  if (child && child.exitCode === null) {
    // Only the explicitly spawned isolated fixture and its children are stopped.
    if (process.platform === "win32") {
      const stop = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
      await once(stop, "exit");
    } else child.kill("SIGTERM");
  }
  if (packagedShell) {
    assert(packagedShell.startsWith(join(config.codexHome, "pi-app-fixture") + (process.platform === "win32" ? "\\" : "/")));
    await rm(packagedShell, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
}
