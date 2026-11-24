function Get-JarvisPowerShell([string]$PreferredPath,[string]$SettingsPath=(Join-Path $PSScriptRoot 'settings.json')) {
  $configured=$PreferredPath
  if(-not $configured -and (Test-Path -LiteralPath $SettingsPath)){
    $configuration=Get-Content -LiteralPath $SettingsPath -Raw | ConvertFrom-Json
    if($configuration.PSObject.Properties.Name -contains 'powershellPath'){$configured=[string]$configuration.powershellPath}
  }
  $candidates=if($configured){@($configured)}else{
    @((Join-Path $PSHOME 'pwsh.exe'),(Join-Path $env:ProgramFiles 'PowerShell\7\pwsh.exe'))+
      @((Get-Command pwsh.exe -ErrorAction SilentlyContinue).Source)
  }
  $available=@(foreach($candidate in ($candidates | Where-Object {$_} | Select-Object -Unique)){
    if(Test-Path -LiteralPath $candidate -PathType Leaf){
      $file=Get-Item -LiteralPath $candidate
      if($file.Name -eq 'pwsh.exe' -and $file.VersionInfo.FileMajorPart -ge 7 -and $file.VersionInfo.ProductVersion -notmatch 'preview|alpha|beta|rc'){
        [pscustomobject]@{Path=$file.FullName;Version=[version]('{0}.{1}.{2}.{3}' -f $file.VersionInfo.FileMajorPart,$file.VersionInfo.FileMinorPart,$file.VersionInfo.FileBuildPart,$file.VersionInfo.FilePrivatePart)}
      }
    }
  })
  if(-not $available.Count){throw 'A stable PowerShell 7 pwsh.exe is required. Install PowerShell 7 or correct powershellPath in the installed Jarvis settings.'}
  return ($available | Sort-Object Version -Descending | Select-Object -First 1).Path
}
