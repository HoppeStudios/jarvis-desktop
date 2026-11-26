# Process identity for both legacy -File launches and detached encoded launches.
function Test-JarvisListenerIdentity($Process,[string]$HelperPath) {
 if(-not $Process -or $Process.Name -notin @('pwsh.exe','powershell.exe')){return $false}
 $line=[string]$Process.CommandLine
 $helper=[IO.Path]::GetFullPath($HelperPath)
 if($line -match '(?i)-EncodedCommand\s+([A-Za-z0-9+/=]+)(?:\s|$)'){
  try{$actual=[Text.Encoding]::Unicode.GetString([Convert]::FromBase64String($Matches[1]))}catch{return $false}
  $quote={param($v) "'"+([string]$v).Replace("'","''")+"'"}
  $root=Split-Path $helper -Parent
  foreach($paused in @('',' -StartPaused')){
   $expected='& '+(& $quote $helper)+$paused+' 1> '+(& $quote (Join-Path $root 'data\launch-output.log'))+' 2> '+(& $quote (Join-Path $root 'data\launch-error.log'))
   if($actual -ceq $expected){return $true}
  }
  return $false
 }
 $escaped=[regex]::Escape($helper)
 return $line -match ('(?i)(?:^|\s)-File\s+(?:"'+$escaped+'"|'+$escaped+')(?:\s+-StartPaused)?\s*$')
}
