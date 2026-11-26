param([switch]$StartPaused)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'Pi\wake\powershell.ps1')
. (Join-Path $PSScriptRoot 'Pi\wake\listener-identity.ps1')
& (Join-Path $PSScriptRoot 'Pi\wake\desktop-launch.ps1') -Background
$helper=Join-Path $PSScriptRoot 'wake.ps1'
$existing=Get-CimInstance Win32_Process -Filter "Name='pwsh.exe' OR Name='powershell.exe'" | Where-Object { Test-JarvisListenerIdentity $_ $helper }
if($existing){Write-Output 'Jarvis wake listener is already running.';return}
$powershell=Get-JarvisPowerShell -SettingsPath (Join-Path $PSScriptRoot 'settings.json')
$dataRoot=Join-Path $PSScriptRoot 'data';New-Item -ItemType Directory -Force -Path $dataRoot | Out-Null
# Redirect inside the detached child. Start-Process stream redirection can keep
# an installer caller's capture pipes alive for the listener's whole lifetime.
function Quote-JarvisLiteral([string]$value){return "'"+$value.Replace("'","''")+"'"}
$command='& '+(Quote-JarvisLiteral $helper)
if($StartPaused){$command+=' -StartPaused'}
$command+=' 1> '+(Quote-JarvisLiteral (Join-Path $dataRoot 'launch-output.log'))+' 2> '+(Quote-JarvisLiteral (Join-Path $dataRoot 'launch-error.log'))
$encoded=[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
$start=[Diagnostics.ProcessStartInfo]::new()
$start.FileName=$powershell
$start.Arguments='-STA -NoProfile -NonInteractive -WindowStyle Hidden -EncodedCommand '+$encoded
$start.WorkingDirectory=$PSScriptRoot
$start.UseShellExecute=$true
$start.WindowStyle=[Diagnostics.ProcessWindowStyle]::Hidden
$child=[Diagnostics.Process]::Start($start)
$child.Dispose()
