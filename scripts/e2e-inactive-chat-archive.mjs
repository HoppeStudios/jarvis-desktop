#!/usr/bin/env node
// Built native archive/MCP integration in an isolated profile; no real account/input.
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
import { resolveHostBinary, Host } from "./e2e/host.mjs";
import { DatabaseSync } from "node:sqlite";

const root = repositoryRoot();
const scratch = resolve(process.env.PI_SCRATCH_DIR || tmpdir());
const temp = await mkdtemp(join(scratch, "inactive-archive-e2e-"));
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
  CODEX_PI_SYNC_RUNTIME: join(home, "no-shared-owner"),
  PI_CODING_AGENT_DIR: join(home, ".pi", "agent"), PI_DESKTOP_DATA_DIR: dataDir,
  PI_DESKTOP_HOST_BIN: resolveHostBinary(), PI_DESKTOP_MCP_CONTROL: "1", PI_DESKTOP_MCP_PORT: String(mcpPort),
  PI_DESKTOP_JARVIS_BACKGROUND: "1", PI_DESKTOP_START_MAXIMIZED: "0", ELECTRON_RENDERER_URL: "" };
delete env.ELECTRON_RUN_AS_NODE;
delete env.PI_DESKTOP_INSTALL_SETUP;
delete env.PI_DESKTOP_PI_IMPORT_DIR;
const seed = new Host(resolveHostBinary(), dataDir, { env, quiet: true });
await seed.start();
const old = (await seed.call("session.create", { title: "Inactive archive fixture", mode: "agent" })).session;
const middle = (await seed.call("session.create", { title: "Three-week archive fixture", mode: "agent" })).session;
const fresh = (await seed.call("session.create", { title: "Recent archive fixture", mode: "agent" })).session;
await seed.stop();
const db = new DatabaseSync(join(dataDir, "pi.sqlite"));
const stamp = db.prepare("SELECT updated_at FROM sessions WHERE id=?").get(old.id).updated_at;
db.prepare("UPDATE sessions SET updated_at=? WHERE id=?").run(stamp - 29 * 24 * 60 * 60 * (stamp > 1e12 ? 1000 : 1), old.id);
db.prepare("UPDATE sessions SET updated_at=? WHERE id=?").run(stamp - 21 * 24 * 60 * 60 * (stamp > 1e12 ? 1000 : 1), middle.id);
db.close();
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
  renderer = await connectRenderer(cdpPort);
  await renderer.run(() => window.__PI_DESKTOP__?.skipStartupOverlays());
  phase = "automatic native archive";
  let active;
  const archivedBy = Date.now() + 75_000;
  while (Date.now() < archivedBy) {
    active = await control.tool("pi_session_list", {});
    if (!active.sessions.some(s => s.id === old.id)) break;
    await delay(250);
  }
  assert(!active.sessions.some(s => s.id === old.id), "old session is absent from default MCP results");
  assert(active.sessions.some(s => s.id === fresh.id), "recent session remains active");
  assert(active.sessions.some(s => s.id === middle.id), "three-week-old session remains active");
  const archived = await control.tool("pi_session_list", { includeArchived: true, search: "Inactive archive fixture" });
  assert.equal(archived.sessions.find(s => s.id === old.id)?.archived, true);
  const detail = await control.tool("pi_session_get", { id: old.id, messageLimit: 10 });
  assert.equal(detail.session.id, old.id, "archived history remains readable by ID");
  const preferences = JSON.parse(await readFile(join(dataDir, "sidebar-preferences.json"), "utf8"));
  assert.equal(preferences.sessionMeta[old.id]?.archived, true, "same durable flag as native archive UI");
  await renderer.run(id => window.__PI_DESKTOP__.selectSession(id), old.id);
  const afterOpen = await control.tool("pi_session_get", { id: old.id, messageLimit: 10 });
  assert.equal(afterOpen.session.id, old.id, "archived session can still open");
  console.log("PASS native inactivity archive: four-week sweep, recent retention, default MCP exclusion, explicit archive search, durable native archive flag and history access");
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
