import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, access, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { register } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
register(pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), "helpers/ts-import-hooks.mjs")));
const { validateInstallSetup, applyInstallSetup } = await import("../electron/main/install-setup.ts");

test("installer never imports credentials or enables deferred servers", () => {
  assert.throws(() => validateInstallSetup({ schemaVersion: 1, settings: { liveVoice: {} } }));
  assert.throws(() => validateInstallSetup({ schemaVersion: 1, mcpServers: { x: { env: { api_key: "fixture" } } } }));
  assert.throws(() => validateInstallSetup({ schemaVersion: 1, mcpServers: { x: { headers: {} } } }));
  const result = validateInstallSetup({ schemaVersion: 1, settings: { defaultPermissionMode: "auto" }, mcpServers: { deferred: { enabled: false, command: "unused" }, pc: { command: "python", env: { PC_CONTROL_ISOLATED_DEFAULT: "1" } } } });
  assert.deepEqual(Object.keys(result.mcpServers), ["pc"]);
  assert.equal(result.mcpServers.pc.env.PC_CONTROL_ISOLATED_DEFAULT, "1");
});

test("one-shot setup uses existing handlers and writes a non-secret receipt after success", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-install-setup-"));
  try {
    const file = join(root, "setup.json");
    await writeFile(file, JSON.stringify({ schemaVersion: 1, settings: { defaultPermissionMode: "auto" }, mcpServers: { pc: { command: "python" } } }));
    const calls = [];
    await applyInstallSetup(file, async (channel, args) => { calls.push({ channel, args }); return channel.endsWith("/mcp/import") ? { imported: [{}], failed: [] } : {}; });
    assert.deepEqual(calls.map((call) => call.channel), ["pi-desktop/settings/set", "pi-desktop/mcp/list", "pi-desktop/mcp/import"]);
    assert.equal(JSON.parse(await readFile(`${file}.receipt.json`, "utf8")).credentialsCopied, false);
    await assert.rejects(() => access(file));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("failed import retains the setup for inspection without claiming completion", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-install-failure-"));
  try {
    const file = join(root, "setup.json");
    await writeFile(file, JSON.stringify({ schemaVersion: 1, mcpServers: { pc: { command: "python" } } }));
    await assert.rejects(() => applyInstallSetup(file, async () => ({ failed: [{}] })), /could not be imported/);
    await access(file);
    await assert.rejects(() => access(`${file}.receipt.json`));
  } finally { await rm(root, { recursive: true, force: true }); }
});
