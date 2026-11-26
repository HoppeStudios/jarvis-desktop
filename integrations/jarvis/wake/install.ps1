param([string]$RootPath=(Join-Path $env:LOCALAPPDATA 'JarvisWake'),[string]$PythonPath,[string]$ImportDirectory,[switch]$ValidateOnly)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'state.ps1')
$source=Split-Path $PSScriptRoot -Parent
$root=[IO.Path]::GetFullPath($RootPath)
if(-not (Test-Path -LiteralPath (Join-Path $root 'settings.json')) -or -not (Test-Path -LiteralPath (Join-Path $root 'Inbox\cli.mjs'))){throw 'Install the existing shared Jarvis queue and settings first. This installer never creates a second queue.'}
. (Join-Path $PSScriptRoot 'powershell.ps1')
$hostPath=Get-JarvisPowerShell -SettingsPath (Join-Path $root 'settings.json')
if(-not $PythonPath){$PythonPath=(& python -c 'import sys;print(sys.executable)').Trim()}
if(-not (Test-Path -LiteralPath $PythonPath -PathType Leaf)){throw 'A pinned Python 3.11+ executable is required.'}
& $PythonPath -c 'import sys;assert sys.version_info >= (3,11)'
if($LASTEXITCODE -ne 0){throw 'Python 3.11+ is required.'}
$data=Join-Path $root 'data';$id=[guid]::NewGuid().ToString('N');$inputFile=Join-Path $data ($id+'.install-request.json');$outputFile=Join-Path $data ($id+'.install-result.json')
try {
 [IO.File]::WriteAllText($inputFile,'{"operation":"status"}')
 & $PythonPath (Join-Path $PSScriptRoot 'desktop_control.py') --root $root --request $inputFile --result $outputFile
 if($LASTEXITCODE -ne 0){throw 'Pi Desktop control health check failed.'}
 $check=Get-Content -LiteralPath $outputFile -Raw|ConvertFrom-Json
 if(-not $check.ok){throw 'Pi Desktop must be running with its reviewed MCP bridge.'}
 $live=$check.result
 if($live.pendingRequestId -or ($live.call -and ($live.call.phase -notin @('ended','failed') -or $live.call.mediaRelease -eq 'unconfirmed'))){throw 'Installation deferred: Pi voice is active or release is unconfirmed.'}
}finally{Remove-Item -LiteralPath $inputFile,$outputFile -Force -ErrorAction SilentlyContinue}
$metadata=Get-Content -LiteralPath (Join-Path $HOME '.pi-desktop\mcp-control.json') -Raw|ConvertFrom-Json
$desktop=Get-Process -Id $metadata.pid -ErrorAction Stop
if($desktop.ProcessName -ine 'PI-Desktop' -or -not (Test-Path -LiteralPath $desktop.Path -PathType Leaf)){throw 'The active MCP owner is not the reviewed Pi Desktop executable.'}
if(-not $ImportDirectory){$candidate=Join-Path $env:LOCALAPPDATA 'JarvisPi\migration\pi-import\sessions';if(Test-Path -LiteralPath $candidate -PathType Container){$ImportDirectory=$candidate}}
if($ImportDirectory){$ImportDirectory=[IO.Path]::GetFullPath($ImportDirectory);if(-not (Test-Path -LiteralPath $ImportDirectory -PathType Container)){throw 'Configured history import folder is unavailable.'}}
$statusPath=Join-Path $data 'status.json'
$old=if(Test-Path -LiteralPath $statusPath){Read-JsonShared $statusPath}else{$null}
$helper=Join-Path $root 'wake.ps1'
$owners=@(Get-CimInstance Win32_Process -Filter "Name='pwsh.exe' OR Name='powershell.exe'"|Where-Object {$_.CommandLine -like ('*'+$helper+'*') -and $_.CommandLine -notmatch '-(Check|TestWav|Trigger)'})
if($owners.Count -gt 1){throw 'More than one listener owner exists; preserve them and resolve registration first.'}
if($old -and $old.backend -ne 'pi-desktop'){
 $inspection=& $hostPath -STA -NoProfile -NonInteractive -File $helper -Trigger inspect
 if($LASTEXITCODE -ne 0){throw 'Installation deferred: old Codex call state could not be verified.'}
 $codex=$inspection|ConvertFrom-Json
 if(-not $codex.ok -or $codex.nativeState -ne 'idle'){throw 'Installation deferred: the existing Codex helper reports active or unknown voice.'}
}
& $hostPath -STA -NoProfile -NonInteractive -File (Join-Path $PSScriptRoot 'wake.ps1') -RootPath $root -Check
if($LASTEXITCODE -ne 0){throw 'Wake grammar or read-only presence checks failed.'}
if($ValidateOnly){@{validated=$true;backend='pi-desktop';existingListenerCount=$owners.Count}|ConvertTo-Json -Compress;return}
$scan=Get-Command Start-MpScan -ErrorAction SilentlyContinue
if(-not $scan){throw 'The required Windows Defender scan is unavailable.'}
Start-MpScan -ScanType CustomScan -ScanPath $source
$paused=$old -and $old.state -eq 'paused'
foreach($owner in $owners){
 # Revalidate identity immediately before stopping this task-owned listener.
 $current=Get-CimInstance Win32_Process -Filter ('ProcessId='+$owner.ProcessId)
 if(-not $current -or $current.CommandLine -cne $owner.CommandLine){throw 'Listener ownership changed; installation deferred.'}
 Stop-Process -Id $owner.ProcessId -ErrorAction Stop
 $until=[DateTime]::UtcNow.AddSeconds(5);while(Get-Process -Id $owner.ProcessId -ErrorAction SilentlyContinue){if([DateTime]::UtcNow -gt $until){throw 'Old listener has not exited.'};Start-Sleep -Milliseconds 50}
}
$piRoot=Join-Path $root 'Pi';$wakeRoot=Join-Path $piRoot 'wake';$mcpRoot=Join-Path $piRoot 'mcp'
New-Item -ItemType Directory -Path $wakeRoot,$mcpRoot -Force|Out-Null
$files=@('commands.ps1','configuration.ps1','invitation.ps1','desktop_control.py','call_sounds.py','desktop-launch.ps1','open-settings.ps1','presence.cs','powershell.ps1','settings.ps1','settings-form.cs','state.ps1')
foreach($name in $files){Copy-Item -LiteralPath (Join-Path $PSScriptRoot $name) -Destination (Join-Path $wakeRoot $name) -Force}
Copy-Item -LiteralPath (Join-Path $source 'mcp\stdio.py') -Destination (Join-Path $mcpRoot 'stdio.py') -Force
foreach($name in @('wake.ps1','control.ps1','launch.ps1')){Copy-Item -LiteralPath (Join-Path $PSScriptRoot $name) -Destination (Join-Path $root $name) -Force}
$runtime=@{backend='pi-desktop';version='3.0.0';python=$PythonPath;desktopExecutable=$desktop.Path;importDirectory=$ImportDirectory;source='https://github.com/HoppeStudios/jarvis-desktop';installedAt=[DateTime]::UtcNow.ToString('o')}
[IO.File]::WriteAllText((Join-Path $root 'pi-runtime.json'),($runtime|ConvertTo-Json -Compress),[Text.UTF8Encoding]::new($false))
foreach($name in $files){if((Get-FileHash (Join-Path $PSScriptRoot $name)).Hash -ne (Get-FileHash (Join-Path $wakeRoot $name)).Hash){throw ('Installed hash mismatch: '+$name)}}
foreach($name in @('wake.ps1','control.ps1','launch.ps1')){if((Get-FileHash (Join-Path $PSScriptRoot $name)).Hash -ne (Get-FileHash (Join-Path $root $name)).Hash){throw ('Installed hash mismatch: '+$name)}}
if((Get-FileHash (Join-Path $source 'mcp\stdio.py')).Hash -ne (Get-FileHash (Join-Path $mcpRoot 'stdio.py')).Hash){throw 'Installed MCP transport hash mismatch.'}
$startup=[Environment]::GetFolderPath('Startup');$shortcutPath=Join-Path $startup 'Jarvis Wake.lnk'
$shell=New-Object -ComObject WScript.Shell;$shortcut=$shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath=$hostPath;$shortcut.Arguments='-STA -NoProfile -NonInteractive -WindowStyle Hidden -File "'+(Join-Path $root 'launch.ps1')+'"';$shortcut.WorkingDirectory=$root;$shortcut.IconLocation=Join-Path $root 'icon.ico';$shortcut.Save()
$programs=[Environment]::GetFolderPath('Programs')
$settingsShortcut=$shell.CreateShortcut((Join-Path $programs 'Jarvis Settings.lnk'))
$settingsShortcut.TargetPath=$hostPath;$settingsShortcut.Arguments='-STA -NoProfile -NonInteractive -WindowStyle Hidden -File "'+(Join-Path $wakeRoot 'open-settings.ps1')+'"';$settingsShortcut.WorkingDirectory=$root;$settingsShortcut.IconLocation=Join-Path $root 'icon.ico';$settingsShortcut.Save()
$guiShortcut=$shell.CreateShortcut((Join-Path $programs 'Pi - Jarvis.lnk'))
$guiShortcut.TargetPath=$hostPath;$guiShortcut.Arguments='-STA -NoProfile -NonInteractive -WindowStyle Hidden -File "'+(Join-Path $wakeRoot 'desktop-launch.ps1')+'"';$guiShortcut.WorkingDirectory=$root;$guiShortcut.IconLocation=Join-Path $root 'icon.ico';$guiShortcut.Save()
& $hostPath -STA -NoProfile -NonInteractive -File (Join-Path $root 'launch.ps1') -StartPaused:$paused
if($LASTEXITCODE -ne 0){throw 'Pi listener launch failed.'}
$deadline=[DateTime]::UtcNow.AddSeconds(8);$healthy=$false
do{
 Start-Sleep -Milliseconds 100
 if(Test-Path -LiteralPath $statusPath){$status=Read-JsonShared $statusPath;$process=Get-CimInstance Win32_Process -Filter ('ProcessId='+$status.pid);if($status.backend -eq 'pi-desktop' -and $process -and $process.CommandLine -like ('*'+$helper+'*')){$healthy=$true;break}}
}while([DateTime]::UtcNow -lt $deadline)
if(-not $healthy){throw 'The installed Pi listener did not pass its running-state check.'}
if($paused -and $status.state -ne 'paused'){throw 'Paused state was not preserved.'}
$retired=@();$active=@(Get-CimInstance Win32_Process|Where-Object {$_.ProcessId -ne $PID -and $_.CommandLine})
foreach($name in @('commands.ps1','configuration.ps1','voice-actions.ps1','coordinator.ps1','question-alerts.ps1','settings-launch.ps1','settings-window.ps1','install-context.ps1','install.ps1','coordinator-prompt.md','question-context.md','status-context.md','natural-context.md','voice-context.md','Greeting\greeting.wav','Greeting\greeting.json','Greeting\README.md')){
 $path=[IO.Path]::GetFullPath((Join-Path $root $name))
 if(-not $path.StartsWith($root+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Retirement target escaped the selected install root.'}
 if(Test-Path -LiteralPath $path -PathType Leaf){$item=Get-Item -LiteralPath $path;$parent=Get-Item -LiteralPath $item.DirectoryName;if(($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -or ($parent.Attributes -band [IO.FileAttributes]::ReparsePoint)){continue};if(@($active|Where-Object {$_.CommandLine.IndexOf($path,[StringComparison]::OrdinalIgnoreCase) -ge 0}).Count){continue};Remove-Item -LiteralPath $path -Force;$retired+=$name}
}
$greeting=Join-Path $root 'Greeting';if((Test-Path -LiteralPath $greeting) -and -not @(Get-ChildItem -LiteralPath $greeting -Force).Count){Remove-Item -LiteralPath $greeting}
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'README.md') -Destination (Join-Path $root 'README.md') -Force
$receipt=@{backend='pi-desktop';version='3.0.0';pid=$status.pid;startup=$shortcutPath;paused=($status.state -eq 'paused');queuePreserved=$true;filesVerified=$files.Count+4;backupCreated=$false;retiredFiles=$retired;installedAt=[DateTime]::UtcNow.ToString('o')}
[IO.File]::WriteAllText((Join-Path $data 'pi-installation.json'),($receipt|ConvertTo-Json -Depth 5),[Text.UTF8Encoding]::new($false))
$receipt|ConvertTo-Json -Compress
