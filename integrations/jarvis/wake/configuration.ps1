function Read-JarvisSettings([string]$Path=(Join-Path $PSScriptRoot 'settings.json')) {
  $configuration=Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
  $defaults=@{wakePhrases=@('Hey Jarvis');pollIntervalSeconds=2;notificationsEnabled=$true;notificationVoice='';notificationRate=0;notificationVolume=85;announcementMaxChars=900;announcementTimeoutSeconds=90;endSilenceMilliseconds=350;ambiguousSilenceMilliseconds=600;activationBehavior='toggle';recognizerCulture='en-GB';commandOverrides=[pscustomobject]@{}}
  foreach($key in $defaults.Keys){if($configuration.PSObject.Properties.Name -notcontains $key){$configuration | Add-Member -NotePropertyName $key -NotePropertyValue $defaults[$key]}}
  foreach($entry in @{invitationCooldownMinutes=30;invitationTimeoutSeconds=10;returnIdleSeconds=120}.GetEnumerator()){if($configuration.PSObject.Properties.Name -notcontains $entry.Key){$configuration|Add-Member -NotePropertyName $entry.Key -NotePropertyValue $entry.Value}}
  if($configuration.PSObject.Properties.Name -notcontains 'endingMinimumConfidence'){$configuration|Add-Member -NotePropertyName endingMinimumConfidence -NotePropertyValue 0.8}
  Assert-JarvisSettings $configuration
  return $configuration
}
function Assert-JarvisSettings($configuration) {
  foreach($spec in @(@('invitationCooldownMinutes',1,1440),@('invitationTimeoutSeconds',5,60),@('returnIdleSeconds',30,3600))){if($configuration.PSObject.Properties.Name -contains $spec[0]){$n=0.0;if(-not [double]::TryParse([string]$configuration.($spec[0]),[ref]$n) -or $n -lt $spec[1] -or $n -gt $spec[2]){throw ('Invalid setting: '+$spec[0])}}}
  foreach($spec in @(@('minimumConfidence',0.3,0.95),@('endingMinimumConfidence',0.3,0.99),@('pollIntervalSeconds',1,30),@('notificationRate',-5,5),@('notificationVolume',0,100),@('announcementMaxChars',100,2000),@('announcementTimeoutSeconds',15,180),@('endSilenceMilliseconds',150,2500),@('ambiguousSilenceMilliseconds',150,3500))){
    $value=$configuration.($spec[0]);$number=0.0
    if(-not [double]::TryParse([string]$value,[Globalization.NumberStyles]::Float,[Globalization.CultureInfo]::InvariantCulture,[ref]$number) -or $number -lt $spec[1] -or $number -gt $spec[2]){throw ('Invalid setting: '+$spec[0])}
  }
  if($configuration.activationBehavior -notin @('toggle','wake')){throw 'Activation behavior must be toggle or wake.'}
  if(@($configuration.wakePhrases).Count -notin 1..12){throw 'Use 1 to 12 wake phrases.'}
  foreach($phrase in @($configuration.wakePhrases)){
    if($phrase -isnot [string] -or [string]::IsNullOrWhiteSpace($phrase) -or $phrase.Length -gt 60 -or $phrase -match '[\r\n\x00-\x1f]'){throw 'A wake phrase must be a single line of 1–60 characters.'}
  }
  $seen=@{}
  foreach($property in $configuration.commandOverrides.PSObject.Properties){
    if($property.Name -notin @('wake','new-chat','end','disable')){throw 'Unknown command group.'}
    if(@($property.Value).Count -notin 1..60){throw 'Use 1 to 60 phrases in each command group.'}
    foreach($phrase in @($property.Value)){
      if($phrase -isnot [string] -or [string]::IsNullOrWhiteSpace($phrase) -or $phrase.Length -gt 100 -or $phrase -match '[\r\n\x00-\x1f]'){throw 'Each command phrase must be a single line of 1–100 characters.'}
      $key=$phrase.Trim().ToLowerInvariant()
      if($seen.ContainsKey($key) -and $seen[$key] -ne $property.Name){throw ('The phrase belongs to two actions: '+$phrase)}
      $seen[$key]=$property.Name
    }
  }
  try{$null=[Globalization.CultureInfo]::GetCultureInfo([string]$configuration.recognizerCulture)}catch{throw 'Invalid recognizer culture.'}
}
function Save-JarvisSettings($Configuration,[string]$Path,[string]$ExpectedContent) {
  Assert-JarvisSettings $Configuration
  if([IO.File]::ReadAllText($Path) -cne $ExpectedContent){throw 'Settings changed in another window. Reopen Settings before saving.'}
  $temporary=$Path+'.'+[Guid]::NewGuid().ToString('N')+'.tmp'
  try{
    [IO.File]::WriteAllText($temporary,($Configuration|ConvertTo-Json -Depth 6),(New-Object Text.UTF8Encoding($false)))
    Move-Item -LiteralPath $temporary -Destination $Path -Force
  }finally{Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue}
}
function Get-JarvisWakePhrases {
  if($settings -and $settings.PSObject.Properties.Name -contains 'wakePhrases'){return @($settings.wakePhrases | ForEach-Object {$_.Trim().ToLowerInvariant()} | Select-Object -Unique)}
  return @('hey jarvis')
}
function Remove-JarvisWakeFromSpeech([string]$Text) {
  foreach($wake in @(Get-JarvisWakePhrases | Sort-Object Length -Descending)){
    $parts=@($wake -split '\s+' | ForEach-Object {[regex]::Escape($_)})
    $Text=[regex]::Replace($Text,'(?i)(?<!\p{L})'+($parts -join '[\s\p{P}]+')+'(?!\p{L})','asistent')
  }
  if(@(Get-JarvisWakePhrases) -match '(?i)jarvis'){$Text=[regex]::Replace($Text,'(?i)(?<!\p{L})jarvis(?:i|e)?(?!\p{L})','asistent')}
  return $Text
}
