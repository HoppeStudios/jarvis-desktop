param([ValidateSet('status','toggle','wake','new-chat','end','disable','resume','reload-settings')][string]$Action='status')
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=New-Object Text.UTF8Encoding($false)
. (Join-Path $PSScriptRoot 'Pi\wake\state.ps1')
$dataRoot=Join-Path $PSScriptRoot 'data'
$statusPath=Join-Path $dataRoot 'status.json'
if(-not (Test-Path -LiteralPath $statusPath)){throw 'Jarvis wake listener has no status. Start launch.ps1 first.'}
$state=Read-JsonShared $statusPath
$owner=Get-CimInstance Win32_Process -Filter ('ProcessId='+$state.pid)
$expected=Join-Path $PSScriptRoot 'wake.ps1'
if(-not $owner -or $owner.CommandLine -notlike ('*'+$expected+'*')){throw 'Jarvis wake listener is not running.'}
if($Action -eq 'status'){$state|ConvertTo-Json -Compress;return}
$id=[Guid]::NewGuid().ToString('N')
$request=Join-Path $dataRoot ('request-'+$id+'.json');$result=Join-Path $dataRoot ('result-'+$id+'.json')
$temp=Join-Path $dataRoot ('pending-'+$id+'.tmp')
[IO.File]::WriteAllText($temp,(@{action=$Action;created=[DateTime]::UtcNow.ToString('o')}|ConvertTo-Json -Compress),(New-Object Text.UTF8Encoding($false)))
Move-Item -LiteralPath $temp -Destination $request
$deadline=[DateTime]::UtcNow.AddSeconds(70)
while(-not (Test-Path -LiteralPath $result) -and [DateTime]::UtcNow -lt $deadline){Start-Sleep -Milliseconds 100}
if(-not (Test-Path -LiteralPath $result)){throw 'Jarvis command timed out. Check data/status.json.'}
$response=Read-JsonShared $result
Remove-Item -LiteralPath $result -Force
$response|ConvertTo-Json -Compress
if(-not $response.ok){throw $response.error}
