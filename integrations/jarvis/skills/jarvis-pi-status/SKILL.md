---
name: jarvis-pi-status
description: Brief current Pi Desktop working chats, recent verified completions and pending user input for requests such as status, update me or co se děje. Read only.
---

# Pi activity briefing

Use the Pi-Desktop MCP's actual operation descriptors. Read `session/list` for
real `runningSessionIds`, `agent/pendingInteractive` for questions/permissions and
the available notification/result records for completed work. Cross-check the
persistent Jarvis-Inbox pending reports/questions when available. Never use title
index or updatedAt timestamps alone as proof of running/finished execution.

Summarize working, recently verified finished, and waiting for input in the user's
language. Name the chat and concrete result/blocker concisely. Distinguish a tool
permission from an ordinary question. State unavailable status rather than inventing
it. Do not dispatch work, answer forms, change calls or mark queue reports reviewed
merely because the user requested status.
