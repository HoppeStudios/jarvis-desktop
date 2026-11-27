$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'capture.ps1')
function Assert-Capture($value,[string]$message){if(-not $value){throw $message}}
$settings=[pscustomobject]@{captureCommands=$true}
$persistent=@{intentSequence=5;intentId='owner'}
$script:paused=$false;$script:desired=$true;$script:call=$null;$script:sent=@();$script:errors=@()
function Persist {}
function Start-Worker($request,$reply,$automatic){$script:sent+=,$request}
function Show-Error($message){$script:errors+=,$message}
$job=@{request=@{sequence=5}}
Complete-JarvisCapturedCommand $job @{ok=$true;text='otevři celý projekt'}
Assert-Capture ($script:sent.Count -eq 1 -and $script:sent[0].capturedText -ceq 'otevři celý projekt') 'Complete actual command must be dispatched intact.'
Assert-Capture ($script:sent[0].operation -eq 'captured-task' -and $persistent.intentSequence -eq 6) 'Dispatch must use the ordered task admission path.'
Complete-JarvisCapturedCommand $job @{ok=$true;text='stale'}
Assert-Capture ($script:sent.Count -eq 1) 'Older transcription must not send after another intent.'
$job.request.sequence=6;$script:paused=$true
Complete-JarvisCapturedCommand $job @{ok=$true;text='paused'}
Assert-Capture ($script:sent.Count -eq 1) 'Pause cancels submission.'
$script:paused=$false;$script:call=@{phase='connected'}
Complete-JarvisCapturedCommand $job @{ok=$true;text='other call'}
Assert-Capture ($script:sent.Count -eq 1) 'An existing call must not be replaced.'
$script:call=$null;$settings.captureCommands=$false
Complete-JarvisCapturedCommand $job @{ok=$true;text='disabled'}
Assert-Capture ($script:sent.Count -eq 1) 'Turning capture off cancels submission.'
$settings.captureCommands=$true
Complete-JarvisCapturedCommand $job @{ok=$false;error='fixture ASR failure'}
Assert-Capture ($script:sent.Count -eq 1 -and $script:errors.Count -eq 1 -and -not $script:desired) 'Failed transcription must remain unsent and report the failure.'
'PASS complete command, ordered cancellation, pause, active call, disabled capture and ASR failure'
$script:captureSynth=$null
foreach($phase in @('connected','ended')){
 Update-JarvisCapturedSpeech @{call=@{phase=$phase};captureReports=@(@{text='fixture';requestId=[guid]::NewGuid().ToString()})}
 Assert-Capture (-not $script:captureSynth) 'Work reports must never create a Windows speech synthesizer.'
}
Assert-Capture ((Stop-JarvisCapturedSpeech 'toggle') -eq 'toggle') 'Native wake toggle must retain its existing action.'
'PASS Windows speech removed and native toggle unchanged'
