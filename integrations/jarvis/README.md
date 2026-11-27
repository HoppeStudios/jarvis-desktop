# Jarvis for Pi Desktop

The Pi Desktop integration is maintained in
[HoppeStudios/jarvis-desktop](https://github.com/HoppeStudios/jarvis-desktop).
The independent Codex Mini helper remains in
[HoppeStudios/jarvis-codex](https://github.com/HoppeStudios/jarvis-codex).
Do not install one fork's runtime over the other's active call.

## Runtime requirements

- A reviewed Windows x64 Pi Desktop build from this fork. The packaged build
  includes Electron, the Node agent runtime and the Rust host; users do not need
  a separate Rust/Node compiler for ordinary desktop use.
- An account that can authenticate the desktop's OpenAI/Codex provider and access
  its Live endpoint. Sign in through the desktop's provider UI. A CLI login does
  not authenticate the desktop; never copy token stores or browser sessions.
- A working microphone, output device, Windows microphone permission and network
  access to the provider. Audio activation must use the real renderer permission
  flow. Browser/OS denials are errors, not a reason to inject global input.
- For external local MCP control, launch with `PI_DESKTOP_MCP_CONTROL=1` and use
  Python 3.11+ for the [stdio adapter](mcp/README.md). Control binds only loopback;
  keep `~/.pi-desktop/mcp-control.json` private.
- Queue loading requires the separately reviewed local Jarvis-Inbox MCP already
  registered in Pi Desktop and its existing persistent queue. Its Node runtime
  needs SQLite support (the current installation uses Node 24). The desktop never
  creates a replacement queue when the original is unavailable.
- Optional PC/browser/GitHub MCPs retain their own pinned runtimes, credentials,
  dedicated profiles and isolation policies. Auto permission mode means the
  current Windows account's privileges, without OS elevation or tool-policy bypass.

## Configure and use

Install the [Pi global instructions](AGENTS.pi.md) at `~/.pi/agent/AGENTS.md`,
preserving local edits. The Pi loader caps this file at 32 KiB: this concise
version keeps the queue/tool/permission rules inside the loaded budget. Register
the [Pi skills](skills/) through native Skills import or reviewed
`skill/import` MCP operation. CLI skill paths alone do not register managed
Desktop skills. The Codex-specific Jarvis skills remain with the Codex fork.

`python integrations/jarvis/install-interface-skills.py --validate-only` checks
the narrow interface-skill update. Without that flag it prepares shared/CLI skill
files and the managed global Pi instruction block while preserving other config.
Then import those reviewed directories through native `skill/import` and verify
native `skill/read`; the preparatory file write alone is not Desktop registration.

1. Add/sign in to the OpenAI/Codex provider in native Settings. Select the existing
   Codex Live binding and your voice under **Live voice**.
2. Enable **Jarvis** and **Persistent queue at call start**. New/configured work
   sessions use GPT-6.1 Sol with Fast requested; new work defaults to medium effort.
   Fresh voice-created work sessions explicitly use low (Lightweight), the
   model's lowest supported effort, with Fast requested. Independent text work
   keeps its configured defaults. Fast availability remains model- and
   server-dependent; the preference does not guarantee response latency.
3. **Start new conversation** creates an independent durable coordinator. **End
   conversation** cancels startup or ends its call through the normal media owner.
   The selected busy work chat/draft is not submitted or interrupted.
4. Read the MCP operations in [mcp/README.md](mcp/README.md). A retried request ID
   is idempotent; a distinct toggle is on/off. The native Settings shortcut can be
   requested with `settings/openJarvis` without foreground takeover.

The GPT Live model forwards the complete concrete task to its bound durable
work chat, waits for its actual result and summarizes it. Follow-up clarification
continues in that same chat unless the user explicitly switches targets. The
fresh voice worker uses GPT-6.1 Sol low/Fast; this does not replace the selected
Live voice or account. Bounded accepted work/result context from this call helps
resolve follow-ups without reading unrelated saved history. Existing custom
workspace instructions remain intact when the versioned worker role is added.

The [Pi wake listener](wake/README.md) has its own guarded installer and retains
the existing Startup registration. Installing the desktop alone does not switch
an existing Codex listener. The native GPT greeting has passed installed playback
and cancellation checks with a muted microphone; human listening and actual
spoken wake recognition remain separate live acceptance checks. Guarded empty
automatic-coordinator cleanup has isolated contract/Host protocol coverage; idle
deployment and installed-client cleanup acceptance remain outstanding, as does
cross-origin answer routing. Manual, selected, drafted, active or uncertain chats
are never automatically deleted.
Managed Pi questions and final root replies have a native event producer;
successful native answers record exact request receipts and preserve partial
progress. Capture failure is visible and never blocks the original question.
Imported history and coordinator housekeeping are not replayed into the queue.
Initial Live context
contains the real bounded queue snapshot; AGENTS.md alone cannot inject context
into a separate realtime model. Historical imports do not resume old executions
or move pending native approval forms.

## Build and verification

Source requirements: Git, Node >=22.19, pnpm >=10 (the root package pins the
preferred package-manager version), a current Rust toolchain, and Windows MSVC
Build Tools plus Windows SDK. Use the checked-in pnpm/Cargo locks and review
dependency/install scripts. The verified local candidate uses Node 24.12,
pnpm 11.25, Rust 1.100, MSVC 14.44 and Electron 43.8.12; do not substitute `latest`
at startup. Packaging and native dependencies may require additional platform
build tools documented by their locked packages.

```powershell
pnpm install --frozen-lockfile
pnpm build:js
pnpm build:host
pnpm --filter @pi-desktop/desktop typecheck
node --test apps/desktop/test/jarvis-*.test.mjs apps/desktop/test/live-voice-automation.test.mjs apps/desktop/test/session-cleanup-readiness.test.mjs
node scripts/e2e-jarvis-empty-cleanup.mjs
pnpm --filter @pi-desktop/voice-runtime test
pnpm --filter @pi-desktop/desktop exec electron-builder --dir --publish never
```

Review/scan the exact packaged payload before installation. Defer replacement
while any agent/call/startup is active or media release is unconfirmed. Preserve
the user-data directory and existing MCP identities; verify exact installed hashes
and real settings/session/voice readback. Never retain a superseded executable as
a rollback installation after replacement verification. Keep private import data,
queue contents, recordings, account state and machine-specific receipts out of Git.
Use the fork's reviewed update path, not an upstream auto-updater that overwrites
the customization. Source synchronization alone does not install a new build.

Import details and limitations: [history/README.md](history/README.md).
Architecture and acceptance boundaries: [ADR](../../docs/adr/jarvis-live-coordinator.md).
