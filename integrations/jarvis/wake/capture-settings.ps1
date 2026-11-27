if(-not ('JarvisCaptureChoice' -as [type])){Add-Type -Path (Join-Path $PSScriptRoot 'capture-settings-form.cs') -ReferencedAssemblies @([AppDomain]::CurrentDomain.GetAssemblies()|Where-Object {-not $_.IsDynamic -and $_.Location}|ForEach-Object {$_.Location}|Select-Object -Unique)}
function Add-JarvisCaptureSettingsFields {
 $capture=Add-SettingsTab 'Spoken commands'
 $enabled=[Windows.Forms.CheckBox]::new();$enabled.Text='Capture and send the complete command';$enabled.Checked=$configuration.captureCommands;$enabled.AutoSize=$true
 Add-SettingsField $capture 'captureCommands' 'After the wake phrase' $enabled
 $language=[JarvisCaptureChoice]::new();$language.Items.AddRange([string[]]@('cs','en','auto'));$language.SelectedItem=$configuration.captureLanguage
 Add-SettingsField $capture 'captureLanguage' 'Local transcription language' $language
 $voice=[JarvisCaptureChoice]::new();$null=$voice.Items.Add('Windows default')
 $synth=[System.Speech.Synthesis.SpeechSynthesizer]::new();try{foreach($installedVoice in $synth.GetInstalledVoices()){$null=$voice.Items.Add($installedVoice.VoiceInfo.Name)}}finally{$synth.Dispose()}
 $voice.SelectedItem=$(if($configuration.captureTtsVoice){$configuration.captureTtsVoice}else{'Windows default'})
 Add-SettingsField $capture 'captureTtsVoice' 'Windows reply voice' $voice
 Add-SettingsField $capture 'captureSilenceMilliseconds' 'Finish after silence (ms)' (New-SettingsNumber $configuration.captureSilenceMilliseconds 300 2500)
 Add-SettingsField $capture 'captureEndPhrases' 'Optional final words, one per line' (New-SettingsLines $configuration.captureEndPhrases 65)
 Add-SettingsField $capture 'captureWakeAliases' 'Transcription spellings of wake names' (New-SettingsLines $configuration.captureWakeAliases 65)
 $hint=[Windows.Forms.Label]::new();$hint.AutoSize=$true;$hint.MaximumSize=[Drawing.Size]::new(460,0);$hint.Text='Captures your full command after the wake phrase. Codex handles the task in a text chat and Windows reads its reply when other calls are over. Pause stops listening and spoken replies.'
 Add-SettingsField $capture 'captureHint' '' $hint
}
function Save-JarvisCaptureSettingsFields($next,$fields) {
 $next.captureCommands=[bool]$fields.captureCommands.Checked
 $next.captureLanguage=[string]$fields.captureLanguage.SelectedItem
 $next.captureTtsVoice=$(if($fields.captureTtsVoice.SelectedItem -eq 'Windows default'){''}else{[string]$fields.captureTtsVoice.SelectedItem})
 $next.captureSilenceMilliseconds=[double]$fields.captureSilenceMilliseconds.Value
 foreach($key in @('captureEndPhrases','captureWakeAliases')){$next.$key=@($fields[$key].Lines|ForEach-Object {$_.Trim()}|Where-Object {$_}|Select-Object -Unique)}
}
