import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { repositoryRoot } from "../../../scripts/e2e/boot.mjs";

const root = repositoryRoot();
const { build } = createRequire(join(root, "packages/agent-runtime/package.json"))("esbuild");

test("Live classifier resolves its model without agent tools, shell or session mutations", async () => {
  const temp = await mkdtemp(join(root, "apps/desktop/.classifier-provider-test-"));
  try {
    const bundle = join(temp, "launch.mjs");
    await build({ entryPoints: [join(root, "apps/desktop/electron/main/runtime/session-launch.ts")],
      outfile: bundle, bundle: true, platform: "node", format: "esm", packages: "external",
      nodePaths: [join(root, "apps/desktop/node_modules")] });
    const { createSessionLaunchRuntime } = await import(pathToFileURL(bundle).href);
    const calls = [];
    const forbidden = () => { throw new Error("Classifier must not initialize agent resources"); };
    const provider = { id: "fixture-account", name: "Fixture account", enabled: true,
      authKind: "none", apiStyle: "responses", baseUrl: "https://fixture.invalid/v1", models: [] };
    const projects = new Map([["bound-session", "C:/existing-project"]]);
    const runtime = createSessionLaunchRuntime({
      runtimeState: { host: { async call(method) {
        calls.push(method);
        if (method === "providers.list") return { providers: [provider] };
        if (method === "providers.getSecret") return { value: "" };
        assert.fail("Unexpected classifier resource: " + method);
      } }, sidecar: { setVendorAuthBindings: forbidden }, agentHostBridge: null },
      logger: { app: forbidden }, userMcp: { setRecords: forbidden, toolsForProject: forbidden },
      plugins: { getTools: forbidden, getSkills: forbidden, listLoaded: forbidden, getAgentExtensions: forbidden },
      sessionProjects: projects, dataDir: temp,
      vendorOAuth: { bindingFor: forbidden },
      modelsDevCatalog: { async ensureLoaded() {}, configureAccount() {}, findModel() { return undefined; } },
      getWorkspacePath: forbidden, pluginActiveInProject: forbidden,
      bindingForModel: () => undefined, effectiveSubagentModelConfig: forbidden,
      normalizeThinkingLevel: value => value ?? "low",
    });
    const result = await runtime.resolveCompletionProvider(
      { id: "bound-session", providerId: provider.id, modelId: "gpt-6.1-sol" },
      { defaultProviderId: provider.id, defaultModelId: "gpt-6.1-sol" },
      { thinkingLevel: "low" },
    );
    assert.equal(result.providerId, provider.id);
    assert.equal(result.provider.modelId, "gpt-6.1-sol");
    assert.equal(result.provider.apiStyle, "responses");
    assert.equal(result.provider.apiKey, "");
    assert.deepEqual(calls, ["providers.list", "providers.getSecret"]);
    assert.deepEqual([...projects], [["bound-session", "C:/existing-project"]]);
    await assert.rejects(runtime.resolveCompletionProvider(
      { providerId: "missing-provider", modelId: "gpt-6.1-sol" }, {}, {}),
    error => error.errorCode === "MODEL_NOT_CONFIGURED");
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
