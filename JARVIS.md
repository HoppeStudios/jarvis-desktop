# Jarvis Desktop fork

This HoppeStudios fork builds on PI-Desktop. Codex Mini's separate helper remains
in `HoppeStudios/jarvis-codex`; this repository owns desktop-specific integration.
The functioning Codex voice path must remain available until the replacement is
verified. Importing chats does not itself migrate live calls or app connectors.

## Installation and build requirements

Use the checked-in lockfile and reviewed source revision, never `latest` at
startup. The workspace requires Node >=22.19, pnpm >=10 (the declared package
manager is 12.8.1), Rust compatible with edition 2024 and the locked Cargo graph,
Windows x64, and MSVC C++ build tools/Windows SDK. The verified local candidate
used Node 24.12, pnpm 11.25, Rust 1.100, MSVC 14.44, and Electron 43.8.12.
No Windows administrator elevation is required for the per-user installation.

Run frozen dependency installation, inspect approved build scripts, audit the
locked dependency graph, build the JavaScript packages and release host, bundle
the agent runtime, typecheck, test, then package with Electron Builder. Review
and scan the packaged payload before deployment. Consult the root AGENTS.md and
desktop package scripts for exact current commands. Keep the existing app data,
provider login, MCP identities and canonical project paths. Do not copy tokens
from Codex or a browser into this application.

The optional one-shot installer contract is documented in
`docs/adr/installer-setup-contract.md`. It calls normal validated handlers and
does not grant OS privileges. MCP control is local, opt-in and authenticated;
its private bearer metadata must never be printed or committed.

History import requirements and limitations are documented in
`integrations/jarvis/history/README.md`. Runtime data, exports, receipts, native
session stores and account data belong outside the repository.

## Current verified boundary

Managed chat import, existing-provider binding and local MCP project/session
operations are installed and verified. Two-way live voice, wake integration,
initial queue context, global policy changes, and complete Codex connector
parity require separate acceptance evidence. Do not call those features done
because an upstream interface or a settings control exists.
