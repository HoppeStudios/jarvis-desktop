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

Managed Pi runtime events feed the shared Inbox without a second model call.
The real `asktool_request` becomes authoritative in Agent Host first; its card
waits for the bounded queue write. Capture failure still delivers the question
and produces a rate-limited error toast plus secret-free status/log metadata.
Permissions are separate events and never become ordinary queued questions.
Live/Composer answer hooks run only after an explicit native success receipt;
they match the exact source request and unchanged question wording/options,
retain revisions and record only nonempty actual replies. Null/cancellation is
not an answer. The native queue producer may race a skill receipt; re-read state
instead of resending the human answer.

Only an observed live start followed by a completed root assistant reply and
terminal event produces a turn report. Imported history, streamed partials,
delegate output, model reasoning and raw provider diagnostics are excluded.
Long replies are explicitly excerpted at both ends, not called new summaries.
Fresh Jarvis coordinator-workspace housekeeping is excluded. These observers do
not replay old history, manufacture human input or prove overall task success.

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

Scheduled maintenance is controlled through the same authenticated MCP gateway
and normal Host handlers as the native Scheduled workspace. Reads include actual
run receipts; create/update/delete/execute require explicit operator acknowledgement.
Execution uses the regular Agent pipeline, not the ledger-only `scheduled.run`.
To migrate the single existing maintenance job, stage it disabled, validate the
native execution path, pause its old registration, then enable the new task.
Use an elapsed 600-minute interval for ten hours rather than a clock-hour cron.
The Scheduled workspace's existing ten-second refresh reflects external edits.
Jarvis opt-in persists Fast on fresh and reused scheduled sessions as well as
interactive sessions. Ordinary scheduled sessions retain ADR 0334's default-off
behavior; the selected model's runtime capability gate remains authoritative.

Unit/fixture checks establish profile construction, transport, cancellation,
scope and persistence contracts. Actual provider connection, selected voice
playback, microphone and double-wake behavior require installed-client evidence.
Do not call navigation a voice transfer or import a live execution state.

An optional fixed presence greeting is requested only after the call connects.
It uses Codex's native frameless `session.context.append` speakable channel,
as defined in the [official wire adapter](https://github.com/openai/codex/blob/main/codex-rs/codex-api/src/endpoint/realtime_websocket/methods_common.rs).
The public Realtime `response.create` probe was rejected with a protocol error;
it is not a fallback or retried request. Installed acceptance must verify the
native channel. It does not add a fake human turn, change voice/model
or overwrite the session's queue instructions. A successful send is unconfirmed:
`greetingPlayed` requires the matching assistant transcript, measured running
AudioContext remote signal, provider turn completion and drained playback. The
finished timestamp can start the unanswered-invitation window. Suspended audio,
timeout, cancellation or a rejected protocol event never count as playback.

Codex AVAS transcript chunks carry `item.text`; authoritative finals arrive in
`turn.done` with `turn.role` and `turn.transcript`. Preserve chunk boundaries and
one utterance identity, replace partial text with the final, and count only actual
final user turns as answers. Partial user speech still records sticky presence.

Playback monitoring uses a silent AudioWorklet branch from the remote
MediaStream. HTML audio remains the sole audible output. The audio clock emits
only bounded activity flags; no samples are retained or sent to Main. This avoids
MediaElement analyser silence and background-window animation-frame throttling.
Only running-context measured signal counts as playback. Suspended/failed
monitoring stays conservative, without relaxing autoplay or foreground policies.
Both worklets must be emitted as external assets (`?url&no-inline`): a small
processor would otherwise become a data URL, which the packaged script policy
correctly refuses. `scripts/e2e-jarvis-assets.mjs` checks the real built output.

The Pi wake listener uses independent owned background workers, retaining the
SAPI event loop while native media starts. It folds repeated wake events into
desired state and persists one intent identity/increasing sequence before
dispatch. Main rejects delayed older intents. Queue polls cannot overwrite a
newer in-flight desired state. Read-only CoreAudio capture ownership defers
automatic invitations while another client is active; manual voice commands
remain explicit user actions. Paused recognition and queue state survive updates.
Native settings navigation reveals the window with `showInactive`, never the
widget path that transfers foreground. Receipt visibility is not rendered-page
proof. The separate wake-settings form also avoids activation on initial show.
