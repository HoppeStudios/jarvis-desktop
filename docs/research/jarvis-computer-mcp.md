# Jarvis computer-control MCP comparison

Reviewed primary project documentation on 2026-11-27. This compares capabilities,
not an assertion that uninstalled packages are malware-free or faster locally.

| Project | Relevant capability | Decision for this installation |
| --- | --- | --- |
| [PC-Control](https://github.com/VortexJer/PC-Control) | Background Windows controls, filtered reads and up to 12 steps in one round trip | Retain the reviewed pinned local fork and isolation policies; use batching and focused reads |
| [Mozilla Firefox MCP](https://github.com/mozilla/firefox-mcp) | Firefox page browsing/debugging | Reuse the installed dedicated headless profile; preserve separate manual profile/login ownership |
| [Chrome DevTools MCP](https://github.com/ChromeDevTools/chrome-devtools-mcp) | Native browser DevTools automation | Reuse the pinned isolated Brave registration for Chromium tasks |
| [Microsoft Playwright MCP](https://github.com/microsoft/playwright-mcp) | Structured accessibility snapshots, targeted snapshot search and browser automation | Useful alternative, but no demonstrated gap warrants a duplicate browser installation yet |
| [winauto-mcp](https://github.com/PingPong2534/winauto-mcp) | UIA background actions and explicit foreground batches | Possible compatibility alternative; foreground_steps/takeover gestures do not match the current background-only default |
| [Microsoft Hybrid Computer Use](https://github.com/microsoft/Hybrid-Computer-Use) | Accessibility, programmatic and visual controls on Windows/macOS/Linux | Documentation explicitly says it emits real input to the signed-in desktop; evaluate only in a separately authorized isolated environment |

The concrete local failure was an inactive Pi MCP endpoint after an ordinary
executable launch: the launcher-only environment opt-in was absent. Another
general GUI server would not repair that native chat interface. The implementation
therefore fixes native startup policy and adds single-read approximate chat search,
while the shared routing skill chooses native service APIs before GUI automation.

Existing Codex-Index measured approximately 6 ms for a read-only health query in
this task; that is local saved metadata only, not remote availability or live
status. Pi native latency was initially unavailable while its endpoint was inactive.
The concurrent persistent-control fix restored it; five native substring-search
calls took 137–146 ms each. The old search returned both imported history and
original Codex chats with the same title. New explicit native-owner scope preserves
those distinct identities rather than deduplicating by title. Reordered complete
title words count as equivalent; genuine near-name alternatives stay ambiguous.

A live isolated Character Map check executed four background actions in one
PC-Control steps call in 3.4 seconds: enable Advanced View, verify its Unicode /
search controls, disable it and close the owned test window. Effects were returned
through BM_CLICK/UIA, with no global input or clipboard operation requested. This
is bounded fixture coverage, not universal app compatibility or a speedup claim.
Record post-deployment native find timings before claiming end-to-end voice latency.

## Installed acceptance

The final installed native lookup measured 109.8–133.4 ms across five requests
(median 114.6 ms). The former full-inventory route required six pages for 593
metadata rows and took 748 ms. This compares native metadata workflows, not total
spoken-command latency or an already-known exact-title substring lookup.

The installed named MCP tool and stale-catalog CLI both returned the actual
requested native chat. Native open returned its verified view receipt in 315.8 ms;
the target title and conversation were separately observed in the background Pi
window. The existing connected call retained its ID and work binding; foreground
window and clipboard sequence stayed unchanged during that bounded operation.
No work was started in the target. Bound native-owner lookup was verified against
actual linked Pi views, not only synthetic fixtures.

Pi's managed MCP status reported the retained Windows, Firefox, Chromium, local
Codex index and Pi control servers ready; its Pi tools included the new finder.
Selected Live settings and binding, existing listener identity and Startup shortcut
were verified preserved. A new spoken microphone command was not part of this
acceptance; the pinned retained-audio ASR fixture passed separately. No native
voice-context transfer is implied by the verified chat navigation.
