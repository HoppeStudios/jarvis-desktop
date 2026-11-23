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
