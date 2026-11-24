import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { register } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
register(pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), "helpers/ts-import-hooks.mjs")));
const { piImporter } = await import("../electron/main/importers/pi.ts");

test("migration retains historical activity as text without making executable tool calls", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-history-"));
  try {
    const file = join(root, "history.jsonl");
    const timestamp = "2026-11-23T00:00:00Z";
    await writeFile(file, [
      { type: "session", id: "fixture", version: 3, timestamp, cwd: root },
      { type: "message", timestamp, message: { role: "user", content: [{ type: "text", text: "Original request" }] } },
      { type: "message", timestamp, message: { role: "custom", customType: "codex-history", content: "Historical command output" } },
      { type: "message", timestamp, message: { role: "assistant", content: [{ type: "text", text: "Original answer" }], provider: "openai-codex", model: "gpt-6.1-sol" } },
    ].map(JSON.stringify).join("\n") + "\n");
    const result = await piImporter.convert({ filePath: file, externalId: "fixture", source: "pi", title: "History", projectPath: root, createdAt: timestamp, updatedAt: timestamp, messageCount: 3, model: null });
    assert.deepEqual(result.messages.map((m) => m.role), ["user", "assistant", "assistant"]);
    assert.match(result.messages[1].content, /not an execution request/);
    assert.match(result.messages[1].content, /Historical command output/);
    assert.equal(result.messages.some((m) => m.toolName || m.toolCallId), false);
    assert.equal(result.session.title, "History");
  } finally { await rm(root, { recursive: true, force: true }); }
});
