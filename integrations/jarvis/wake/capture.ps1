# The recognizer owns the complete utterance, including words already spoken
# before SpeechRecognized. ASR runs only on explicitly addressed commands.
function New-JarvisCaptureGrammar([string]$Culture) {
 $alternatives=[System.Speech.Recognition.Choices]::new()
 foreach($wake in @(Get-JarvisWakePhrases)){
  $line=[System.Speech.Recognition.GrammarBuilder]::new();$line.Append($wake);$line.AppendWildcard()
  $alternatives.Add($line)
 }
 $builder=[System.Speech.Recognition.GrammarBuilder]::new();$builder.Culture=[cultureinfo]$Culture;$builder.Append($alternatives)
 $grammar=[System.Speech.Recognition.Grammar]::new($builder);$grammar.Name='Jarvis complete command';$grammar.Priority=-1
 return $grammar
}

function Start-JarvisCapturedCommand($result) {
 if($result.Grammar.Name -ne 'Jarvis complete command'){return $false}
 if(Test-JarvisCapturedSpeechActive){return $true}
 if($script:captureSpeechFinished -and $result.Audio -and $result.Audio.StartTime.ToUniversalTime() -le $script:captureSpeechFinished){return $true}
 # Never mistake Live speaker echo for a new work request. Exact native control
 # grammar remains active during calls; arbitrary capture is idle-only.
 if($script:paused -or $script:desired -or ($script:call -and $script:call.phase -notin @('ended','failed'))){return $true}
 if(@($jobs|Where-Object {$_.request.operation -in @('transcribe','voice','captured-task')}).Count){return $true}
 if($result.Confidence -lt [double]$settings.minimumConfidence){return $true}
 $audio=$result.Audio
 if(-not $audio -or $audio.Duration.TotalSeconds -gt 30){return $true}
 $stream=[IO.MemoryStream]::new()
 try{$audio.WriteToWaveStream($stream);$wave=[Convert]::ToBase64String($stream.ToArray())}finally{$stream.Dispose()}
 if($wave.Length -gt 5500000){throw 'Spoken command exceeded its capture limit; nothing was sent.'}
 $id=[guid]::NewGuid().ToString('N');$inputPath=Join-Path $workerRoot ($id+'.capture.json');$outputPath=Join-Path $workerRoot ($id+'.result.json')
 Write-JsonAtomic $inputPath @{wave=$wave;wakePhrases=@($settings.wakePhrases)+@($settings.captureWakeAliases);endPhrases=@($settings.captureEndPhrases);language=$settings.captureLanguage}
 $asr=Get-Content -LiteralPath (Join-Path $appRoot 'capture-runtime.json') -Raw|ConvertFrom-Json
 $start=[Diagnostics.ProcessStartInfo]::new([string]$asr.node);$start.UseShellExecute=$false;$start.CreateNoWindow=$true;$start.WindowStyle='Hidden'
 foreach($a in @((Join-Path $sourceRoot 'capture.mjs'),$inputPath,$outputPath,(Join-Path $appRoot 'capture-runtime.json'))){$start.ArgumentList.Add($a)}
 $process=[Diagnostics.Process]::Start($start)
 $jobs.Add(@{process=$process;request=@{operation='transcribe';sequence=$persistent.intentSequence};input=$inputPath;output=$outputPath;reply=$null;automatic=$false;started=[datetime]::UtcNow})
 $script:desired=$true;$script:lastCaptureOutcome='transcribing';return $true
}

function Complete-JarvisCapturedCommand($job,$response) {
 if(-not $settings.captureCommands -or $script:paused -or $job.request.sequence -ne $persistent.intentSequence -or
    ($script:call -and $script:call.phase -notin @('ended','failed'))){$script:lastCaptureOutcome='cancelled';return}
 if(-not $response.ok){$script:desired=$false;$script:lastCaptureOutcome='failed';Show-Error $response.error;return}
 if([string]::IsNullOrWhiteSpace($response.text) -or $response.text.Length -gt 2000){throw 'Local capture returned an invalid command.'}
 # Actual text work through the installed shared Codex adapter. No Live start.
 $script:invitation=$null;$script:desired=$true
 $persistent.intentSequence=[long]$persistent.intentSequence+1;$persistent.lastInvitation=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds();Persist
 $request=@{operation='captured-task';action='wake';requestId=[guid]::NewGuid().ToString();intentId=$persistent.intentId;intentSequence=$persistent.intentSequence;presenceGreeting=$false;capturedText=[string]$response.text}
 $null=Start-Worker $request $null $false;$script:lastCaptureOutcome='dispatching'
}

# The user's selected native voice owns replies. Never synthesize work reports
# through Windows speech. Keep these adapters for existing listener wiring.
function Test-JarvisCapturedSpeechActive { return $false }
function Stop-JarvisCapturedSpeech([string]$action) { return $action }
function Update-JarvisCapturedSpeech($packet) { return }

function Update-JarvisCaptureWorker($job,[datetime]$now) {
 if($job.process.HasExited){return}
 if($script:paused -or -not $settings.captureCommands -or $job.request.sequence -ne $persistent.intentSequence -or $now -gt $job.started.AddSeconds(45)){
  # This object owns only the ASR child we started, never Pi or another chat.
  $job.process.Kill($true);$null=$job.process.WaitForExit(1000)
  Write-JsonAtomic $job.output @{ok=$false;error='Spoken command capture was cancelled or timed out; nothing was sent.'}
 }
}
