import http.server
import importlib.util
import json
import pathlib
import threading
import unittest

spec=importlib.util.spec_from_file_location('bridge',pathlib.Path(__file__).with_name('stdio.py'))
bridge=importlib.util.module_from_spec(spec);spec.loader.exec_module(bridge)


class BridgeTests(unittest.TestCase):
    def test_metadata_must_be_active_and_strictly_loopback(self):
        valid={'active':True,'url':'http://127.0.0.1:37123/mcp','token':'fixture'}
        self.assertEqual(bridge.endpoint(valid),valid['url'])
        for change in [{'active':False},{'url':'https://example.com/mcp'}, {'url':'http://127.0.0.1:37123/other'}, {'url':'http://user@127.0.0.1:37123/mcp'}, {'url':'http://127.0.0.1:37123/mcp?token=fixture'},{'token':''}]:
            with self.assertRaises(ValueError):bridge.endpoint({**valid,**change})

    def test_protocol_refusal_is_preserved_and_session_is_closed(self):
        calls=[]
        class Handler(http.server.BaseHTTPRequestHandler):
            def log_message(self,*args):pass
            def do_POST(self):
                calls.append(('POST',self.headers.get('Authorization'),self.headers.get('Mcp-Session-Id')))
                raw=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
                body=json.dumps({'jsonrpc':'2.0','id':raw['id'],'error':{'code':-32601,'message':'Operation is not exposed'}}).encode()
                self.send_response(200);self.send_header('Mcp-Session-Id','fixture-session');self.end_headers();self.wfile.write(body)
            def do_DELETE(self):
                calls.append(('DELETE',self.headers.get('Authorization'),self.headers.get('Mcp-Session-Id')))
                self.send_response(200);self.end_headers()
        with http.server.ThreadingHTTPServer(('127.0.0.1',0),Handler) as server:
            thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
            connection=bridge.DesktopConnection({'active':True,'url':f'http://127.0.0.1:{server.server_port}/mcp','token':'fixture'})
            result=connection.forward({'jsonrpc':'2.0','id':7,'method':'tools/call','params':{}})
            self.assertEqual(result['error']['message'],'Operation is not exposed')
            connection.close();server.shutdown();thread.join()
        self.assertEqual(calls,[('POST','Bearer fixture',None),('DELETE','Bearer fixture','fixture-session')])


if __name__=='__main__':unittest.main()
