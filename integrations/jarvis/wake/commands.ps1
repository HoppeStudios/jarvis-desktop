# Compositional local grammar: optional politeness + intent + optional ending.
# Native voice handles unrestricted language after the wake command connects.
$script:JarvisCommands=@{
  wake=@('wake up','are you there','listen','listen to me','start voice','start voice chat','can we talk','let us talk','talk to me')
  'new-chat'=@('new chat','a new chat','new conversation','a new conversation','start another chat','start another conversation')
  end=@('end','finish','stop','end chat','finish chat','stop voice','end voice','end voice chat','finish voice chat','end the chat','finish the chat','end this chat','finish this chat','end the conversation','end this conversation','finish this conversation','end the voice chat','end this voice chat','close the voice chat','close this voice chat','end the call','end this call','finish the call','hang up','disconnect','we are done',"we're done",'I am done',"I'm done",'that is all',"that's all",'goodbye')
  disable=@('disable voice','pause voice','stop listening','pause listening','stop listening to me','disable the voice','disable voice activation','stop voice activation','disable the wake word','stop the wake word','turn off voice','turn off the voice','turn voice off','turn the voice off','switch off voice','switch voice off','turn off the microphone','turn the microphone off','disable the microphone','disable listening')
  ignore=@('stop talking','stop speaking','be quiet','quiet','wait','hold on','stop working','cancel the task','do not speak',"don't speak")
}
foreach($verb in @('start','open','create','make','begin')){
  foreach($article in @('new','a new','fresh','a fresh')){
    foreach($noun in @('chat','conversation')){$script:JarvisCommands['new-chat']+=($verb+' '+$article+' '+$noun)}
  }
}

function New-JarvisGrammar([string]$Culture='en-GB') {
  $commands=@{}
  foreach($key in $script:JarvisCommands.Keys){$commands[$key]=@($script:JarvisCommands[$key])}
  if($settings -and $settings.PSObject.Properties.Name -contains 'commandOverrides'){
    foreach($property in $settings.commandOverrides.PSObject.Properties){$commands[$property.Name]=@($property.Value)}
  }
  $wakePhrases=if(Get-Command Get-JarvisWakePhrases -ErrorAction SilentlyContinue){@(Get-JarvisWakePhrases)}else{@('hey jarvis')}
  $prefix=New-Object System.Speech.Recognition.Choices
  $prefix.Add([string[]]@('please','can you','could you','would you','can you please','could you please','would you please','I want you to','I would like you to'))
  $suffix=New-Object System.Speech.Recognition.Choices
  $suffix.Add([string[]]@('please','for me','for me please','thanks','thank you','now','now please'))
  $alternatives=New-Object System.Speech.Recognition.Choices
  $wake=New-Object System.Speech.Recognition.GrammarBuilder
  foreach($wakePhrase in $wakePhrases){
    $wake=New-Object System.Speech.Recognition.GrammarBuilder
    $wake.Append((New-Object System.Speech.Recognition.SemanticResultValue($wakePhrase,'toggle')))
    $alternatives.Add($wake)
  }
  # Rapid repetitions may be delivered as one utterance by SAPI. Preserve each
  # requested toggle rather than rejecting the phrase or treating it as one.
  foreach($wakePhrase in $wakePhrases){foreach($count in 2..4){
    $repeated=New-Object System.Speech.Recognition.GrammarBuilder
    $repeated.Append($wakePhrase,$count,$count)
    $tagged=New-Object System.Speech.Recognition.GrammarBuilder
    $tagged.Append((New-Object System.Speech.Recognition.SemanticResultValue($repeated,('toggle-'+$count))))
    $alternatives.Add($tagged)
  }}
  $allCommands=New-Object System.Speech.Recognition.Choices
  foreach($action in @('wake','new-chat','end','disable','ignore')){
    $phrases=New-Object System.Speech.Recognition.Choices
    $phrases.Add([string[]]$commands[$action])
    $allCommands.Add([string[]]$commands[$action])
    $intent=New-Object System.Speech.Recognition.GrammarBuilder
    $intent.Append($phrases)
    foreach($wakePhrase in $wakePhrases){
    $command=New-Object System.Speech.Recognition.GrammarBuilder
    $command.Append($wakePhrase);$command.Append($prefix,0,1)
    $command.Append((New-Object System.Speech.Recognition.SemanticResultValue($intent,$action)))
    $command.Append($suffix,0,1)
    $alternatives.Add($command)
    }
  }
  # Recognize negated commands as ignored, instead of forcing them into a
  # positive-only grammar. Never use edit distance to guess command actions.
  $negation=New-Object System.Speech.Recognition.Choices
  $negation.Add([string[]]@('do not',"don't",'never'))
  foreach($wakePhrase in $wakePhrases){
  $negative=New-Object System.Speech.Recognition.GrammarBuilder
  $negative.Append($wakePhrase);$negative.Append($prefix,0,1);$negative.Append($negation);$negative.Append($allCommands);$negative.Append($suffix,0,1)
  $ignored=New-Object System.Speech.Recognition.GrammarBuilder
  $ignored.Append((New-Object System.Speech.Recognition.SemanticResultValue($negative,'ignore')))
  $alternatives.Add($ignored)
  }
  $root=New-Object System.Speech.Recognition.GrammarBuilder
  $root.Culture=[Globalization.CultureInfo]::GetCultureInfo($Culture)
  $root.Append($alternatives)
  $grammar=New-Object System.Speech.Recognition.Grammar($root)
  $grammar.Name='Jarvis flexible wake commands'
  return $grammar
}

function Get-JarvisAction($result,[bool]$VoiceActive=$false) {
  if($null -eq $result -or $result.Confidence -lt $settings.minimumConfidence){return $null}
  $action=[string]$result.Semantics.Value
  if($action -notin @('toggle','toggle-2','toggle-3','toggle-4','wake','new-chat','end','disable')){return $null}
  $closing=$action -in @('end','disable') -or ($VoiceActive -and $action -eq 'new-chat') -or
    ($settings.activationBehavior -ne 'wake' -and (($VoiceActive -and $action -like 'toggle*') -or $action -match '^toggle-[2-4]$'))
  if($closing){
    $threshold=0.8
    if($settings.PSObject.Properties.Name -contains 'endingMinimumConfidence'){$threshold=[double]$settings.endingMinimumConfidence}
    if($result.Confidence -lt [Math]::Max([double]$settings.minimumConfidence,$threshold)){return $null}
  }
  return $action
}
