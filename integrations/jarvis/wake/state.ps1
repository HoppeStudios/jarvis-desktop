function Read-JsonShared([string]$Path,[switch]$AsHashtable) {
 $stream=[IO.FileStream]::new($Path,[IO.FileMode]::Open,[IO.FileAccess]::Read,([IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete))
 $reader=[IO.StreamReader]::new($stream,[Text.Encoding]::UTF8,$true)
 try{return ($reader.ReadToEnd()|ConvertFrom-Json -AsHashtable:$AsHashtable)}finally{$reader.Dispose()}
}
function Write-JsonAtomic([string]$Path,$Value) {
 $temp=$Path+'.'+[guid]::NewGuid().ToString('N')+'.tmp'
 try{
  [IO.File]::WriteAllText($temp,($Value|ConvertTo-Json -Depth 12 -Compress),[Text.UTF8Encoding]::new($false))
  # Replace in one operation. Legacy readers may briefly deny delete sharing.
  for($attempt=0;$attempt -lt 20;$attempt++){
   try{[IO.File]::Move($temp,$Path,$true);return}
   catch [IO.IOException],[UnauthorizedAccessException]{if($attempt -eq 19){throw};Start-Sleep -Milliseconds 10}
  }
 }finally{Remove-Item -LiteralPath $temp -Force -ErrorAction SilentlyContinue}
}
