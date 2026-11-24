param([switch]$StartPaused)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'Pi\wake\powershell.ps1')
$helper=Join-Path $PSScriptRoot 'wake.ps1'
$existing=Get-CimInstance Win32_Process -Filter "Name='pwsh.exe' OR Name='powershell.exe'" | Where-Object { $_.CommandLine -like ('*'+$helper+'*') -and $_.CommandLine -notmatch '-(Check|TestWav|Trigger)' }
if($existing){Write-Output 'Jarvis wake listener is already running.';return}
$powershell=Get-JarvisPowerShell
$dataRoot=Join-Path $PSScriptRoot 'data';New-Item -ItemType Directory -Force -Path $dataRoot | Out-Null
$arguments=@('-STA','-NoProfile','-NonInteractive','-WindowStyle','Hidden','-File',('"'+$helper+'"'))
if($StartPaused){$arguments+='-StartPaused'}
Start-Process -FilePath $powershell -ArgumentList $arguments -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -RedirectStandardError (Join-Path $dataRoot 'launch-error.log') | Out-Null
