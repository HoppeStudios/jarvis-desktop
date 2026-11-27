function Add-JarvisControlDiagnostics([string]$Text) {
 if($Text.Contains('class ControlUnavailable')){
  if(-not $Text.Contains('except ControlUnavailable as error:') -or -not $Text.Contains("metadata.get('active') is False")){throw 'Partial diagnostics installation requires review.'}
  return $Text
 }
 $source=[IO.File]::ReadAllText((Join-Path $PSScriptRoot 'desktop_control.py')).Replace("`r`n","`n")
 $classBlock=[regex]::Match($source,'(?ms)^class ControlUnavailable.*?(?=^def transport\()').Value
 $clientBlock=[regex]::Match($source,'(?ms)^        try:\n            metadata =.*?(?=^        self.sequence = 0)').Value.TrimEnd("`r","`n")
 if(-not $classBlock -or -not $clientBlock){throw 'Reviewed diagnostics source blocks are missing.'}
 $pairs=@(
  @('def transport():',($classBlock+'def transport():')),
  @("        self.connection = transport().DesktopConnection(json.loads((Path.home()/'.pi-desktop/mcp-control.json').read_text()))",$clientBlock),
  @('    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError):',"    except ControlUnavailable as error:`n        result = {'ok':False, 'error':str(error), 'errorCode':error.code}`n    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError):")
 )
 foreach($pair in $pairs){
  $matches=[regex]::Matches($Text,'(?m)^'+[regex]::Escape($pair[0])+'$')
  if($matches.Count -ne 1){throw 'Installed worker changed; diagnostics merge requires review.'}
  $match=$matches[0];$Text=$Text.Substring(0,$match.Index)+$pair[1]+$Text.Substring($match.Index+$match.Length)
 }
 return $Text
}
