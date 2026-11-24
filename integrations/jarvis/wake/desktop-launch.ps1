param([switch]$Background,[switch]$PassThru)
$ErrorActionPreference='Stop'
$root=Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$runtime=Get-Content -LiteralPath (Join-Path $root 'pi-runtime.json') -Raw|ConvertFrom-Json
$executable=[IO.Path]::GetFullPath([string]$runtime.desktopExecutable)
if(-not (Test-Path -LiteralPath $executable -PathType Leaf) -or [IO.Path]::GetFileName($executable) -ine 'PI-Desktop.exe'){throw 'The pinned Pi Desktop executable is unavailable.'}
$running=@(Get-Process -Name 'PI-Desktop' -ErrorAction SilentlyContinue|Where-Object {$_.Path -ieq $executable})
if($running -and $Background){if($PassThru){return $false};return}
$start=[Diagnostics.ProcessStartInfo]::new($executable);$start.UseShellExecute=$false;$start.CreateNoWindow=$true
$start.ArgumentList.Add('--force-renderer-accessibility');$start.Environment['PI_DESKTOP_MCP_CONTROL']='1'
if($runtime.importDirectory){if(-not (Test-Path -LiteralPath $runtime.importDirectory -PathType Container)){throw 'The configured history import folder is unavailable.'};$start.Environment['PI_DESKTOP_PI_IMPORT_DIR']=[string]$runtime.importDirectory}
if($Background){$start.Environment['PI_DESKTOP_JARVIS_BACKGROUND']='1'}
$null=[Diagnostics.Process]::Start($start)
if($PassThru){return (-not [bool]$running)}
