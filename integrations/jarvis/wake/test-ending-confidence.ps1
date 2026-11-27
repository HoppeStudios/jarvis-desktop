$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'commands.ps1')
$settings=[pscustomobject]@{minimumConfidence=0.55;endingMinimumConfidence=0.8;activationBehavior='toggle'}
function Result([string]$Action,[double]$Confidence){return [pscustomobject]@{Confidence=$Confidence;Semantics=[pscustomobject]@{Value=$Action}}}
if(Get-JarvisAction (Result end 0.5591925382614136) $true){throw 'Actual low-confidence random end was accepted'}
if((Get-JarvisAction (Result toggle 0.56) $false) -ne 'toggle'){throw 'Wake sensitivity changed'}
foreach($action in @('end','disable','new-chat','toggle','toggle-2')){
 if(Get-JarvisAction (Result $action 0.56) $true){throw ('Weak closing action accepted: '+$action)}
 if((Get-JarvisAction (Result $action 0.9) $true) -ne $action){throw ('Clear closing action rejected: '+$action)}
}
$settings.activationBehavior='wake'
if((Get-JarvisAction (Result toggle 0.56) $true) -ne 'toggle'){throw 'Ensure-on behavior changed'}
Write-Output 'PASS actual false-end regression, unchanged wake sensitivity, clear end/toggle/repeated-toggle and ensure-on mode'
