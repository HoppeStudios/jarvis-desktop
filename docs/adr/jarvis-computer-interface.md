# Jarvis native computer interface and approximate chat lookup

Status: Implementation candidate

Explicit workspace chat creation is work for the connected coordinator Agent,
which already has the native project/session MCP operations. A bound Live
`create-session` classification follows normal independent-task admission with
the complete original request, duplicate-receipt protection and busy-task queue.
It no longer terminates as a panel-only choice. Unbound Live keeps the existing
registered-project selection flow. Creation does not retarget the current call,
start another call, grant permissions or submit a new task to the created chat.

## Decision

Reuse the reviewed native Pi control plane, PC-Control and dedicated Firefox /
Chromium adapters. Add one metadata-only `session/find` MCP operation and named
`pi_session_find` tool. It invokes the ordinary native session inventory once,
ranks normalized titles using the existing conservative Codex resolver strategy,
and returns at most eight candidates with actual source namespaces. No transcript,
navigation, live status, task execution or call mutation is included. Archived
history is opt-in and current sidebar archive preferences remain authoritative.
Ambiguous matches are explicit. A caller opens a chosen ID through the existing
session/open action, preserving its normal owner and renderer synchronization.
An explicit Codex owner scope filters through the existing native ID parser;
imported Pi history is not assumed to be the original based on a matching title
or project path. A bound Pi view carries the bridge's verified `nativeOwner`
reference, including its canonical event/navigation view ID. Search can recognize
and deduplicate that actual owner without hiding unbound snapshot histories or
losing archived/project-filtered views. Reordered complete title terms are equivalent. Extra unrelated
title words are penalized for approximate matches; genuine alternatives remain
ambiguous. No title-based history merging or deletion occurs.

Native Codex session/open must return a normal bounded SessionDetail and explicit
requested identity, not a bare OK. The ordinary gateway then emits selection for
the actual returned canonical view. This repairs the observed missing renderer
navigation while retaining native history ownership. Open reads one latest item;
search still reads metadata only. CLI receipts retain both identities and never
substitute a native thread ID for a Pi view ID. A dispatch receipt still does not
prove observed UI selection or voice transfer.

The concurrent installed persistent-control fix (04bc02f18) is preserved, including
its startup policy, diagnostics and tests; this integration reuses that policy
rather than maintaining a second startup implementation.

Ordinary executable launches previously omitted the environment-only MCP startup
flag and left Jarvis's authenticated endpoint inactive. Persisted explicit Jarvis
enablement now permits that same loopback server at startup when the environment
does not specify a policy. Explicit environment values retain precedence: 1 enables;
0 or an unrecognized explicit value disables. Missing/unreadable settings default
off. Tokens, loopback/origin checks, reviewed operation catalog, independent
permissions and current-user boundaries are unchanged. This is a startup policy,
not a claim that changing AGENTS or a running process's environment enables it.

The installed computer-routing skill selects the state owner and bounded batch
operations. Installing redundant desktop servers is deferred until a measured
capability gap justifies their dependencies and input behavior. See the research
comparison and the native-interface acceptance scenario.
