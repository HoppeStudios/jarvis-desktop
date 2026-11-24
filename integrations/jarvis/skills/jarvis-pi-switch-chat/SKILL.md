---
name: jarvis-pi-switch-chat
description: Match approximate chat/project names in Pi Desktop and open an existing chat, or use a genuinely exposed Live target-switch operation when the user explicitly wants its voice context.
---

# Pi chat selection

Interpret natural requests in any language. Reuse an unambiguous recent session ID;
otherwise read Pi-Desktop `session/list` and match meaning/title approximately,
ignoring accents, case and small speech errors. Ask one short question for a real
ambiguity. Do not create a duplicate or read whole transcripts for a clear title.

In text, `session/open` navigates the existing chat through the native MCP. In an
active Live call, inspect the real app-supported target-switch operations. Use a
supported target-selection path and verify its actual work binding; do not hang up
first. If no such control is exposed, keep the coordinator connected and explain
that navigation alone does not transfer voice. The existing Live session selector
may be used when actually available. Never invent Codex `transfer_voice_call` in Pi,
interrupt background work, submit a draft or substitute a new voice/account.
