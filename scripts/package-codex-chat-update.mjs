// Repackage only reviewed built application code, preserving installed dependencies.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { createReadStream } from "node:fs";
import { cp, lstat, mkdtemp, readFile, readdir, readlink, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const asar = require(resolve(root, "node_modules/.pnpm/@electron+asar@3.4.1/node_modules/@electron/asar"));
const [installedArgument, outputArgument] = process.argv.slice(2);
assert(installedArgument && outputArgument, "Pass the installed app.asar and a private output directory");
const installed = resolve(installedArgument), output = resolve(outputArgument);
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const originalHash = hash(await readFile(installed));
const temporary = await mkdtemp(join(output, "package-"));
const unpacked = [];
try {
  for (const item of asar.listPackage(installed)) {
    const name = item.replace(/^[/\\]+/, "");
    const info = asar.statFile(installed, name);
    if (info.unpacked && !info.files && !info.link) unpacked.push(name.split(sep).join("/"));
  }
  asar.extractAll(installed, temporary);
  const oldOut = resolve(temporary, "out");
  assert(oldOut.startsWith(temporary + sep));
  await rm(oldOut, { recursive: true });
  await cp(join(root, "apps/desktop/out"), oldOut, { recursive: true });
  const packagePath = join(temporary, "package.json");
  const metadata = JSON.parse(await readFile(packagePath, "utf8"));
  assert.equal(metadata.name, "@pi-desktop/desktop");
  assert.equal(metadata.main, "./out/main/index.js");
  metadata.codexPiChatSync = "1.0.0-candidate";
  await writeFile(packagePath, JSON.stringify(metadata, null, 2));
  const candidate = join(output, "app.asar");
  const streams = [];
  async function visit(directory) {
    for (const name of (await readdir(directory)).sort()) {
      const file = join(directory, name), local = relative(temporary, file);
      const info = await lstat(file);
      const base = { path: local, unpacked: unpacked.includes(local.split(sep).join("/")), stat: info };
      if (info.isDirectory()) {
        streams.push({ ...base, type: "directory" });
        await visit(file);
      } else if (info.isSymbolicLink()) {
        streams.push({ ...base, type: "link", symlink: await readlink(file) });
      } else streams.push({ ...base, type: "file", streamGenerator: () => createReadStream(file) });
    }
  }
  await visit(temporary);
  await asar.createPackageFromStreams(candidate, streams);
  // Unpacked native payloads are unchanged and are already in the installation.
  for (const name of unpacked) {
    assert.equal(hash(await readFile(join(candidate + ".unpacked", name))),
      hash(await readFile(join(installed + ".unpacked", name))), `Native payload changed: ${name}`);
  }
  for (const item of asar.listPackage(installed)) {
    const name = item.replace(/^[/\\]+/, "");
    if (name === "package.json" || name === "out" || name.startsWith("out" + sep)) continue;
    const info = asar.statFile(installed, name);
    if (info.files || info.link) continue;
    assert.equal(hash(asar.extractFile(installed, name)), hash(asar.extractFile(candidate, name)),
      `Existing dependency changed: ${name}`);
  }
  let bridgePresent = false;
  for (const name of asar.listPackage(candidate)) {
    const local = name.replace(/^[/\\]+/, "");
    if (!local.startsWith("out" + sep + "main" + sep) || !local.endsWith(".js")) continue;
    const bytes = asar.extractFile(candidate, local);
    assert.equal(hash(bytes), hash(await readFile(join(root, "apps/desktop", local))));
    if (bytes.includes("codex-shared")) bridgePresent = true;
  }
  assert(bridgePresent, "The reviewed Main bridge was bundled");
  assert.equal(hash(await readFile(installed)), originalHash, "Installed archive changed while packaging");
  const unchangedResourceHashes = {};
  for (const name of ["bin/pi-desktop-host-core.exe", "agent-runtime/sidecar.js"]) {
    unchangedResourceHashes[name] = hash(await readFile(join(dirname(installed), name)));
  }
  const receipt = { schemaVersion: 1, unchangedResourceHashes, installedArchive: installed, previousSha256: originalHash,
    candidateArchive: candidate, candidateSha256: hash(await readFile(candidate)),
    preservedUnpackedFiles: unpacked.length, dependencyPayloadsUnchanged: true,
    installedApplicationStopped: false };
  await writeFile(join(output, "pi-candidate.json"), JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify(receipt));
} finally {
  assert(temporary.startsWith(output + sep) && relative(output, temporary).startsWith("package-"));
  await rm(temporary, { recursive: true, force: true });
}
