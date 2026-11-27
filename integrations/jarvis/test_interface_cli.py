import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

source=Path(__file__).parent/'skills/jarvis-computer-control/scripts/chat.py'
spec=importlib.util.spec_from_file_location('interface_cli',source)
cli=importlib.util.module_from_spec(spec);spec.loader.exec_module(cli)

class CliTests(unittest.TestCase):
    def setUp(self):
        self.folder=tempfile.TemporaryDirectory();self.addCleanup(self.folder.cleanup)
        self.root=Path(self.folder.name)/'JarvisWake';self.root.mkdir()
        (self.root/'pi-runtime.json').write_text('{"backend":"pi-desktop"}')
        self.environment=patch.dict(os.environ,{'LOCALAPPDATA':self.folder.name});self.environment.start();self.addCleanup(self.environment.stop)
        self.calls=[];self.closed=False;self.result={}
        case=self
        class Client:
            def invoke(self,operation,args):case.calls.append((operation,args));return case.result
            def close(self):case.closed=True
        self.module=patch.dict(sys.modules,{'desktop_control':types.SimpleNamespace(Client=Client)});self.module.start();self.addCleanup(self.module.stop)
        original_path=sys.path[:];self.addCleanup(lambda:sys.path.__setitem__(slice(None),original_path))
    def run_cli(self,*args):
        output=io.StringIO()
        with patch.object(sys,'argv',['chat.py',*args]),contextlib.redirect_stdout(output):cli.main()
        return json.loads(output.getvalue())
    def test_find_preserves_owner_scope_and_the_actual_native_response(self):
        self.result={'status':'matched','match':{'id':'actual-pi-view'}}
        self.assertEqual(self.run_cli('find','protokol','--owner','codex','--include-archived')['match']['id'],'actual-pi-view')
        self.assertEqual(self.calls,[('session/find',[{'query':'protokol','owner':'codex','includeArchived':True,'limit':3}])]);self.assertTrue(self.closed)
    def test_explicit_native_canonical_receipt_retains_both_identities_without_sending_native_id_as_pi_id(self):
        original='remote:codex-shared:native-thread'
        self.result={'requestedSessionId':original,'session':{'id':'pi-canonical','title':'Original','nativeOwner':{'hostKey':'codex-shared','sessionId':'native-thread','viewId':'pi-canonical'}}}
        result=self.run_cli('open',original)
        self.assertEqual(result['requestedSessionId'],original);self.assertEqual(result['sessionId'],'pi-canonical')
        self.assertTrue(result['navigationOnly']);self.assertFalse(result['selectionVerified'])
        self.assertEqual(self.calls,[('session/open',[original])])
    def test_identity_mismatch_never_becomes_success_or_fallback(self):
        self.result={'session':{'id':'different'}}
        with self.assertRaises(RuntimeError):self.run_cli('open','requested')
        self.assertEqual(self.calls,[('session/open',['requested'])]);self.assertTrue(self.closed)
    def test_unselected_runtime_never_uses_pi_tools(self):
        (self.root/'pi-runtime.json').write_text('{"backend":"codex"}')
        with self.assertRaises(RuntimeError):self.run_cli('find','protocol')
        self.assertFalse(self.calls)

if __name__=='__main__':unittest.main()
