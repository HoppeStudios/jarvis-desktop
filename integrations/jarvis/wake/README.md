# Pi Jarvis wake listener

The Pi fork owns this listener. The independent Codex Mini implementation stays
in `HoppeStudios/jarvis-codex`. One selected backend uses the existing **Jarvis
Wake** Startup shortcut and `Local\JarvisWakeWord` mutex. Do not run two listeners
or install the Codex recipe over a selected Pi runtime.

## Requirements and installation

Use the reviewed Windows x64 desktop build, authenticated native Codex Live
binding, selected voice, Jarvis opt-in and enabled local MCP described in the
[parent requirements](../README.md). Also required:

- Stable PowerShell 7 with Windows `System.Speech`, WinForms and an installed
  recognizer matching the saved culture (currently en-GB).
- Python 3.11+ at an existing pinned executable path, with standard library only.
- The existing `%LOCALAPPDATA%\JarvisWake` settings, icon, registered Inbox and
  SQLite queue. The installer refuses to create a second queue.
- Windows microphone permission, a usable microphone/output device and Windows
  Defender for the reviewed source scan. No Windows TTS, cached greeting, API key
  or new voice account is used by this listener.

From this reviewed source folder, run `install.ps1 -ValidateOnly`, then
`install.ps1`. It checks native Pi call state and the old helper's Codex call
state, validates grammar/presence APIs and scans the payload before replacing
only the task-owned listener. It pins the existing Python/PowerShell, verifies
installed hashes, updates the same Startup shortcut and preserves paused state,
settings and shared queue. No rollback executable or backup copy is created.
An active/unknown call defers installation rather than being interrupted.
After replacement health passes, only the named superseded Codex helper files
and cached greeting are removed, when no process references them. Source history,
the shared queue, settings, icon and compatibility launch helpers remain intact.
Status readers share delete access; atomic writers retry brief Windows sharing
conflicts. A locked status file cannot terminate the wake event loop.

`pi-runtime.json` records selected backend ownership locally. Updaters must
preserve that selection: source synchronization of the other fork is allowed,
installation over the selected backend is not.

The same Startup entry also ensures the pinned desktop is running with local
MCP enabled, without foreground activation. Its saved history-import directory
is passed on every launch so imported chats remain available after reboot. Use
`-ImportDirectory <existing-folder>` for a nondefault import location. The
existing **Pi - Jarvis** and **Jarvis Settings** Start-menu shortcuts point to
the GUI and its native settings rather than the old CLI/settings entry points.

## Behavior

The saved wake names, command groups, confidence, silence and recognizer culture
are retained. A bare wake phrase toggles the desired on/off state; repeated
phrases delivered in one SAPI utterance preserve each toggle. Recognition and
control-file handling continue while owned Python workers await native startup.
Ordered persistent intent sequences stop a delayed older worker from reopening
a newer off request. Starts use a fresh independent Pi coordinator and the
selected native account/voice. End/finish is external and does not depend on GPT.

`control.ps1` retains status/toggle/wake/new-chat/end/disable/resume/reload-settings.
Status is a past verified observation. Disable ends voice and releases wake
capture; resume is explicit. Routine results stay in the tray/status; only errors
notify. Tray **Pi Desktop settings** opens native Jarvis settings. Wake phrase
settings edit the existing configuration with concurrent-change validation.

Automatic invitations require a due queue item, unlocked recently active PC,
enabled notifications, no Pi call/startup, no other active microphone client,
and the persisted cooldown (default 30 minutes). CoreAudio inspection is
read-only and fails closed. Manual calls are independent of that eligibility.
The greeting uses actual native GPT playback. The answer timer starts only after
confirmed playback completion. Actual native user speech/turns or possible local
speech after the echo gate suppress hangup; mouse/keyboard activity never count
as an answer. Interruption never reviews an item or clears the queue.

After verified greeting playback, the timeout requests cleanup only for its
expected call. Main independently verifies its monotonic deadline, provenance,
zero/sticky user presence and confirmed media release. A fresh unselected empty
coordinator can then be deleted through native renderer readiness, session
admission and Rust conditional persistence checks. Selected/edited/drafted,
active, cancelled, manual or uncertain sessions are preserved. The listener
never accesses the session database or marks Inbox reports reviewed. Cross-origin
answer forwarding remains a separate acceptance boundary. This source behavior
still requires idle deployment and installed-client cleanup acceptance.

## Checks

`python -m unittest discover -s . -p 'test_*.py'` checks transport dispatch and
desired-state payload boundaries. `wake.ps1 -RootPath <installed-root> -Check`
checks the real installed recognizer and read-only Windows/CoreAudio interfaces,
without listening or starting a call. `-TestWav <file>` evaluates a local WAV.
`-MutedTestCalls -TestDuration <seconds>` is an explicit bounded acceptance mode;
ordinary Startup does not enable it. Fixture success is not a spoken wake test.

The grammar/settings helpers were ported from the maintained Codex fork and keep
their validation contracts. Private state, requests, receipts, transcripts,
recordings and runtime metadata must not be committed.
