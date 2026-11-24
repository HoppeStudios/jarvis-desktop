param([switch]$StartPaused,[switch]$Check,[string]$TestWav,[int]$TestDuration=0,[string]$RootPath,[switch]$MutedTestCalls)
$ErrorActionPreference='Stop'
if($PSVersionTable.PSEdition -ne 'Core' -or $PSVersionTable.PSVersion.Major -lt 7){throw 'Jarvis requires PowerShell 7.'}
$appRoot=if($RootPath){[IO.Path]::GetFullPath($RootPath)}else{$PSScriptRoot}
$sourceRoot=if(Test-Path -LiteralPath (Join-Path $appRoot 'Pi\wake')){Join-Path $appRoot 'Pi\wake'}else{$PSScriptRoot}
. (Join-Path $sourceRoot 'configuration.ps1')
. (Join-Path $sourceRoot 'commands.ps1')
$settings=Read-JarvisSettings (Join-Path $appRoot 'settings.json')
Add-Type -AssemblyName System.Speech
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -Path (Join-Path $sourceRoot 'presence.cs')
function New-Recognizer {
 $next=New-Object System.Speech.Recognition.SpeechRecognitionEngine([Globalization.CultureInfo]::GetCultureInfo($settings.recognizerCulture))
 try{$next.LoadGrammar((New-JarvisGrammar -Culture $settings.recognizerCulture));$next.EndSilenceTimeout=[TimeSpan]::FromMilliseconds($settings.endSilenceMilliseconds);$next.EndSilenceTimeoutAmbiguous=[TimeSpan]::FromMilliseconds($settings.ambiguousSilenceMilliseconds);return $next}
 catch{$next.Dispose();throw}
}
$recognizer=New-Recognizer
if($TestWav){try{$recognizer.SetInputToWaveFile([IO.Path]::GetFullPath($TestWav));$r=$recognizer.Recognize([TimeSpan]::FromSeconds(15));@{action=(Get-JarvisAction $r);confidence=$(if($r){$r.Confidence}else{0})}|ConvertTo-Json -Compress}finally{$recognizer.Dispose()};exit}
if($Check){try{@{ready=$true;backend='pi-desktop';culture=$settings.recognizerCulture;captureProcesses=@([JarvisPiPresence]::CaptureProcesses());unlocked=[JarvisPiPresence]::Unlocked()}|ConvertTo-Json -Compress}finally{$recognizer.Dispose()};exit}
$created=$false;$mutex=[Threading.Mutex]::new($true,'Local\JarvisWakeWord',[ref]$created)
if(-not $created){$recognizer.Dispose();$mutex.Dispose();exit}
$dataRoot=Join-Path $appRoot 'data';$workerRoot=Join-Path $dataRoot 'pi-workers'
New-Item -ItemType Directory -Path $workerRoot -Force | Out-Null
$runtime=Get-Content -LiteralPath (Join-Path $appRoot 'pi-runtime.json') -Raw | ConvertFrom-Json
if(-not (Test-Path -LiteralPath $runtime.python -PathType Leaf)){throw 'The pinned Jarvis Python runtime is unavailable.'}
$utf8=[Text.UTF8Encoding]::new($false)
function Write-JsonAtomic($path,$value){$temp=$path+'.'+[guid]::NewGuid().ToString('N')+'.tmp';try{[IO.File]::WriteAllText($temp,($value|ConvertTo-Json -Depth 12 -Compress),$utf8);Move-Item -LiteralPath $temp -Destination $path -Force}finally{Remove-Item -LiteralPath $temp -Force -ErrorAction SilentlyContinue}}
$statePath=Join-Path $dataRoot 'pi-state.json'
$persistent=if(Test-Path -LiteralPath $statePath){Get-Content -LiteralPath $statePath -Raw|ConvertFrom-Json -AsHashtable}else{@{intentId=[guid]::NewGuid().ToString();intentSequence=0;lastInvitation=0;paused=$false}}
$script:paused=$StartPaused -or [bool]$persistent.paused;$script:desired=$false;$script:call=$null;$script:lastError=$null;$script:lastOutcome=$null;$script:lastAction=$null;$script:processed=0;$script:invitation=$null;$script:lastSpeech=[DateTime]::MinValue;$script:exitRequested=$false
$jobs=[Collections.Generic.List[object]]::new();$nextPoll=[DateTime]::MinValue;$lastStatus=[DateTime]::MinValue;$lastRecognition=$null;$lastStatusResult=$null
$tray=[Windows.Forms.NotifyIcon]::new();$tray.Icon=[Drawing.Icon]::new((Join-Path $appRoot 'icon.ico'));$tray.Visible=$true
$menu=[Windows.Forms.ContextMenuStrip]::new();$nativeSettings=$menu.Items.Add('Pi Desktop settings');$nativeSettings.add_Click({try{$null=Start-Worker @{operation='settings'} $null $false}catch{Show-Error $_.Exception.Message}})
$wakeSettings=$menu.Items.Add('Wake word settings');$wakeSettings.add_Click({$p=[Diagnostics.ProcessStartInfo]::new((Get-Process -Id $PID).Path);$p.UseShellExecute=$false;$p.CreateNoWindow=$true;foreach($a in @('-STA','-NoProfile','-File',(Join-Path $sourceRoot 'settings.ps1'),'-RootPath',$appRoot)){$p.ArgumentList.Add($a)};$null=[Diagnostics.Process]::Start($p)})
$pauseItem=$menu.Items.Add('Pause listening');$pauseItem.add_Click({try{Invoke-CommandAction $(if($script:paused){'resume'}else{'disable'}) $null}catch{Show-Error $_.Exception.Message}})
$endItem=$menu.Items.Add('End conversation');$endItem.add_Click({try{Invoke-CommandAction 'end' $null}catch{Show-Error $_.Exception.Message}})
$null=$menu.Items.Add('-');$exitItem=$menu.Items.Add('Exit listener');$exitItem.add_Click({$script:exitRequested=$true})
$tray.ContextMenuStrip=$menu;$tray.add_DoubleClick({$nativeSettings.PerformClick()})
function Persist { $persistent.paused=$script:paused;Write-JsonAtomic $statePath $persistent }
function Show-Error([string]$message){$script:lastError=$message;$tray.ShowBalloonTip(3500,'Jarvis',$message,[Windows.Forms.ToolTipIcon]::Warning)}
function Status {
 $tray.Text=if($script:paused){'Jarvis Pi: paused'}elseif($script:desired){'Jarvis Pi: voice requested'}else{'Jarvis Pi: listening'}
 $pauseItem.Text=if($script:paused){'Resume listening'}else{'Pause listening'}
 Write-JsonAtomic (Join-Path $dataRoot 'status.json') @{pid=$PID;state=$(if($script:paused){'paused'}else{'listening'});backend='pi-desktop';version='3.0.0';updated=[DateTime]::UtcNow.ToString('o');voiceActive=($script:call -and $script:call.phase -notin @('ended','failed'));voiceDesired=$script:desired;callId=$script:call.callId;voiceStateVerifiedAt=$lastStatusResult;pendingWorkers=$jobs.Count;lastAction=$script:lastAction;lastVoiceOutcome=$script:lastOutcome;lastError=$script:lastError;processedCommandCount=$script:processed;culture=$settings.recognizerCulture;wakePhrases=$settings.wakePhrases;monitor=$script:monitor;questionError=$script:queueError;intentSequence=$persistent.intentSequence}
}
function Set-Paused([bool]$value){
 if($value -eq $script:paused){return}
 if($value){$recognizer.RecognizeAsyncCancel();$until=[DateTime]::UtcNow.AddSeconds(2);while($recognizer.AudioState -ne 'Stopped' -and [DateTime]::UtcNow -lt $until){[Windows.Forms.Application]::DoEvents();Start-Sleep -Milliseconds 20};$recognizer.SetInputToNull()}
 else{$recognizer.SetInputToDefaultAudioDevice();$recognizer.RecognizeAsync([System.Speech.Recognition.RecognizeMode]::Multiple)}
 $script:paused=$value;Persist
}
function Start-Worker([hashtable]$request,[string]$reply,[bool]$automatic){
 if($jobs.Count -ge 8 -and $request.action -ne 'end'){throw 'Jarvis has too many pending control actions.'}
 $id=[guid]::NewGuid().ToString('N');$inputPath=Join-Path $workerRoot ($id+'.request.json');$resultPath=Join-Path $workerRoot ($id+'.result.json')
 Write-JsonAtomic $inputPath $request
 $start=[Diagnostics.ProcessStartInfo]::new([string]$runtime.python);$start.UseShellExecute=$false;$start.CreateNoWindow=$true;$start.WindowStyle='Hidden'
 foreach($a in @((Join-Path $sourceRoot 'desktop_control.py'),'--root',$appRoot,'--request',$inputPath,'--result',$resultPath)){$start.ArgumentList.Add($a)}
 $process=[Diagnostics.Process]::Start($start)
 $job=@{process=$process;request=$request;input=$inputPath;output=$resultPath;reply=$reply;automatic=$automatic;started=[DateTime]::UtcNow}
 $jobs.Add($job);return $job
}
function Voice-Request([string]$action,[string]$reply,[bool]$automatic=$false,[string]$expected=$null){
 $persistent.intentSequence=[long]$persistent.intentSequence+1;Persist
 $request=@{operation='voice';action=$action;requestId=[guid]::NewGuid().ToString();intentId=$persistent.intentId;intentSequence=$persistent.intentSequence;presenceGreeting=$automatic}
 if($MutedTestCalls){$request.initialMuted=$true}
 if($expected){$request.expectedCallId=$expected}
 $null=Start-Worker $request $reply $automatic
}
function Invoke-CommandAction([string]$action,[string]$reply){
 $script:invitation=$null;$script:lastAction=$action;$script:processed++
 if($action -eq 'resume'){Set-Paused $false;if($reply){Write-JsonAtomic $reply @{ok=$true;action=$action;state='listening'}};return}
 if($action -eq 'reload-settings'){
  $previous=$settings;$script:settings=Read-JarvisSettings (Join-Path $appRoot 'settings.json')
  try{$next=New-Recognizer}catch{$script:settings=$previous;throw}
  foreach($id in @('JarvisPiRecognized','JarvisPiSpeech','JarvisPiRejected')){Unregister-Event -SourceIdentifier $id -ErrorAction SilentlyContinue;Get-Event -SourceIdentifier $id -ErrorAction SilentlyContinue|Remove-Event -ErrorAction SilentlyContinue}
  $recognizer.Dispose();$script:recognizer=$next;Register-Speech
  if(-not $script:paused){$recognizer.SetInputToDefaultAudioDevice();$recognizer.RecognizeAsync([System.Speech.Recognition.RecognizeMode]::Multiple)}
  if($reply){Write-JsonAtomic $reply @{ok=$true;action=$action;outcome='settings-reloaded'}};return
 }
 if($action -eq 'disable'){$script:desired=$false;try{Voice-Request 'end' $reply}finally{Set-Paused $true};return}
 if($action -notin @('toggle','wake','new-chat','end')){throw 'Unknown Jarvis command.'}
 if($action -in @('toggle','wake','new-chat') -and $script:paused){throw 'Jarvis is paused. Resume listening first.'}
 $persistent.lastInvitation=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
 if($action -eq 'toggle' -and $settings.activationBehavior -eq 'wake'){$action='wake'}
 if($action -eq 'toggle'){$script:desired=-not $script:desired;$action=if($script:desired){'wake'}else{'end'}}
 else{$script:desired=$action -ne 'end'}
 Voice-Request $action $reply
}
function Register-Speech {
 Register-ObjectEvent -InputObject $recognizer -EventName SpeechRecognized -SourceIdentifier 'JarvisPiRecognized'|Out-Null
 Register-ObjectEvent -InputObject $recognizer -EventName SpeechDetected -SourceIdentifier 'JarvisPiSpeech'|Out-Null
 Register-ObjectEvent -InputObject $recognizer -EventName SpeechRecognitionRejected -SourceIdentifier 'JarvisPiRejected'|Out-Null
}
try {
 Register-Speech
 if(-not $script:paused){$recognizer.SetInputToDefaultAudioDevice();$recognizer.RecognizeAsync([System.Speech.Recognition.RecognizeMode]::Multiple)}
 Persist;Status;$started=[DateTime]::UtcNow
 while(-not $script:exitRequested){
  [Windows.Forms.Application]::DoEvents();$now=[DateTime]::UtcNow
  foreach($name in @('JarvisPiSpeech','JarvisPiRejected')){foreach($e in @(Get-Event -SourceIdentifier $name -ErrorAction SilentlyContinue)){
   $time=$e.TimeGenerated.ToUniversalTime();if($name -eq 'JarvisPiRejected'){$audio=$e.SourceEventArgs.Result.Audio;if($audio){$time=$audio.StartTime.ToUniversalTime().Add($audio.Duration)}}
   if($time -gt $script:lastSpeech){$script:lastSpeech=$time};Remove-Event -EventIdentifier $e.EventIdentifier -ErrorAction SilentlyContinue
  }}
  foreach($e in @(Get-Event -SourceIdentifier 'JarvisPiRecognized' -ErrorAction SilentlyContinue)){
   try{
    $r=$e.SourceEventArgs.Result;$action=Get-JarvisAction $r;$audio=$r.Audio;$key=if($audio){[string]$audio.StartTime.Ticks+':'+$audio.AudioPosition.Ticks+':'+$audio.Duration.Ticks}else{[string]$e.EventIdentifier}
    if(-not $script:paused -and $action -and $key -ne $lastRecognition){$lastRecognition=$key;$count=1;if($action -match '^toggle-([2-4])$'){$count=[int]$Matches[1];$action='toggle'};for($i=0;$i -lt $count;$i++){Invoke-CommandAction $action $null};Status}
   }catch{Show-Error $_.Exception.Message}
   finally{Remove-Event -EventIdentifier $e.EventIdentifier -ErrorAction SilentlyContinue}
  }
  foreach($file in @(Get-ChildItem -LiteralPath $dataRoot -Filter 'request-*.json' -File|Sort-Object CreationTimeUtc,Name|Select-Object -First 10)){
   $reply=Join-Path $dataRoot ($file.BaseName.Replace('request-','result-')+'.json')
   try{
    if($file.Length -gt 1024){throw 'Invalid command request size.'};$request=Get-Content -LiteralPath $file.FullName -Raw|ConvertFrom-Json
    if([Math]::Abs(($now-([DateTime]$request.created).ToUniversalTime()).TotalSeconds) -gt 30){throw 'Expired command request.'}
    Invoke-CommandAction $request.action $reply;Status
   }catch{Write-JsonAtomic $reply @{ok=$false;error=$_.Exception.Message}}
   finally{Remove-Item -LiteralPath $file.FullName -Force}
  }
  foreach($job in @($jobs.ToArray())){
   if(-not $job.process.HasExited -and $now -lt $job.started.AddSeconds(70)){continue}
   $response=if(Test-Path -LiteralPath $job.output){Get-Content -LiteralPath $job.output -Raw|ConvertFrom-Json}else{@{ok=$false;error='Pi Desktop control did not return a verified result.'}}
   $jobs.Remove($job)|Out-Null
   if($job.request.operation -eq 'voice'){
    if($job.reply){Write-JsonAtomic $job.reply $response}
    if($job.request.intentSequence -eq $persistent.intentSequence){
     if($response.ok){$script:lastOutcome=$response.result.state;$script:lastError=$null
      if($response.result.state -in @('ended','already-ended','cancelled')){$script:desired=$false}
      if($job.automatic -and $response.result.state -eq 'connected'){
       $finished=if($response.result.greetingPlayed){[DateTimeOffset]::FromUnixTimeMilliseconds([long]$response.result.greetingFinishedAt).UtcDateTime}else{$null}
       $script:invitation=@{callId=$response.result.callId;finished=$finished;sessionId=$response.result.coordinatorSessionId}
      }
     }else{Show-Error $response.error}
    }
   }elseif($job.request.operation -eq 'poll'){
    if($response.ok){
     $packet=$response.result;$script:call=$packet.call;$lastStatusResult=$now.ToString('o');$script:monitor=$packet.monitor;$script:queueError=$packet.queueError
     $voiceJobs=@($jobs|Where-Object {$_.request.operation -eq 'voice'}).Count
     $active=$packet.pendingRequestId -or ($packet.call -and $packet.call.phase -notin @('ended','failed'))
     if($job.request.sequence -eq $persistent.intentSequence -and $voiceJobs -eq 0){$script:desired=[bool]$active}
     if($script:invitation){
      $invite=$script:invitation;$call=$packet.call
      if(-not $call -or $call.callId -ne $invite.callId -or $call.phase -in @('ended','failed')){$script:invitation=$null}
      elseif($call.userTurnCount -gt 0 -or $call.lastUserSpeechAt -or ($invite.finished -and $script:lastSpeech -ge $invite.finished.AddMilliseconds(400))){$script:invitation=$null}
      elseif(-not $invite.finished -or $now -ge $invite.finished.AddSeconds([double]$settings.invitationTimeoutSeconds)){
       $script:invitation=$null;$script:desired=$false;Voice-Request 'end' $null $false $invite.callId
      }
     }elseif(-not $script:paused -and $settings.notificationsEnabled -and $packet.pendingCount -gt 0 -and -not $active -and $voiceJobs -eq 0){
      $last=[Math]::Max([double]$persistent.lastInvitation,[double]$packet.lastInvitation)
      if([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()-$last -ge [double]$settings.invitationCooldownMinutes*60000 -and [JarvisPiPresence]::Unlocked() -and [JarvisPiPresence]::IdleSeconds() -lt [double]$settings.returnIdleSeconds){
       # Any other active capture client defers automatic invitations. Unknown
       # CoreAudio state throws and fails closed; no input or session is changed.
       try{$foreign=@([JarvisPiPresence]::CaptureProcesses()|Where-Object {$_ -ne $PID});if($foreign.Count -eq 0){$persistent.lastInvitation=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds();Persist;$script:desired=$true;Voice-Request 'wake' $null $true}}catch{$script:queueError='Microphone ownership could not be verified; invitation deferred.'}
      }
     }
    }else{$script:queueError=$response.error}
   }elseif(-not $response.ok){Show-Error $response.error}
   if($job.process.HasExited){$job.process.Dispose()};Remove-Item -LiteralPath $job.input,$job.output -Force -ErrorAction SilentlyContinue
   Status
  }
  if($now -ge $nextPoll -and @($jobs|Where-Object {$_.request.operation -eq 'poll'}).Count -eq 0){$nextPoll=$now.AddSeconds([double]$settings.pollIntervalSeconds);$null=Start-Worker @{operation='poll';sequence=$persistent.intentSequence} $null $false}
  if($now -ge $lastStatus.AddSeconds(5)){Status;$lastStatus=$now}
  if($TestDuration -gt 0 -and $now -ge $started.AddSeconds($TestDuration)){$script:exitRequested=$true}
  Start-Sleep -Milliseconds 40
 }
}finally{
 foreach($id in @('JarvisPiRecognized','JarvisPiSpeech','JarvisPiRejected')){Unregister-Event -SourceIdentifier $id -ErrorAction SilentlyContinue;Get-Event -SourceIdentifier $id -ErrorAction SilentlyContinue|Remove-Event -ErrorAction SilentlyContinue}
 $recognizer.Dispose();$tray.Visible=$false;$tray.Dispose();$menu.Dispose();$mutex.ReleaseMutex();$mutex.Dispose()
}
