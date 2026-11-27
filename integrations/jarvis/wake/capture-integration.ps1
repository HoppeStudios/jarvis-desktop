function Add-JarvisCaptureIntegration([string]$Text) {
 if($Text.Contains('# jarvis-full-command:v1')){return $Text}
 $replacements=@(
  @(". (Join-Path `$sourceRoot 'commands.ps1')", ". (Join-Path `$sourceRoot 'commands.ps1')`n# jarvis-full-command:v1`n. (Join-Path `$sourceRoot 'capture.ps1')"),
  @('$next.LoadGrammar((New-JarvisGrammar -Culture $settings.recognizerCulture));', '$next.LoadGrammar((New-JarvisGrammar -Culture $settings.recognizerCulture));if($settings.captureCommands){$next.LoadGrammar((New-JarvisCaptureGrammar $settings.recognizerCulture))};'),
  @('FromMilliseconds($settings.endSilenceMilliseconds)', 'FromMilliseconds($(if($settings.captureCommands){$settings.captureSilenceMilliseconds}else{$settings.endSilenceMilliseconds}))'),
  @('FromMilliseconds($settings.ambiguousSilenceMilliseconds)', 'FromMilliseconds($(if($settings.captureCommands){$settings.captureSilenceMilliseconds}else{$settings.ambiguousSilenceMilliseconds}))'),
  @('$r=$e.SourceEventArgs.Result;$action=', '$r=$e.SourceEventArgs.Result;if($settings.captureCommands -and (Start-JarvisCapturedCommand $r)){continue};$action='),
  @('function Invoke-CommandAction([string]$action,[string]$reply,[string]$source="control"){', "function Invoke-CommandAction([string]`$action,[string]`$reply,[string]`$source=`"control`"){`n `$action=Stop-JarvisCapturedSpeech `$action"),
  @('$packet=$response.result;$script:call=$packet.call;', '$packet=$response.result;$script:call=$packet.call;Update-JarvisCapturedSpeech $packet;'),
  @('$active=$packet.pendingRequestId -or ($packet.call -and $packet.call.phase -notin @(''ended'',''failed''))', '$active=$packet.pendingRequestId -or ($packet.call -and $packet.call.phase -notin @(''ended'',''failed'')) -or (Test-JarvisCapturedSpeechActive)'),
  @('$tray.Visible=$false;', 'if($script:captureSynth){$script:captureSynth.Dispose()};$tray.Visible=$false;'),
  @('if(-not $job.process.HasExited -and $now -lt $job.started.AddSeconds(70)){continue}', "if(`$job.request.operation -eq 'transcribe'){Update-JarvisCaptureWorker `$job `$now}`n   if(-not `$job.process.HasExited -and `$now -lt `$job.started.AddSeconds(70)){continue}"),
  @("if(`$job.request.operation -eq 'voice'){", "if(`$job.request.operation -eq 'transcribe'){Complete-JarvisCapturedCommand `$job `$response}`n   elseif(`$job.request.operation -in @('voice','captured-task')){"),
  @('voiceStateVerifiedAt=$lastStatusResult;', 'voiceStateVerifiedAt=$lastStatusResult;captureCommands=[bool]$settings.captureCommands;lastCaptureOutcome=$script:lastCaptureOutcome;'),
  @('$script:lastOutcome=$response.result.state;', '$script:lastOutcome=$response.result.state;if($job.request.capturedText){$script:lastCaptureOutcome=$response.result.taskDelivery;if($response.result.taskDelivery -ne ''accepted''){Show-Error ''Captured command was not sent; no automatic retry was made.''}};')
 )
 foreach($pair in $replacements){
  if(([regex]::Matches($Text,[regex]::Escape($pair[0]))).Count -ne 1){throw 'Wake helper changed; capture integration requires review before replacement.'}
  $Text=$Text.Replace($pair[0],$pair[1])
 }
 $Text=$Text.Replace("`$_.request.operation -eq 'voice'", "`$_.request.operation -in @('voice','captured-task','transcribe')")
 return $Text
}
