param([string]$RootPath,[string]$PreviewPath,[switch]$BuildOnly,[switch]$NoApply)
$ErrorActionPreference='Stop'
$appRoot=if($RootPath){$RootPath}else{Split-Path (Split-Path $PSScriptRoot -Parent) -Parent}
$SettingsPath=Join-Path $appRoot 'settings.json'
Add-Type -AssemblyName System.Windows.Forms,System.Drawing,System.Speech
Add-Type -Path (Join-Path $PSScriptRoot 'settings-form.cs') -ReferencedAssemblies @([AppDomain]::CurrentDomain.GetAssemblies() | Where-Object {-not $_.IsDynamic -and $_.Location} | ForEach-Object {$_.Location} | Select-Object -Unique)
. (Join-Path $PSScriptRoot 'configuration.ps1')
. (Join-Path $PSScriptRoot 'commands.ps1')
$before=[IO.File]::ReadAllText($SettingsPath)
$configuration=Read-JarvisSettings $SettingsPath
$form=New-Object JarvisPiSettingsForm
$form.Text='Jarvis Pi — Wake word settings';$form.ClientSize=New-Object Drawing.Size(780,650)
$form.MinimumSize=New-Object Drawing.Size(700,580);$form.StartPosition='CenterScreen'
$form.Font=New-Object Drawing.Font('Segoe UI',10)
$form.BackColor=[Drawing.Color]::FromArgb(18,24,31);$form.ForeColor=[Drawing.Color]::FromArgb(225,235,241)
$tabs=New-Object Windows.Forms.TabControl;$tabs.Dock='Fill';$form.Controls.Add($tabs)
$fields=@{}
function Add-SettingsTab([string]$title) {
  $tab=New-Object Windows.Forms.TabPage;$tab.Text=$title;$tab.AutoScroll=$true
  $tab.BackColor=$form.BackColor;$tab.ForeColor=$form.ForeColor
  $grid=New-Object Windows.Forms.TableLayoutPanel;$grid.Dock='Top';$grid.AutoSize=$true;$grid.ColumnCount=2;$grid.Padding=New-Object Windows.Forms.Padding(18)
  $null=$grid.ColumnStyles.Add((New-Object Windows.Forms.ColumnStyle([Windows.Forms.SizeType]::Absolute,220)))
  $null=$grid.ColumnStyles.Add((New-Object Windows.Forms.ColumnStyle([Windows.Forms.SizeType]::Percent,100)))
  $tab.Controls.Add($grid);$tabs.TabPages.Add($tab);return $grid
}
function Add-SettingsField($grid,[string]$key,[string]$label,$control) {
  $row=$grid.RowCount;$grid.RowCount++
  $text=New-Object Windows.Forms.Label;$text.Text=$label;$text.AutoSize=$true;$text.MaximumSize=New-Object Drawing.Size(205,0);$text.Margin=New-Object Windows.Forms.Padding(0,7,10,12)
  $control.Name=$key;$control.Dock='Top';$control.Margin=New-Object Windows.Forms.Padding(0,4,0,12)
  $control.BackColor=[Drawing.Color]::FromArgb(31,42,53);$control.ForeColor=$form.ForeColor
  $grid.Controls.Add($text,0,$row);$grid.Controls.Add($control,1,$row);$fields[$key]=$control
}
function New-SettingsNumber([double]$value,[double]$min,[double]$max,[int]$decimals=0) {
  $c=New-Object Windows.Forms.NumericUpDown;$c.Minimum=$min;$c.Maximum=$max;$c.DecimalPlaces=$decimals;$c.Value=$value
  if($decimals){$c.Increment=[decimal]0.05};return $c
}
function New-SettingsLines($lines,[int]$height=75) {
  $c=New-Object Windows.Forms.TextBox;$c.Multiline=$true;$c.ScrollBars='Vertical';$c.Height=$height;$c.Text=@($lines) -join [Environment]::NewLine;return $c
}
$voice=Add-SettingsTab 'Poslouchání'
$culture=New-Object Windows.Forms.ComboBox;$culture.DropDownStyle='DropDownList'
foreach($name in @([System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers() | ForEach-Object {$_.Culture.Name} | Select-Object -Unique)){$null=$culture.Items.Add($name)}
$culture.SelectedItem=[string]$configuration.recognizerCulture
Add-SettingsField $voice 'recognizerCulture' 'Jazyk místního rozpoznávače' $culture
Add-SettingsField $voice 'minimumConfidence' 'Citlivost: nižší číslo přijímá více výsledků' (New-SettingsNumber $configuration.minimumConfidence 0.3 0.95 2)
Add-SettingsField $voice 'endingMinimumConfidence' 'Jistota požadovaná pro vypnutí hovoru' (New-SettingsNumber $configuration.endingMinimumConfidence 0.3 0.99 2)
Add-SettingsField $voice 'endSilenceMilliseconds' 'Pauza pro dokončení oslovení (ms)' (New-SettingsNumber $configuration.endSilenceMilliseconds 150 2500)
Add-SettingsField $voice 'ambiguousSilenceMilliseconds' 'Pauza při nejasném výsledku (ms)' (New-SettingsNumber $configuration.ambiguousSilenceMilliseconds 150 3500)
$behavior=New-Object Windows.Forms.ComboBox;$behavior.DropDownStyle='DropDownList';$behavior.Items.AddRange([object[]]@('toggle','wake'));$behavior.SelectedItem=$configuration.activationBehavior
Add-SettingsField $voice 'activationBehavior' 'Opakované oslovení: toggle = zapnout/vypnout; wake = jen zapnout' $behavior
$hint=New-Object Windows.Forms.Label;$hint.AutoSize=$true;$hint.MaximumSize=New-Object Drawing.Size(460,0)
$hint.Text='The local recognizer listens until paused. Match phrases to its installed language. Conversation voice and language remain selected in Pi Desktop.'
Add-SettingsField $voice 'voiceHint' '' $hint
$words=Add-SettingsTab 'Oslovení a příkazy'
Add-SettingsField $words 'wakePhrases' 'Oslovení, každé na vlastní řádek' (New-SettingsLines $configuration.wakePhrases 65)
foreach($entry in @(@('wake','Zapnout hlas'),@('new-chat','Nový chat'),@('end','Ukončit hovor'),@('disable','Vypnout poslouchání'))){
  $value=if($configuration.commandOverrides.PSObject.Properties.Name -contains $entry[0]){$configuration.commandOverrides.($entry[0])}else{$script:JarvisCommands[$entry[0]]}
  Add-SettingsField $words $entry[0] ($entry[1]+': fráze za oslovením') (New-SettingsLines $value 75)
}
$alerts=Add-SettingsTab 'Fronta a oznámení'
$enabled=New-Object Windows.Forms.CheckBox;$enabled.Text='Automaticky oznamovat otázky a výsledky';$enabled.Checked=$configuration.notificationsEnabled;$enabled.AutoSize=$true
Add-SettingsField $alerts 'notificationsEnabled' 'Automatická oznámení' $enabled
Add-SettingsField $alerts 'pollIntervalSeconds' 'Interval kontroly fronty (sekundy)' (New-SettingsNumber $configuration.pollIntervalSeconds 1 30 1)
$greeting=New-Object Windows.Forms.Label;$greeting.AutoSize=$true;$greeting.Text='Pi Desktop native GPT Live, using your selected account and voice.';$greeting.MaximumSize=New-Object Drawing.Size(460,0)
Add-SettingsField $alerts 'greetingVoice' 'Presence greeting' $greeting
Add-SettingsField $alerts 'invitationCooldownMinutes' 'Nejkratší odstup pozvání (minuty)' (New-SettingsNumber $configuration.invitationCooldownMinutes 1 1440)
Add-SettingsField $alerts 'invitationTimeoutSeconds' 'Bez odpovědi ukončit za (sekundy)' (New-SettingsNumber $configuration.invitationTimeoutSeconds 5 60)
Add-SettingsField $alerts 'returnIdleSeconds' 'Nepřítomnost po (sekundy)' (New-SettingsNumber $configuration.returnIdleSeconds 30 3600)
$note=New-Object Windows.Forms.Label;$note.AutoSize=$true;$note.MaximumSize=New-Object Drawing.Size(460,0);$note.Text='GPT Live reads the persistent queue. Pause silences invitations. Another active microphone session defers automatic calls.'
Add-SettingsField $alerts 'queueHint' '' $note
$footer=New-Object Windows.Forms.FlowLayoutPanel;$footer.Dock='Bottom';$footer.Height=54;$footer.FlowDirection='RightToLeft';$footer.Padding=New-Object Windows.Forms.Padding(10)
$save=New-Object Windows.Forms.Button;$save.Text='Uložit a použít';$save.Width=155;$save.Height=32
$cancel=New-Object Windows.Forms.Button;$cancel.Text='Zavřít';$cancel.Width=100;$cancel.Height=32;$cancel.Add_Click({$form.Close()})
$footer.Controls.AddRange([Windows.Forms.Control[]]@($save,$cancel));$form.Controls.Add($footer)
$errorLabel=New-Object Windows.Forms.Label;$errorLabel.Dock='Bottom';$errorLabel.Height=40;$errorLabel.Padding=New-Object Windows.Forms.Padding(15,4,15,0);$errorLabel.ForeColor=[Drawing.Color]::Salmon;$form.Controls.Add($errorLabel)
$save.Add_Click({
  try{
    $next=Read-JarvisSettings $SettingsPath
    foreach($key in @('minimumConfidence','endingMinimumConfidence','pollIntervalSeconds','invitationCooldownMinutes','invitationTimeoutSeconds','returnIdleSeconds','endSilenceMilliseconds','ambiguousSilenceMilliseconds')){$next.$key=[double]$fields[$key].Value}
    if(-not $fields.recognizerCulture.SelectedItem){throw 'Vyberte nainstalovaný jazyk rozpoznávače.'}
    $next.recognizerCulture=[string]$fields.recognizerCulture.SelectedItem
    $next.activationBehavior=[string]$fields.activationBehavior.SelectedItem
    $next.notificationsEnabled=$fields.notificationsEnabled.Checked
    $next.wakePhrases=@($fields.wakePhrases.Lines | ForEach-Object {$_.Trim()} | Where-Object {$_})
    $next.commandOverrides=[pscustomobject]@{}
    foreach($key in @('wake','new-chat','end','disable')){$next.commandOverrides | Add-Member -NotePropertyName $key -NotePropertyValue @($fields[$key].Lines | ForEach-Object {$_.Trim()} | Where-Object {$_} | Select-Object -Unique)}
    Save-JarvisSettings $next $SettingsPath $before
    $script:settingsWindowSaved=$true
    if(-not $BuildOnly -and -not $NoApply){$null=& (Join-Path $appRoot 'control.ps1') -Action reload-settings}
    $form.Close()
  }catch{$errorLabel.Text=$_.Exception.Message}
})
if($BuildOnly){return @{form=$form;fields=$fields;save=$save;error=$errorLabel}}
if($PreviewPath){
  $null=$form.Handle
  # Headless rendering only: the native window remains hidden. Set the managed
  # layout flag after HWND creation so child controls can render without Show().
  $setState=[Windows.Forms.Control].GetMethod('SetState',[Reflection.BindingFlags]'Instance,NonPublic')
  $visible=[Enum]::Parse($setState.GetParameters()[0].ParameterType,'Visible')
  $null=$setState.Invoke($form,@($visible,$true))
  $form.CreateControl();$form.PerformLayout();$tabs.CreateControl();$tabs.PerformLayout()
  $bitmap=New-Object Drawing.Bitmap($form.Width,$form.Height)
  try{$form.DrawToBitmap($bitmap,(New-Object Drawing.Rectangle(0,0,$bitmap.Width,$bitmap.Height)));$bitmap.Save($PreviewPath)}finally{$bitmap.Dispose();$form.Dispose()};return
}
[Windows.Forms.Application]::Run($form);$form.Dispose()
