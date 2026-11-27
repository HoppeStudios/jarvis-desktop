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

Optional [complete spoken commands](../../../docs/spec/06-delivery/jarvis-spoken-command-capture.md)
retain the addressed utterance and transcribe it locally after the wake. They
submit actual text through the installed shared adapter to a verified Codex-owned
chat. Windows reads its completed reply after other calls end; no native call is
opened for a captured command. The saved Pi Live voice/account remain unchanged.
Enable through the reviewed `capture-install.ps1`
with a locally prepared, hash-pinned runtime config; no account data belongs in
that source repository. Tray settings then expose capture, language, silence,
transcription spellings and optional final words. Local ASR runs only on addressed
idle commands, with a 30-second capture cap and a 45-second worker bound.

The model is [Whisper Small Q5_1](https://huggingface.co/ggerganov/whisper.cpp/tree/5359861c739e955e79d9a303bcbc70fb988958b1)
(MIT); transcription reuses [transcribe.cpp](https://github.com/handy-computer/transcribe.cpp)
0.2.2 (MIT) already locked by Pi. Keep the model's and runtime's license/credits.
The model is about 190 MB on disk. Cold ASR adds latency and temporary CPU/RAM
use; increasing endpoint silence also delays bare wakes while capture is enabled.

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

An invitation is retained while its exact End request is in flight. If Main
positively reports a still-pending deadline, the listener waits for a fresh
matching call/intent poll before trying again with a new request identity. It
never resets the original measured greeting time or duplicates in-flight ends.
Actual/possible local speech, manual end/disable/newer intent, End errors and
generic refusals cancel retry; a late receipt cannot recreate a cancelled
invitation. Deploy the reviewed Main and listener together: older, unmarked
receipts deliberately fail closed instead of being guessed retryable.

## Checks

`pwsh -NoProfile -NonInteractive -File test-invitation.ps1` runs the pure
invitation/receipt and actual dispatch-function tests, without starting a
recognizer, worker process or call. From the repository root,
`node --test apps/desktop/test/jarvis-invitation-deadline.test.mjs` spans the real
Main result and PowerShell fold, including the two-clock deadline race.

`python -m unittest discover -s . -p 'test_*.py'` checks transport dispatch and
desired-state payload boundaries. `wake.ps1 -RootPath <installed-root> -Check`
checks the real installed recognizer and read-only Windows/CoreAudio interfaces,
without listening or starting a call. `-TestWav <file>` evaluates a local WAV.
`-MutedTestCalls -TestDuration <seconds>` is an explicit bounded acceptance mode;
ordinary Startup does not enable it. Fixture success is not a spoken wake test.

The grammar/settings helpers were ported from the maintained Codex fork and keep
their validation contracts. Private state, requests, receipts, transcripts,
recordings and runtime metadata must not be committed.

### Call-ending recognition confidence

Wake activation retains `minimumConfidence`. Speech that would end an active
call (including a toggle or replacement conversation) also requires
`endingMinimumConfidence`, default `0.8`. This separately adjustable threshold
rejects weak closing hypotheses without reducing idle wake sensitivity. Explicit
control/tray commands are unaffected. Recognition audit records the hypothesis
and accepted action separately; a rejected hypothesis does not change the call.

Run `test-ending-confidence.ps1` with the installed PowerShell runtime for the
low-confidence end regression and clear toggle/ensure-on checks.
