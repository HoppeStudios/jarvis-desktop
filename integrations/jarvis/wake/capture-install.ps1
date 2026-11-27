param([Parameter(Mandatory)][string]$RuntimeConfig,[string]$RootPath=(Join-Path $env:LOCALAPPDATA 'JarvisWake'),[switch]$ValidateOnly)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'capture-integration.ps1')
. (Join-Path $PSScriptRoot 'state.ps1')
. (Join-Path $PSScriptRoot 'listener-identity.ps1')
. (Join-Path $PSScriptRoot 'configuration.ps1')
$root=[IO.Path]::GetFullPath($RootPath);$wakeRoot=Join-Path $root 'Pi/wake'
$ownership=Read-JsonShared (Join-Path $root 'pi-runtime.json')
if($ownership.backend -ne 'pi-desktop'){throw 'Capture installation requires the selected Pi runtime.'}
$runtime=Get-Content -LiteralPath $RuntimeConfig -Raw|ConvertFrom-Json
if($runtime.modelSha256 -ne 'ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb'){throw 'Only the reviewed multilingual model is supported by this installer.'}
foreach($key in @('node','module','library','model')){if(-not(Test-Path -LiteralPath $runtime.$key -PathType Leaf)){throw ('Missing pinned artifact: '+$key)}}
if(-not(Test-Path -LiteralPath $runtime.bridgeConfig -PathType Leaf) -or -not(Test-Path -LiteralPath $runtime.taskDirectory -PathType Container)){throw 'Existing shared Codex configuration and task directory are required.'}
function Replace-One([string]$text,[string]$before,[string]$after){
 if(([regex]::Matches($text,[regex]::Escape($before))).Count -ne 1){throw ('Installed source changed; review capture integration at: '+$before)}
 return $text.Replace($before,$after)
}
function Read-Normalized([string]$path){return [IO.File]::ReadAllText($path).TrimStart([char]0xfeff).Replace("`r`n","`n")}
$patches=@{};$previous=@{}
foreach($entry in @(@('wake.ps1','wake.ps1'),@('configuration.ps1','Pi/wake/configuration.ps1'),@('settings.ps1','Pi/wake/settings.ps1'),@('desktop_control.py','Pi/wake/desktop_control.py'))){
 $path=Join-Path $root $entry[1];$text=Read-Normalized $path;$previous[$path]=(Get-FileHash -LiteralPath $path).Hash
 if($entry[0] -eq 'wake.ps1'){$text=Add-JarvisCaptureIntegration $text}
 elseif($entry[0] -eq 'configuration.ps1' -and -not $text.Contains('# capture-defaults:begin')){
  $source=Read-Normalized (Join-Path $PSScriptRoot $entry[0])
  foreach($spec in @(@('defaults','  $configuration=Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json'),@('validation','function Assert-JarvisSettings($configuration) {'))){
   $block=[regex]::Match($source,'(?ms)^  # capture-'+$spec[0]+':begin.*?^  # capture-'+$spec[0]+':end').Value
   if(-not $block){throw 'Capture source block is missing.'};$text=Replace-One $text $spec[1] ($spec[1]+"`n"+$block)
  }
 }
 elseif($entry[0] -eq 'settings.ps1' -and -not $text.Contains('Add-JarvisCaptureSettingsFields')){
  $text=Replace-One $text ". (Join-Path `$PSScriptRoot 'commands.ps1')" ". (Join-Path `$PSScriptRoot 'commands.ps1')`n. (Join-Path `$PSScriptRoot 'capture-settings.ps1')"
  $alerts=[regex]::Matches($text,'(?m)^\$alerts=Add-SettingsTab [^\n]+')
  if($alerts.Count -ne 1){throw 'Settings tab integration requires review.'}
  $text=Replace-One $text $alerts[0].Value ("Add-JarvisCaptureSettingsFields`n"+$alerts[0].Value)
  $save=[regex]::Matches($text,'(?m)^    Save-JarvisSettings(?:AndApply)? \$next [^\n]+')
  if($save.Count -ne 1){throw 'Settings save integration requires review.'}
  $text=Replace-One $text $save[0].Value ('    Save-JarvisCaptureSettingsFields $next $fields'+"`n"+$save[0].Value)
  $text=$text.Replace('[ValidateRange(0,2)][int]$PreviewTab','[ValidateRange(0,3)][int]$PreviewTab')
 }
 elseif($entry[0] -eq 'desktop_control.py' -and -not $text.Contains("operation == 'captured-task'")){
  $text=Replace-One $text "    operation = request.get('operation')" "    operation = request.get('operation')`n    if operation == 'captured-task':`n        from captured_task import execute as captured_execute`n        return captured_execute(client, request, root, execute)"
  $text=Replace-One $text 'args.request.stat().st_size > 4096' 'args.request.stat().st_size > 16384'
  $text=Replace-One $text '        return status' "        try:`n            from captured_task import poll as capture_poll`n            status['captureReports'] = capture_poll(client,root)`n        except (OSError,ValueError,RuntimeError):`n            status['captureError'] = 'Captured text task status is unavailable.'`n        return status"
 }
 if($path.EndsWith('.ps1')){$tokens=$null;$errors=$null;$null=[Management.Automation.Language.Parser]::ParseInput($text,[ref]$tokens,[ref]$errors);if($errors.Count){throw ('Invalid capture integration: '+$entry[0])}}
 $patches[$path]=$text
}
$settingsPath=Join-Path $root 'settings.json';$settingsBefore=[IO.File]::ReadAllText($settingsPath)
$settings=Read-JarvisSettings $settingsPath;$settings.captureCommands=$true;Assert-JarvisSettings $settings
if($settings.PSObject.Properties.Name -contains 'captureTtsVoice'){$settings.PSObject.Properties.Remove('captureTtsVoice')}
$status=Read-JsonShared (Join-Path $root 'data/status.json')
$owner=Get-CimInstance Win32_Process -Filter ('ProcessId='+$status.pid)
if(-not(Test-JarvisListenerIdentity $owner (Join-Path $root 'wake.ps1'))){throw 'Selected listener identity is unconfirmed.'}
$startup=Join-Path ([Environment]::GetFolderPath('Startup')) 'Jarvis Wake.lnk'
$shortcut=(New-Object -ComObject WScript.Shell).CreateShortcut($startup)
if(-not $shortcut.Arguments.Contains((Join-Path $root 'launch.ps1'))){throw 'Existing Startup does not point to the selected Jarvis helper.'}
$request=Join-Path $root 'data/capture-install-status.request.json';$result=Join-Path $root 'data/capture-install-status.result.json'
function Assert-Idle {
 try{
  Write-JsonAtomic $request @{operation='status'}
  & $ownership.python (Join-Path $wakeRoot 'desktop_control.py') --root $root --request $request --result $result
  if($LASTEXITCODE -ne 0){throw 'Native status failed.'};$state=Read-JsonShared $result
  if(-not $state.ok -or $state.result.pendingRequestId -or ($state.result.call -and ($state.result.call.phase -notin @('ended','failed') -or $state.result.call.mediaRelease -ne 'confirmed'))){throw 'Capture deployment deferred: active or unconfirmed call.'}
 }finally{Remove-Item -LiteralPath $request,$result -Force -ErrorAction SilentlyContinue}
}
Assert-Idle
if($ValidateOnly){@{validated=$true;backend='pi-desktop';patchedFiles=$patches.Count;startupPreserved=$true}|ConvertTo-Json -Compress;return}
# Prepare only additive runtime files. Existing audio recovery, call sounds,
# private queue, account, voice and other installed patches remain untouched.
$asrRoot=Join-Path $root 'Pi/asr'
& $runtime.node (Join-Path $PSScriptRoot 'capture-pin.mjs') $RuntimeConfig $asrRoot
if($LASTEXITCODE -ne 0){throw 'Local ASR pinning failed.'}
Start-MpScan -ScanType CustomScan -ScanPath $asrRoot
foreach($name in @('capture.ps1','capture.mjs','captured_task.py','capture-settings.ps1','capture-settings-form.cs')){Start-MpScan -ScanType CustomScan -ScanPath (Join-Path $PSScriptRoot $name)}
Assert-Idle
foreach($path in $previous.Keys){if((Get-FileHash -LiteralPath $path).Hash -ne $previous[$path]){throw 'Concurrent installed-source change; deployment deferred.'}}
if([IO.File]::ReadAllText($settingsPath) -cne $settingsBefore){throw 'Concurrent settings change; deployment deferred.'}
$latest=Get-CimInstance Win32_Process -Filter ('ProcessId='+$status.pid)
if(-not $latest -or $latest.CommandLine -cne $owner.CommandLine){throw 'Listener ownership changed.'}
$lastState=Read-JsonShared (Join-Path $root 'data/pi-state.json')
$lastStatus=Read-JsonShared (Join-Path $root 'data/status.json')
if($lastState.intentSequence -ne $status.intentSequence -or $lastStatus.voiceActive -or $lastStatus.voiceDesired -or ($lastStatus.state -eq 'paused') -ne ($status.state -eq 'paused')){throw 'User voice intent changed; capture deployment deferred.'}
Stop-Process -Id $status.pid -ErrorAction Stop
$deadline=[datetime]::UtcNow.AddSeconds(5)
while(Get-Process -Id $status.pid -ErrorAction SilentlyContinue){if([datetime]::UtcNow -gt $deadline){throw 'Listener has not exited.'};Start-Sleep -Milliseconds 50}
foreach($name in @('capture.ps1','capture.mjs','captured_task.py','capture-settings.ps1','capture-settings-form.cs')){Copy-Item -LiteralPath (Join-Path $PSScriptRoot $name) -Destination (Join-Path $wakeRoot $name) -Force}
foreach($path in $patches.Keys){[IO.File]::WriteAllText($path,$patches[$path],[Text.UTF8Encoding]::new($false))}
Copy-Item -LiteralPath (Join-Path $asrRoot 'runtime.json') -Destination (Join-Path $root 'capture-runtime.json') -Force
Save-JarvisSettings $settings $settingsPath $settingsBefore
$hostPath=$shortcut.TargetPath
& $hostPath -STA -NoProfile -File (Join-Path $root 'launch.ps1') -StartPaused:($status.state -eq 'paused')
if($LASTEXITCODE -ne 0){throw 'Capture helper launch failed.'}
$deadline=[datetime]::UtcNow.AddSeconds(12)
do{
 Start-Sleep -Milliseconds 150;$health=Read-JsonShared (Join-Path $root 'data/status.json')
 if($health.pid -ne $status.pid -and $health.captureCommands -and $health.backend -eq 'pi-desktop' -and $health.state -eq $status.state){break}
}while([datetime]::UtcNow -lt $deadline)
$newOwner=Get-CimInstance Win32_Process -Filter ('ProcessId='+$health.pid)
if($health.pid -eq $status.pid -or -not $health.captureCommands -or $health.backend -ne 'pi-desktop' -or $health.state -ne $status.state -or
   -not(Test-JarvisListenerIdentity $newOwner (Join-Path $root 'wake.ps1'))){throw 'Installed capture health check failed.'}
$receipt=@{feature='whole-spoken-command';backend='pi-desktop';pid=$health.pid;startupPreserved=$true;paused=($health.state -eq 'paused');liveCallStarted=$false;verifiedAt=[datetime]::UtcNow.ToString('o')}
Write-JsonAtomic (Join-Path $root 'data/capture-installation.json') $receipt
$receipt|ConvertTo-Json -Compress
