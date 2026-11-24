# Pure invitation lifecycle. No recognizer, media, processes, files or queue I/O.
function New-JarvisInvitationState($Request, $Result, [datetime]$Now, [double]$TimeoutSeconds) {
    if ($Result.state -ne 'connected' -or $Result.requestId -cne $Request.requestId -or
        -not $Result.callId -or -not $Result.coordinatorSessionId) { return $null }
    $finished = if ($Result.greetingPlayed -eq $true) {
        [DateTimeOffset]::FromUnixTimeMilliseconds([long]$Result.greetingFinishedAt).UtcDateTime
    } else { $null }
    return @{
        callId = $Result.callId; sessionId = $Result.coordinatorSessionId
        finished = $finished; timeoutSeconds = $TimeoutSeconds
        intentId = $Request.intentId; intentSequence = [long]$Request.intentSequence
        inFlightRequestId = $null; verifyAfter = $Now
    }
}

function Test-JarvisInvitationCurrent([hashtable]$Invitation, [string]$IntentId,
    [long]$IntentSequence, [datetime]$LastSpeech, [bool]$Paused) {
    if (-not $Invitation -or $Paused -or $Invitation.intentId -cne $IntentId -or
        $Invitation.intentSequence -ne $IntentSequence) { return $false }
    # Keep the original measured greeting time and its existing echo gate.
    return -not ($Invitation.finished -and
        $LastSpeech -ge ([datetime]$Invitation.finished).AddMilliseconds(400))
}

function Get-JarvisInvitationPoll([hashtable]$Invitation, $Call, [string]$IntentId,
    [long]$IntentSequence, [long]$PollSequence, [datetime]$PollStarted,
    [datetime]$Now, [datetime]$LastSpeech, [bool]$Paused, [bool]$VoicePending) {
    $decision = @{ invitation = $null; sendEnd = $false }
    if (-not (Test-JarvisInvitationCurrent $Invitation $IntentId $IntentSequence $LastSpeech $Paused)) {
        return $decision
    }
    $decision.invitation = $Invitation
    # A poll begun before creation/a deadline receipt cannot authorize an attempt.
    if ($PollSequence -ne $IntentSequence -or $PollStarted -le [datetime]$Invitation.verifyAfter) {
        return $decision
    }
    if (-not $Call -or $Call.callId -cne $Invitation.callId -or $Call.phase -ne 'connected' -or
        $Call.userTurnCount -ne 0 -or $Call.userSpeaking -ne $false -or
        $null -ne $Call.lastUserSpeechAt -or $null -ne $Call.lastUserTurnAt -or
        $Call.workOperations -or $Call.workBinding.workSessionId -cne $Invitation.sessionId) {
        $decision.invitation = $null
        return $decision
    }
    if (-not $Invitation.inFlightRequestId -and -not $VoicePending -and
        (-not $Invitation.finished -or
         $Now -ge ([datetime]$Invitation.finished).AddSeconds($Invitation.timeoutSeconds))) {
        $decision.sendEnd = $true
    }
    return $decision
}

function Start-JarvisInvitationEndAttempt([hashtable]$Invitation, $Request) {
    if (-not $Invitation -or $Invitation.inFlightRequestId -or $Request.action -ne 'end' -or
        -not $Request.requestId -or $Request.expectedCallId -cne $Invitation.callId -or
        $Request.intentId -cne $Invitation.intentId -or
        $Request.intentSequence -ne ($Invitation.intentSequence + 1)) {
        throw 'Invitation end admission changed.'
    }
    $next = $Invitation.Clone()
    $next.intentSequence = [long]$Request.intentSequence
    $next.inFlightRequestId = $Request.requestId
    return $next
}

function Complete-JarvisInvitationEndAttempt([hashtable]$Invitation, $Request, $Response,
    [string]$IntentId, [long]$IntentSequence, [datetime]$Now, [datetime]$LastSpeech, [bool]$Paused) {
    if (-not (Test-JarvisInvitationCurrent $Invitation $IntentId $IntentSequence $LastSpeech $Paused)) {
        return $null
    }
    if ($Request.requestId -cne $Invitation.inFlightRequestId) { return $Invitation }
    $result = $Response.result
    # Only this explicit, correlated Main receipt permits another attempt.
    # Errors, generic refusals, missing evidence and older Main versions do not.
    if ($Response.ok -ne $true -or $Request.intentId -cne $IntentId -or
        $Request.intentSequence -ne $IntentSequence -or $Request.action -ne 'end' -or
        $Request.expectedCallId -cne $Invitation.callId -or $Request.cleanupUnanswered -ne $true -or
        $result.requestId -cne $Request.requestId -or $result.callId -cne $Invitation.callId -or
        $result.state -ne 'already-on' -or $result.coordinatorCleanup -ne 'deferred' -or
        $result.invitationDeadlinePending -isnot [bool] -or -not $result.invitationDeadlinePending -or
        -not $Invitation.finished) { return $null }
    $next = $Invitation.Clone()
    $next.inFlightRequestId = $null
    $next.verifyAfter = $Now
    return $next
}
