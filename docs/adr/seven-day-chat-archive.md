# Seven-day inactivity archive

The user requested automatic archival after seven days without activity and
bounded MCP chat listings. This is archival, never transcript/session deletion.

The native Pi renderer applies the policy after sidebar recovery at startup and
every ten hours while available, using a fresh inventory. Running, selected,
voice-bound and drafted sessions are protected. Unknown activity timestamps are
preserved. A manual restore records a fresh inactivity window. The existing
native archive view and its durable sidebar preferences remain authoritative.

External MCP session/list reads those same archive flags, excludes archived
entries by default, and returns 50 sessions with total/nextOffset pagination.
An optional query supports limit (1-100), offset, includeArchived and bounded
title search. session/get and session/open continue to address saved histories
by ID. Plugin/internal full inventories retain their prior behavior.

Codex and ChatGPT archival uses the app's native recurring automation and
set_thread_archived. Its every-ten-hour pass rechecks actual last-activity
metadata and preserves running/unknown chats. It never deletes or imports
histories or clears the shared Jarvis queue.

Validation covers the strict seven-day boundary, protected and restored items,
native preference persistence, bounded pages and explicit archive searches.
scripts/e2e-inactive-chat-archive.mjs boots the built Main/renderer/MCP and real
Host in a private empty profile, verifies automatic archival, retains a recent
chat and reads/opens the archived history. Only fixture timestamps are seeded;
no real account, conversation, database or desktop input is used by that test.
