---
name: jarvis-pi-switch-chat
description: Match approximate chat/project names in Pi Desktop and open an existing chat, or use a genuinely exposed Live target-switch operation when the user explicitly wants its voice context.
---

# Pi chat selection

Interpret natural requests in any language. Reuse an unambiguous recent session ID;
otherwise prefer discovered `pi_session_find` / `session/find` with the approximate
spoken title. It searches one native metadata inventory, without paging or reading
messages. Use `includeArchived: true` for an older named chat and optional `project`
to disambiguate project folders. A `matched` result supplies the actual Pi ID and
source namespace; an `ambiguous` result needs one short clarification. Never open
the first candidate merely because it is ranked first. Search alone does not open
a chat, create work or move voice.

For an explicitly requested original Codex chat, set `owner: "codex"`. This uses
actual native owner namespaces or the bridge's verified bound-view references.
Unbound imported history is not treated as the original. Retain the actual returned
Pi view ID even when the original owner has a different native thread ID.
Without that scope, identical unbound imported/native titles remain ambiguous;
never infer identity or deduplicate them merely from title/project similarity.

If that operation is absent, read Pi-Desktop `session/list` and match meaning/title approximately,
ignoring accents, case and small speech errors. Ask one short question for a real
ambiguity. Do not create a duplicate or read whole transcripts for a clear title.

Session lists are paginated and exclude archives by default. Use the actual
`session/list` query with `search` and `includeArchived: true` for an older named
chat, and follow `nextOffset` before declaring a miss. Archive search retrieves
metadata without restoring, deleting or duplicating the history. Retain the
exact returned ID when opening the existing chat.

In text, `session/open` navigates the existing chat through the native MCP. In an
active Live call, inspect the real app-supported target-switch operations. Use a
supported target-selection path and verify its actual work binding; do not hang up
first. If no such control is exposed, keep the coordinator connected and explain
that navigation alone does not transfer voice. The existing Live session selector
may be used when actually available. Never invent Codex `transfer_voice_call` in Pi,
interrupt background work, submit a draft or substitute a new voice/account.
