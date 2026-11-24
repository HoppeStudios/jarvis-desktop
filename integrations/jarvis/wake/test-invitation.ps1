param([switch]$Fold)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'invitation.ps1')

# JSON bridge for the Node contract test; only public fixture state crosses stdin.
if ($Fold) {
    $data = [Console]::In.ReadToEnd() | ConvertFrom-Json -AsHashtable
    $value = switch ($data.operation) {
        'create' { New-JarvisInvitationState $data.request $data.result ([datetime]$data.now) $data.timeoutSeconds }
        'poll' { Get-JarvisInvitationPoll $data.invitation $data.call $data.intentId $data.intentSequence $data.pollSequence ([datetime]$data.pollStarted) ([datetime]$data.now) ([datetime]$data.lastSpeech) $data.paused $data.voicePending }
        'attempt' { Start-JarvisInvitationEndAttempt $data.invitation $data.request }
        'receipt' { Complete-JarvisInvitationEndAttempt $data.invitation $data.request $data.response $data.intentId $data.intentSequence ([datetime]$data.now) ([datetime]$data.lastSpeech) $data.paused }
        default { throw 'Unknown fixture fold operation.' }
    }
    ConvertTo-Json -InputObject $value -Depth 12 -Compress
    exit
}

function Assert-Invitation($Condition, [string]$Message) {
    if (-not $Condition) { throw $Message }
}
function New-InvitationFixture {
    $now = [datetime]'2026-01-01T00:00:00Z'
    $request = @{ requestId = 'start'; intentId = 'intent'; intentSequence = 1 }
    $result = @{ requestId = 'start'; state = 'connected'; callId = 'call'; coordinatorSessionId = 'coordinator'
        greetingPlayed = $true; greetingFinishedAt = ([DateTimeOffset]$now.AddMilliseconds(-200)).ToUnixTimeMilliseconds() }
    $state = New-JarvisInvitationState $request $result $now 10
    $call = @{ callId = 'call'; phase = 'connected'; userSpeaking = $false; userTurnCount = 0
        workBinding = @{ workSessionId = 'coordinator' } }
    $end = @{ requestId = 'end-1'; action = 'end'; intentId = 'intent'; intentSequence = 2
        expectedCallId = 'call'; cleanupUnanswered = $true }
    $response = @{ ok = $true; result = @{ requestId = 'end-1'; state = 'already-on'; callId = 'call'
        coordinatorCleanup = 'deferred'; invitationDeadlinePending = $true } }
    return @{ now = $now; state = $state; call = $call; request = $end; response = $response }
}
$quiet = [datetime]::MinValue
$f = New-InvitationFixture
$decision = Get-JarvisInvitationPoll $f.state $f.call intent 1 1 $f.now.AddSeconds(1) $f.now.AddSeconds(10) $quiet $false $false
Assert-Invitation $decision.sendEnd 'The original measured deadline must trigger an attempt.'
$pending = Start-JarvisInvitationEndAttempt $decision.invitation $f.request
Assert-Invitation ($pending.inFlightRequestId -eq 'end-1' -and -not $f.state.inFlightRequestId) 'Attempt identity must be immutable and retained.'
$duplicate = Get-JarvisInvitationPoll $pending $f.call intent 2 2 $f.now.AddSeconds(11) $f.now.AddSeconds(12) $quiet $false $false
Assert-Invitation (-not $duplicate.sendEnd -and $duplicate.invitation) 'An in-flight attempt must not be duplicated.'
$threw = $false
try { $null = Start-JarvisInvitationEndAttempt $pending $f.request } catch { $threw = $true }
Assert-Invitation $threw 'Duplicate attempt admission must fail.'
Write-Output 'PASS original deadline and single in-flight end'

$retry = Complete-JarvisInvitationEndAttempt $pending $f.request $f.response intent 2 $f.now.AddSeconds(12) $quiet $false
Assert-Invitation ($retry -and -not $retry.inFlightRequestId -and $retry.finished -eq $f.state.finished) 'Pending receipt must retain original greeting time.'
$stale = Get-JarvisInvitationPoll $retry $null intent 2 2 $f.now.AddSeconds(11) $f.now.AddSeconds(13) $quiet $false $false
Assert-Invitation (-not $stale.sendEnd -and $stale.invitation) 'A poll begun before the receipt cannot authorize or cancel retry.'
$wrongIntentPoll = Get-JarvisInvitationPoll $retry $f.call intent 2 1 $f.now.AddSeconds(13) $f.now.AddSeconds(14) $quiet $false $false
Assert-Invitation (-not $wrongIntentPoll.sendEnd -and $wrongIntentPoll.invitation) 'A stale poll intent cannot authorize retry.'
$busy = Get-JarvisInvitationPoll $retry $f.call intent 2 2 $f.now.AddSeconds(13) $f.now.AddSeconds(14) $quiet $false $true
Assert-Invitation (-not $busy.sendEnd) 'Another voice worker must block timeout admission.'
$fresh = Get-JarvisInvitationPoll $retry $f.call intent 2 2 $f.now.AddSeconds(13) $f.now.AddSeconds(14) $quiet $false $false
Assert-Invitation $fresh.sendEnd 'A new matching silent connected poll may retry the pending deadline.'
Write-Output 'PASS correlated pending receipt requires fresh current evidence'

foreach ($change in @(@{userTurnCount=1}, @{lastUserSpeechAt=1}, @{lastUserTurnAt=1}, @{userSpeaking=$true},
    @{workOperations=@(@{operationId='work'})}, @{userTurnCount=$null}, @{phase='ended'}, @{callId='other'})) {
    $call = $f.call.Clone()
    foreach ($key in $change.Keys) { $call[$key] = $change[$key] }
    $cancelled = Get-JarvisInvitationPoll $retry $call intent 2 2 $f.now.AddSeconds(13) $f.now.AddSeconds(14) $quiet $false $false
    Assert-Invitation (-not $cancelled.invitation -and -not $cancelled.sendEnd) 'Speech, work or unknown/current-call mismatch must cancel retry.'
}
$localSpeech = ([datetime]$f.state.finished).AddMilliseconds(500)
$cancelled = Complete-JarvisInvitationEndAttempt $pending $f.request $f.response intent 2 $f.now.AddSeconds(12) $localSpeech $false
Assert-Invitation (-not $cancelled) 'Possible local speech must cancel using the original greeting time, not receipt time.'
Write-Output 'PASS actual turns, sticky/possible speech, work and unknown state cancel retry'

foreach ($context in @(@{intentId='intent';sequence=3;paused=$false}, @{intentId='new-intent';sequence=2;paused=$false}, @{intentId='intent';sequence=2;paused=$true})) {
    $cancelled = Complete-JarvisInvitationEndAttempt $pending $f.request $f.response $context.intentId $context.sequence $f.now.AddSeconds(12) $quiet $context.paused
    Assert-Invitation (-not $cancelled) 'Newer manual intent or disable must cancel a late receipt.'
}
$cancelled = Complete-JarvisInvitationEndAttempt $null $f.request $f.response intent 2 $f.now.AddSeconds(12) $quiet $false
Assert-Invitation (-not $cancelled) 'A cleared invitation must never be resurrected.'
Write-Output 'PASS newer manual intent, disable and cancellation survive late receipts'

foreach ($response in @(@{ok=$false;error='fixture failure'}, @{ok=$true;result=@{state='superseded'}},
    @{ok=$true;result=@{requestId='end-1';state='already-on';callId='call';coordinatorCleanup='deferred'}},
    @{ok=$true;result=@{requestId='end-1';state='already-on';callId='other';coordinatorCleanup='deferred';invitationDeadlinePending=$true}},
    @{ok=$true;result=@{requestId='wrong';state='already-on';callId='call';coordinatorCleanup='deferred';invitationDeadlinePending=$true}},
    @{ok=$true;result=@{requestId='end-1';state='already-on';callId='call';coordinatorCleanup='deferred';invitationDeadlinePending='true'}})) {
    $cancelled = Complete-JarvisInvitationEndAttempt $pending $f.request $response intent 2 $f.now.AddSeconds(12) $quiet $false
    Assert-Invitation (-not $cancelled) 'Errors, unmarked refusals and mismatched receipts must not retry.'
}
Write-Output 'PASS errors and arbitrary refusals are terminal for automatic retry'

$ended = @{ok=$true;result=@{requestId='end-1';state='ended';callId='call';coordinatorCleanup='deleted'}}
$done = Complete-JarvisInvitationEndAttempt $pending $f.request $ended intent 2 $f.now.AddSeconds(12) $quiet $false
Assert-Invitation (-not $done) 'A conclusive end must release the invitation.'
Write-Output 'PASS conclusive end clears invitation'

# Execute only the actual dispatch function's AST, never listener startup.
$tokens = $null; $parseErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'wake.ps1'), [ref]$tokens, [ref]$parseErrors)
Assert-Invitation (-not $parseErrors.Count) 'Listener must parse.'
$function = $ast.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Voice-Request' }, $true)
. ([scriptblock]::Create($function.Extent.Text))
$persistent = @{intentId='intent';intentSequence=1}
$settings = @{invitationTimeoutSeconds=10}
$script:dispatches = [Collections.Generic.List[object]]::new()
function Persist {}
function Start-Worker($Request, $Reply, $Automatic) { $script:dispatches.Add($Request); return @{ignoredWorkerOutput=$true} }
$request = Voice-Request end $null $false call $true
Assert-Invitation ($request.requestId -and $request.intentSequence -eq 2 -and $request.expectedCallId -eq 'call' -and $request.cleanupUnanswered) 'Actual dispatch must return its exact correlated request.'
$pending = Start-JarvisInvitationEndAttempt $f.state $request
Assert-Invitation ($script:dispatches.Count -eq 1 -and $pending.inFlightRequestId -eq $request.requestId) 'Exactly one real dispatch-function request must be tracked.'
Write-Output 'PASS actual Voice-Request dispatch identity without recognizer or process startup'
