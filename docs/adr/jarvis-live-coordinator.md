# Jarvis Live coordinator

Status: Implementation candidate

## Decision

Keep Codex Mini's helper in `jarvis-codex` and the Pi Desktop integration in
this fork. The selected desktop OAuth provider and voice remain authoritative.
Jarvis is explicitly enabled in local settings. Its work agents use the user's
GPT-6.1 Sol default, Fast preference and current-user Auto permission mode;
permission mode never changes OS privileges or independent tool policies.

A Jarvis Live call reads the existing registered Jarvis-Inbox queue before
constructing the provider's initial work profile. This is a bounded, read-only
snapshot containing the saved cursor and one due unresolved question/report.
It is supplied through the adapter's real startup context, not by claiming that
AGENTS.md reached the realtime model. Queue text is data. Loading, greeting or
speaking never acknowledges presence, records an answer or reviews an item.
After an actual answer, the work agent re-reads revisions and uses the queue's
real origin/receipt protocol. Unavailable/oversized context is explicit.

An authenticated local MCP voice-control surface may request the trusted main
renderer to start media. The renderer remains the real owner of microphone,
WebRTC, playback and permission leases. Main never fabricates a renderer event,
injects desktop input, changes voice bindings or focuses a window to start it.
End requests use the existing Main call lifecycle and media-release guards.
Distinct repeated wake requests toggle; retried request IDs are idempotent.
Ending during startup cancels that startup, rather than waiting for GPT.

`freshCoordinator` on a start/toggle creates a separate durable Pi work chat
through normal session IPC before opening Live. It uses the selected Codex
binding's account and preserves the voice. Retries and toggle-off never create
another chat. The selected busy chat and its draft remain untouched. Coordinator
instructions live in the task-owned workspace and preserve user edits on upgrade.
Its routine effort is `low`, the actual lowest supported GPT-6.1 Sol level.

When Jarvis is enabled, normal session creation/configuration pins the coding
model to GPT-6.1 Sol and stores Fast on, retaining an explicitly selected account
and permission mode. New work defaults to medium; effort remains configurable.
The runtime requests Fast only when the model advertises support; priority is a
request, not a promise of server latency. Disabling Jarvis restores ordinary
session configuration behavior. The native Live settings page exposes Jarvis
opt-in, initial queue loading, and separate coordinator start/end controls.

The Pi wake installation replaces the existing task-owned wake registration
only after acceptance. The persistent queue is shared and never expires.
Automatic invitations wait for no current call and keep a persistent checklist;
neither silence nor interruption completes queue work. Browser playback or
microphone permission failures remain visible errors, without a silent fallback
to another voice, global input or a weakened browser policy.

## Validation boundary

Unit/fixture checks establish profile construction, transport, cancellation,
scope and persistence contracts. Actual provider connection, selected voice
playback, microphone and double-wake behavior require installed-client evidence.
Do not call navigation a voice transfer or import a live execution state.

An optional fixed presence greeting is requested only after the call connects.
The first implementation probes the documented Realtime `response.create` event
on the selected Codex Live data channel; private-endpoint compatibility requires
actual installed evidence. It does not add a fake human turn, change voice/model
or overwrite the session's queue instructions. A successful send is unconfirmed:
`greetingPlayed` requires the matching assistant transcript, measured running
AudioContext remote signal, provider turn completion and drained playback. The
finished timestamp can start the unanswered-invitation window. Suspended audio,
timeout, cancellation or a rejected protocol event never count as playback.
