$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'listener-identity.ps1')
$helper='C:\fixture\wake.ps1'
$legacy=[pscustomobject]@{Name='pwsh.exe';CommandLine='pwsh -NoProfile -File "C:\fixture\wake.ps1"'}
if(-not (Test-JarvisListenerIdentity $legacy $helper)){throw 'Legacy identity rejected'}
foreach($line in @('pwsh -File "C:\fixture\other.ps1"','pwsh -File "C:\fixture\wake.ps1" -Check','pwsh -EncodedCommand Zm9v')){
 if(Test-JarvisListenerIdentity ([pscustomobject]@{Name='pwsh.exe';CommandLine=$line}) $helper){throw 'Unrelated command accepted'}
}
foreach($paused in @('',' -StartPaused')){
 $text="& 'C:\fixture\wake.ps1'"+$paused+" 1> 'C:\fixture\data\launch-output.log' 2> 'C:\fixture\data\launch-error.log'"
 $encoded=[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($text))
 if(-not (Test-JarvisListenerIdentity ([pscustomobject]@{Name='pwsh.exe';CommandLine=('pwsh -EncodedCommand '+$encoded)}) $helper)){throw 'Encoded identity rejected'}
}
Write-Output 'PASS exact legacy/encoded listener identity, paused launch and unrelated/check rejection'
