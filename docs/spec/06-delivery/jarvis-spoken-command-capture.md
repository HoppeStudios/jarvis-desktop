# Jarvis complete spoken commands

The explicit user choice is to capture and submit the complete command following
the wake phrase. The selected runtime remains Pi Desktop. This optional local
feature does not replace the Codex Mini fork, the shared Inbox, credentials,
selected Live binding/voice, external ending commands or application permissions.
The user's direct correction preserves the selected native Codex Live voice.
Windows reply synthesis is removed. Capturing the full command and selecting its
reply voice are separate decisions; the former does not authorize changing the
latter. Bare wake retains its existing Pi Live toggle behavior.

The SAPI wake recognizer loads a lower-priority wake-plus-wildcard grammar. Its
`RecognizedAudio` retains the complete addressed utterance, including speech before
the recognized event. Exact control/repeated-wake/negation grammars keep priority.
Only idle, unpaused, confident addressed utterances enter local ASR. The helper
rejects captures beyond 30 seconds. Configurable end silence defaults to 900 ms.
This increases idle bare-wake endpoint latency compared with a shorter configured
control-only silence. It does not run continuous full-speech ASR on ambient speech.

ASR reuses the locked transcribe-cpp 0.2.2/FFI implementation and the installed
reviewed native Pi library, with three CPU threads. The multilingual Whisper Small
Q5_1 model is pinned to whisper.cpp model repository revision
`5359861c739e955e79d9a303bcbc70fb988958b1`, SHA-256
`ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb`.
No new voice account, cloud transcription service or API key is required.
Each on-demand worker verifies the copied JS/FFI artifacts, native dependencies
and model. Dependency changes fail closed until reviewed/re-pinned. The default
transcription language is Czech; English and automatic detection are selectable.
This does not add a Czech SAPI wake engine: wake names must still suit the saved
installed recognizer. Additional transcription spellings are explicit settings.

The transcriber confirms a leading configured wake spelling, removes only that
prefix and an optional exact terminal phrase, and retains the command text.
Empty, missing-prefix, malformed, oversized, aborted or truncated results are not
submitted. Recordings/transcripts are private transient worker files, deleted by
normal job completion; an abnormal process exit can leave private job files.
Never add these files, model weights, runtime paths or account state to Git.

Successful capture creates a normal native work session in the configured existing
task directory. The already installed shared Codex adapter must be enabled. Native
open/get must identify the actual destination as `source: codex` on `codex-shared`
before normal `agent/prompt` receives any text. A Pi-only provider is not silently
substituted. A Pi alias is used only through Pi's native routing; it is never passed
as a Codex thread ID. No credential/capability copy, direct database mutation or
independent CLI execution is used. Account/model and permission handling remain
with the reviewed shared owner. An accepted real turn ID proves admission only.

Text admission and completion can be inspected through the native shared owner.
The helper never creates a Windows speech synthesizer or substitutes a local
voice. The selected native Live voice/account and existing queue workflow remain
unchanged. A native call opened with an existing work session has an empty call
operation ledger; it cannot automatically speak a task submitted beforehand via
external agent/prompt. The current reviewed control plane exposes no general
native speak-result or append-user-text operation. Automatic native reading of
these captured tasks therefore remains unimplemented until the application adds
an explicit task-adoption/result-delivery contract. Navigation or opening a call
is not reported as successful native result speech.

Answer handoff preserves the literal reply separately from any normalization,
scopes ordinals to the current question and keeps contradictory clarifications
unresolved. Older bundled options cannot override newer direct voice preferences.

Pause/Disable, ending, a newer intent, disabling capture or another active call
cancel pending transcription. Bare wake remains an on/off toggle; a second wake
while transcription is pending cancels it through the existing ordered intent.
Only the owned ASR child can be terminated at cancellation or its 45-second bound.
Before native mutation the worker claims a private at-most-once ledger entry.
Uncertain admission is never automatically resent. A failure is visible and may
require inspecting the originating session before a deliberate retry.

Installation uses `capture-install.ps1`, a reviewed narrow integration over the
selected helper. It preserves newer installed audio recovery, call sounds, native
settings changes and the same Startup shortcut. Active/unknown voice and concurrent
source/settings/user intent changes defer replacement. Paused state and listener
identity are verified after restart. No desktop restart or rollback install occurs.

## Acceptance

- `node --test integrations/jarvis/wake/test-capture.mjs`
- `python -m unittest discover -s integrations/jarvis/wake -p 'test_*.py'`
- `pwsh -NoProfile -File integrations/jarvis/wake/test-capture.ps1`
- Existing ending-confidence and invitation regression scripts.
- File-only native SAPI fixture with both exact and wildcard grammars; transcribe
  the actual retained `RecognizedAudio`, not merely its original WAV.
- Installer `-ValidateOnly`, then reviewed idle installation and read-only native
  settings/call/listener/Startup verification.
- Human acceptance: speak a Czech full command immediately after the wake; confirm
  its exact text/accepted turn in the actual Codex-owned session, Windows voice preservation, ending,
  rapid repeated wake, Pause and active-call protection. Do not start an unsolicited
  live call merely to claim this gate passed. File-rendered Windows speech is not
  a human listening test.

Synthetic fixtures and mocked admission do not establish Czech microphone
accuracy, acoustic false-positive rates or live native task completion.
The installed Czech ASR fixture retained the full task. Its Jakub-synthesized
English wake scored below the current SAPI confidence gate, so it does not count
as a production wake acceptance pass. The existing en-GB wake threshold was not
lowered to make that fixture pass.
