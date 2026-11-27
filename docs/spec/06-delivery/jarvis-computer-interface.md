# Jarvis native interface acceptance

The selected runtime stays Pi Desktop. Concrete spoken/text work can use the same
native service, browser and Windows tools; no extra wake phrase is required while
connected. Tool routing must preserve current browser profiles, Windows isolation,
account/voice, active work, drafts, actual user input and enforced permissions.

`session/find` accepts exactly one query object: query (2–200 normalized characters,
at most 24 words), optional includeArchived boolean, project substring (up to 300
characters), optional `owner: codex` and limit 1–8. Native Codex owner scope uses
the existing verified remote-ID parser and native owner's actual bound-view
references, excluding unbound imported history without guessing identity from
equal titles/projects. Verified nativeOwner references retain host/session/view IDs
and deduplicate only the same proven owner after archive/project filtering.
It performs one native metadata inventory invocation,
preserves existing sidebar archive preferences, returns only IDs/titles/projects /
source namespace/archive flags/scores and distinguishes matched, ambiguous and
not-found. Accents/case/word order and small title typos are tolerated. Multiple
exact names or close approximate candidates never become an arbitrary match.
No results are paginated, cached as live status, read as instructions or opened.

Normal native session/open is a separate authorized operation. A linked native
open returns one-item normal detail with actual canonical Pi view and explicit
requestedSessionId so the gateway can emit real renderer selection. A bare OK is
insufficient. The CLI accepts changed view IDs only with that verified owner and
matching request receipt; it preserves both identities and never claims voice
transfer or observed UI selection from dispatch alone. Search must never
change calls, submit a draft, create a duplicate, send work or claim voice transfer.
If the new capability is absent, existing native list/search/pagination remain the
fallback. Index misses are not proof that remote or archived chats do not exist.

Startup accepts persisted Jarvis opt-in only when PI_DESKTOP_MCP_CONTROL is absent.
An explicit environment policy wins, including disable. Unavailable settings fail
closed. The same authenticated loopback MCP server and operation restrictions are
used. Changes require reviewed installation and a safe restart; active or unknown
calls/work defer deployment. An inactive connection file is not a live connection.

Validation: fastpath semantic tests, existing MCP authentication/catalog/wiring
tests, application build/typecheck and actual installed capability checks. Record
native latency separately from synthetic matcher time and do not claim faster
human voice interaction from fixture timing alone. A live acceptance pass needs
the installed tool, actual target identity and observed intended state, with no
foreground/input/clipboard takeover or unrelated task interruption.
