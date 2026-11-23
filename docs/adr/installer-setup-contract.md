# Explicit local installation setup

Status: Implemented candidate

## Decision

A launcher may opt into `PI_DESKTOP_INSTALL_SETUP`, naming a one-shot JSON file
with schemaVersion 1, curated non-secret `settings` and `mcpServers`. Settings
are limited to existing provider/model selection, the permission-mode preference,
language and update preference. Provider credentials, live voice bindings,
secrets, header authentication and OAuth data are rejected. Disabled MCP entries
stay deferred. The application invokes the same validated settings and MCP import
handlers as its UI, writes a non-secret success receipt and consumes the file.
A failed setup remains available for inspection and does not claim completion.

This is a local installation contract, not an external MCP operation. Existing
MCP exclusions for settings, provider, OAuth and secret writes remain intact.
It does not bypass operating-system rights, MCP server policies or UI-owned
voice/media authorization. It must only run during a requested installation,
before the new window opens, with no concurrent owner of the same profile.

`PI_DESKTOP_PI_IMPORT_DIR` optionally names a native Pi archive for import only.
It changes neither native continuation roots nor the account store. Historical
Codex tool activity is imported as inert assistant text with source references.
Large media/tool payloads may be represented by references to their original
private archive; those references are not execution authority.
