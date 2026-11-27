$ErrorActionPreference='Stop'
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'wake.ps1'),[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'Wake script parse failed'}
$function=$ast.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Invoke-CommandAction'},$true)
Invoke-Expression $function.Extent.Text
function Read-JarvisSettings {return $script:settings}
function New-Recognizer {return [IO.MemoryStream]::new()}
function Reset-JarvisAudioInput {}
function Update-JarvisAudioInput {}
function Register-Speech {}
function Voice-Request {return @{state='fixture'}}
$appRoot=$PSScriptRoot;$persistent=@{lastInvitation=0};$script:settings=@{};$script:processed=0;$script:paused=$true
$script:recognizer=[IO.MemoryStream]::new()
$original=@{callId='owned-invitation';deadline=1234};$script:invitation=$original
Invoke-CommandAction 'reload-settings' $null
if(-not [object]::ReferenceEquals($original,$script:invitation)){throw 'Settings reload lost the live invitation timer'}
Invoke-CommandAction 'end' $null
if($null -ne $script:invitation){throw 'Explicit End must clear the invitation'}
'Settings reload preserves the invitation; explicit End cancels it.'
