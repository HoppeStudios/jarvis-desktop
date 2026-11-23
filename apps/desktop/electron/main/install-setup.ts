import { readFile, writeFile, unlink } from "node:fs/promises";
import { IPC, parseMcpImport } from "@pi-desktop/shared";

const SETTINGS = new Set(["defaultProviderId", "defaultModelId", "defaultPermissionMode", "language", "updatePreference"]);
const SECRET = /^(?:password|passwd|api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret)$/i;

/** A launch-time, local installer contract, never an external MCP operation. */
export function validateInstallSetup(raw: unknown): { settings: Record<string, unknown>; mcpServers: Record<string, unknown> } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Invalid install setup");
  const input = raw as Record<string, any>;
  if (input.schemaVersion !== 1 || Object.keys(input).some((key) => !["schemaVersion", "settings", "mcpServers"].includes(key))) throw new Error("Unsupported install setup schema");
  const settings = input.settings ?? {};
  if (!settings || typeof settings !== "object" || Array.isArray(settings) || Object.keys(settings).some((key) => !SETTINGS.has(key))) throw new Error("Install settings contain unsupported fields");
  const mcpServers = input.mcpServers ?? {};
  if (!mcpServers || typeof mcpServers !== "object" || Array.isArray(mcpServers)) throw new Error("Invalid install MCP configuration");
  const inspect = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      if (SECRET.test(key) || key === "headers" || key === "auth" || key === "oauth") throw new Error("Credentials are not accepted in install setup");
      if (key === "env" && child && typeof child === "object" && Object.keys(child).some((name) => /TOKEN|PASSWORD|SECRET|API_KEY/i.test(name))) throw new Error("Credential environment variables are not accepted in install setup");
      inspect(child);
    }
  };
  inspect(mcpServers);
  // Disabled, credential-dependent and incompatible entries remain deferred.
  return { settings, mcpServers: Object.fromEntries(Object.entries(mcpServers).filter(([, value]) => !!value && typeof value === "object" && (value as any).enabled !== false && (value as any).disabled !== true)) };
}

export async function applyInstallSetup(file: string, invoke: (channel: string, args?: readonly unknown[]) => Promise<any>): Promise<void> {
  const text = await readFile(file, "utf8");
  if (Buffer.byteLength(text) > 512 * 1024) throw new Error("Install setup exceeds size limit");
  const setup = validateInstallSetup(JSON.parse(text));
  if (Object.keys(setup.settings).length) await invoke(IPC.invoke.settingsSet, [setup.settings]);
  let imported = 0;
  const preserved: string[] = [];
  if (Object.keys(setup.mcpServers).length) {
    const existing = await invoke(IPC.invoke.mcpList, []);
    const ids = new Set((existing.servers ?? []).map((server: any) => server.id));
    for (const [name, value] of Object.entries(setup.mcpServers)) {
      const candidate = parseMcpImport(JSON.stringify({ mcpServers: { [name]: value } })).servers[0];
      if (!candidate) throw new Error("Invalid install MCP entry");
      if (ids.has(candidate.id)) { preserved.push(candidate.id); continue; }
      const result = await invoke(IPC.invoke.mcpImport, [{ text: JSON.stringify({ mcpServers: { [name]: value } }) }]);
      if (result.failed?.length) throw new Error("Some install MCP entries could not be imported");
      imported += result.imported?.length ?? 0;
    }
  }
  await writeFile(`${file}.receipt.json`, JSON.stringify({ schemaVersion: 1, settings: Object.keys(setup.settings), importedMcpServers: imported, preservedMcpServers: preserved, credentialsCopied: false }), { mode: 0o600 });
  await unlink(file);
}
