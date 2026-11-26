# ADR codex-shared-chat-owner: One native owner for linked chats

- Status: Implemented candidate, Windows installed acceptance passed 2026-11-26
- Date: 2026-11-25

## Context

Copying two transcripts cannot let users continue one conversation coherently.
Codex and Pi have different execution engines, identities and approval systems.

## Decision

An explicitly enabled Windows installation connects Pi Main and Codex Desktop
to one pinned native Codex app-server over authenticated loopback WebSocket.
Codex owns linked history, execution, model selection and native tool decisions.
Pi uses the existing backend router and shared `SessionSource = "codex"` contract
for a transient view. Renderer and native MCP calls use the same routing seam.
There is no second Pi agent loop for these chats and no direct SQLite access.

Unbound local IDs retain local behavior. Only exact registered aliases may route
a local Pi ID externally. One-time ingestion reads full history through its
actual owner. Verified importer provenance plus an identical message prefix
can reconnect an original Codex ID. Divergent history becomes a labeled Pi
continuation. Original Pi records remain preserved. Fresh import files are
published atomically before native loading and are never edited afterwards.

Calls, scheduled jobs, busy or read-only sessions and Jarvis coordinators keep
their existing owners. Unsupported actions fail closed. Native command/file
approvals and input questions require actual user decisions. Desktop-owned
dynamic tools retain their actual parameters and result through the private
Desktop relay. Unknown outcomes are never automatically resubmitted.

## Consequences

The integration is opt-in, has no host schema migration and defaults off without
its private local configuration. Linked Pi chats use Codex tools and native
model policy. Existing Codex chats retain their model. New imports request
GPT-6.1 Sol and priority service. Local model settings, attachments, destructive
history edits and advanced native request variants are capability-limited.
Pi retains original local project grouping. A closed client does not stop the
owner or other clients' work. Installation defers until old app processes exit.

## Alternatives

Dual execution engines and continuously rewritten history files were rejected:
they create competing ownership and cannot preserve native tool/approval state.
