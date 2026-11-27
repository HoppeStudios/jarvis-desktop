$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'control-diagnostics-install.ps1')
$fixture=@'
def transport():
    pass
class Client:
    def __init__(self):
        self.connection = transport().DesktopConnection(json.loads((Path.home()/'.pi-desktop/mcp-control.json').read_text()))
        self.sequence = 0
def native_call():
    # Existing independently installed call sounds must remain unchanged.
    return notify_call_sound(root, client.invoke('voice/control', [payload], True), receipt=True)
def poll():
    if True:
        try:
            pass
        except (OSError, ValueError, RuntimeError, subprocess.SubprocessError):
            pass
def main():
    try:
        pass
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError):
        pass
'@
$merged=Add-JarvisControlDiagnostics $fixture
if(-not $merged.Contains('except ControlUnavailable as error:') -or -not $merged.Contains("metadata.get('active') is False") -or
 -not $merged.Contains("return notify_call_sound(root, client.invoke('voice/control', [payload], True), receipt=True)")){throw 'Diagnostics merge changed existing runtime behavior.'}
if((Add-JarvisControlDiagnostics $merged) -cne $merged){throw 'Diagnostics merge is not idempotent.'}
try{$null=Add-JarvisControlDiagnostics ($fixture.Replace('def transport():','def renamed_transport():'));throw 'Missing anchor was not rejected.'}catch{if($_.Exception.Message -eq 'Missing anchor was not rejected.'){throw}}
'PASS specific inactive diagnostics, call-sound preservation, idempotence and drift refusal'
