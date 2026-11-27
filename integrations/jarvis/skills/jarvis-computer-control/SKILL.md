---
name: jarvis-computer-control
description: Route a concrete Jarvis voice or text request to native chat, service, browser or background Windows tools with few round trips and verified effects.
---

# Jarvis computer interface

Choose the tool that owns the requested state. Preserve the full user request and
literal clarifications. Another wake name is unnecessary during a connected call.

| Requested state | Preferred route |
| --- | --- |
| Pi chat names, projects, opening a chat | `jarvis-pi-switch-chat`; prefer native `session/find`, then `session/open` with its exact returned ID |
| Working/finished/waiting chats | `jarvis-pi-status`; native current status and Inbox, not title timestamps |
| User questions and reports | `jarvis-pi-queue`; actual origin and successful answer-delivery receipt |
| GitHub, mail, calendar or another connected service | The service's own connector/API when it covers the actual operation |
| Firefox web pages | Registered `firefox_existing` dedicated profile; close the MCP-owned session afterward |
| Chromium web pages | Registered `chromium_browser` isolated profile; do not assume it shares logins |
| Native Windows controls | Read the installed `pc-control` skill, then use pinned PC-Control background UIA/app APIs |
| Codex Desktop window controls | Native chat tools first; guarded `codex_desktop` or Codex-Window only for supported app controls |

Keep discovery cheap: use one filtered accessibility read of the actual target,
then one bounded `steps` batch for independent, already-observed controls in that
window. Keep dependent decisions sequential. Read document contents with `read`
instead of repeated scrolling. Use a screenshot only when text/UIA is insufficient.
Verify the actual effect; a dispatched request is not a completed action.

PC-Control's existing app isolation, identity checks, secret-field restrictions and
refusals remain authoritative. Do not silently fall back to global input, clipboard
or foreground takeover. Respect different browser profiles and existing drafts.
Sending messages or other consequential actions still need the actual task authority.

Pi and Codex IDs are different namespaces. Navigation is not voice transfer.
Preserve existing calls and selected account/voice. Never start another CLI agent
merely to make it appear that the visible Desktop chat was controlled.

An unavailable Pi MCP endpoint is a capability problem, not proof that no chat
exists. Inspect the current private endpoint metadata through the installed adapter
without printing credentials. Use a fresh connection with the registered adapter
for a stale tool catalog; a real permission refusal stays final. An inactive endpoint
must be restored through reviewed startup/configuration, not another app-control
path. Do not interrupt active work to reload the application.

For a stale catalog, `scripts/chat.py` uses the already installed authenticated
Pi adapter directly. Run it with the Python interpreter in the selected runtime's
pi-runtime.json. `chat.py find "approximate title" --owner codex --include-archived`
reads metadata. `chat.py open ACTUAL_PI_ID` requests navigation only when the user
asked to open that chat. It neither transfers voice nor submits work. The open
receipt explicitly leaves UI selection unverified; inspect the actual app if that
distinction matters. Unknown capabilities or real refusals stop without a fallback.
