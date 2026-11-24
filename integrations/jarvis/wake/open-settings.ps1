$ErrorActionPreference='Stop'
$root=Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$launched=& (Join-Path $PSScriptRoot 'desktop-launch.ps1') -Background -PassThru
if($launched){Start-Sleep -Seconds 3}
$runtime=Get-Content -LiteralPath (Join-Path $root 'pi-runtime.json') -Raw|ConvertFrom-Json
$id=[guid]::NewGuid().ToString('N');$request=Join-Path $root ('data\settings-'+$id+'.request.json');$result=Join-Path $root ('data\settings-'+$id+'.result.json')
try{
 [IO.File]::WriteAllText($request,'{"operation":"settings"}')
 & $runtime.python (Join-Path $PSScriptRoot 'desktop_control.py') --root $root --request $request --result $result
 if($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $result)){throw 'Pi Desktop settings could not be opened.'}
 $outcome=Get-Content -LiteralPath $result -Raw|ConvertFrom-Json
 if(-not $outcome.ok){throw $outcome.error}
}finally{Remove-Item -LiteralPath $request,$result -Force -ErrorAction SilentlyContinue}
