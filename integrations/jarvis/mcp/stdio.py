"""Local stdio adapter for PI-Desktop's opt-in authenticated MCP endpoint.

Only standard-library Python is required. Credentials stay in the existing local
metadata file and HTTP header; they never enter MCP arguments or diagnostic text.
The desktop must already be running. This adapter does not start or log into it.
"""
import argparse
import json
import pathlib
import sys
import urllib.error
import urllib.parse
import urllib.request

LIMIT = 2 * 1024 * 1024


def endpoint(metadata):
    value = urllib.parse.urlsplit(metadata.get('url', ''))
    if (metadata.get('active') is not True or value.scheme != 'http'
            or value.hostname != '127.0.0.1' or not value.port
            or value.path != '/mcp' or value.query or value.fragment
            or value.username or value.password
            or not isinstance(metadata.get('token'), str) or not metadata['token']):
        raise ValueError('PI-Desktop endpoint is not a valid active loopback endpoint')
    return value.geturl()


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


class DesktopConnection:
    def __init__(self, metadata):
        self.url = endpoint(metadata)
        self.headers = {'Authorization': 'Bearer ' + metadata['token'],
                        'Content-Type': 'application/json',
                        'Accept': 'application/json, text/event-stream'}
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())

    def forward(self, message):
        payload = json.dumps(message).encode('utf-8')
        if len(payload) > LIMIT:
            raise ValueError('MCP request exceeds the bounded desktop limit')
        request = urllib.request.Request(self.url, payload, self.headers)
        try:
            response = self.opener.open(request, timeout=180)
        except urllib.error.HTTPError as error:
            # Preserve actual protocol errors/refusals; never retry elsewhere.
            response = error
        with response:
            session_id = response.headers.get('Mcp-Session-Id')
            if session_id:
                self.headers['Mcp-Session-Id'] = session_id
            body = response.read(LIMIT + 1)
            if len(body) > LIMIT:
                raise ValueError('MCP response exceeds the bounded desktop limit')
            if not body:
                if 'id' not in message:
                    return None
                raise RuntimeError('PI-Desktop returned no protocol response')
            result = json.loads(body)
            if not isinstance(result, dict) or result.get('jsonrpc') != '2.0':
                raise ValueError('PI-Desktop returned an invalid protocol response')
            return result

    def close(self):
        if 'Mcp-Session-Id' not in self.headers:
            return
        try:
            self.opener.open(urllib.request.Request(self.url, headers=self.headers, method='DELETE'), timeout=5).close()
        except (OSError, ValueError):
            pass


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--metadata', type=pathlib.Path, default=pathlib.Path.home()/'.pi-desktop/mcp-control.json')
    args = parser.parse_args()
    connection = None
    try:
        for line in sys.stdin.buffer:
            message = None
            try:
                if len(line) > LIMIT:
                    raise ValueError('Oversized stdio request')
                message = json.loads(line)
                if not isinstance(message, dict) or message.get('jsonrpc') != '2.0':
                    raise ValueError('Invalid JSON-RPC request')
                if connection is None:
                    metadata = json.loads(args.metadata.read_text(encoding='utf-8'))
                    connection = DesktopConnection(metadata)
                result = connection.forward(message)
            except (OSError, ValueError, RuntimeError):
                # Never echo metadata, HTTP headers, tool payloads or exceptions.
                if isinstance(message, dict) and 'id' not in message:
                    continue
                result = {'jsonrpc':'2.0','id':message.get('id') if isinstance(message,dict) else None,
                          'error':{'code':-32000,'message':'PI-Desktop MCP is unavailable or rejected this request. Check its local running state and endpoint.'}}
            if result is not None:
                print(json.dumps(result,ensure_ascii=True),flush=True)
    except KeyboardInterrupt:
        pass
    finally:
        if connection:
            connection.close()


if __name__ == '__main__':
    main()
