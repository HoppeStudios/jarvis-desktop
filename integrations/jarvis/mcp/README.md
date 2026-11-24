# PI-Desktop stdio MCP adapter

Requirements: Python 3.11+, the reviewed running PI-Desktop installation, and its
explicit `PI_DESKTOP_MCP_CONTROL=1` startup setting. No extra Python packages or
API key are required. Existing ChatGPT/provider login stays in the desktop.

Register a pinned, reviewed local copy as an MCP stdio server with the existing
Python interpreter as `command` and the absolute `stdio.py` path as its argument.
The adapter reads `~/.pi-desktop/mcp-control.json` privately and connects only to
its active HTTP `127.0.0.1:<port>/mcp` endpoint. Redirects and system HTTP proxies
are disabled for this loopback transport. Never publish that metadata file.

```powershell
python integrations/jarvis/mcp/stdio.py
python -m unittest discover -s integrations/jarvis/mcp -p 'test_*.py'
```

It preserves the desktop's tools, argument schemas, errors, confirmations and
permission checks. Use `pi_control_describe` to discover actual operations, then
the named tools or `pi_desktop_invoke`. It neither launches a second application
nor converts refusals into another path. Closing stdio closes its HTTP session.
The desktop must be running; this is a local control bridge, not a remote service.

`settings/configureGeneral` accepts a bounded patch of existing provider/model
selection, builtin Agent/Plan default, permission preference, update preference,
codemode and background-continuation preferences. It requires `confirm: true`,
an agent acknowledgement. It invokes normal settings validation and active-call
guards and returns persisted readback. Raw settings, credentials, OAuth, voice
bindings, network policy and computer-use grants are outside that operation.
`auto` is the desktop's current-user permission preference, not elevation or a
way around an MCP server's own policy or an enforced host/service approval.

`voice/status` reads current Live state, sticky user presence and pending startup.
`voice/control` takes `request` with a unique UUID `requestId`, `action`
(`start`, `toggle`, `end`), optional `freshCoordinator`, `workSessionId`,
`initialMuted` and `expectedCallId`. It requires `confirm: true`. Fresh coordinator
and an explicit work session are mutually exclusive. Reuse a request ID only for
the same retry; distinct toggles turn on/off, including cancellation during start.
Starts require local Jarvis opt-in. Microphone stays muted unless explicitly
requested otherwise. End may be bound to the expected call ID; media-release
failures are errors, never a reported successful shutdown. The selected native
account/voice and independent permissions remain unchanged. This does not yet
install a wake listener or prove spoken wake recognition.

Optional `presenceGreeting: true` requests the fixed presence question after a
connection. Its result separately reports `greetingPlayed` and, on verified
playback completion, `greetingFinishedAt`. Unconfirmed playback is not a successful
invitation and must not start an unanswered-response timer. It keeps the selected
voice and does not insert a fake user turn. Compatibility of the fixed native
session-context channel with the Codex Live endpoint remains an installed
acceptance gate; the public Realtime response-creation event is not used.
Secret-free `greetingEvidence` separates provider readiness, request delivery,
transcript matching, measured audio, context state and completion. No transcript
text or credentials enter this diagnostic receipt. The invitation waits for the
native provider's session-start event, not just an open WebRTC channel.

Automatic fresh greetings may also set `presenceTimeoutSeconds` (5–60,
default ten). A timed-out helper may request `cleanupUnanswered: true` only on
`end` with its exact `expectedCallId`. Main independently verifies the
monotonic deadline, owned session/call, sticky absence of user input and confirmed
media release, then obtains renderer readiness and Rust conditional empty-data
deletion. `coordinatorCleanup` reports `deleted` or `deferred`; missing or
uncertain state never authorizes deletion. Manual/selected/drafted/active chats
and the persistent Inbox are untouched. Startup cancellation still returns its
actual `coordinatorSessionId` but never authorizes deletion by itself.

`wake` ensures on without replacing/unmuting an existing call; `new-chat` ends the
current call and waits for confirmed release before creating the next. A wake
listener can attach a persistent UUID `intentId` and increasing integer
`intentSequence` to desired-state wake/end requests. Delayed older workers return
`superseded` instead of reopening voice after a newer off command. Ordering fields
carry no additional permission and do not bypass normal call/owner guards.

`settings/openJarvis` requests the existing native Live settings page without
focusing/restoring the window. Its receipt confirms command delivery; inspect the
rendered page separately before claiming visibility.

`app/composerDraftStatus` returns fresh counts for inactive cached drafts,
unsaved live editors, busy/unknown readers and pending prefills, without text
or attachment paths. Unknown/timeout state is never empty. This is a read-only
observation, not a lease permitting an updater to close the app; active work,
calls and concurrent input require separate guards. Older clients do not expose
this operation, so their first restart still needs an actual draft-state check.
