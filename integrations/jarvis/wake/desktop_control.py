"""Bounded background worker for the Pi Jarvis listener. No desktop input or TTS."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import time


def transport():
    spec = importlib.util.spec_from_file_location('jarvis_transport', Path(__file__).parents[1]/'mcp/stdio.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class Client:
    def __init__(self):
        self.connection = transport().DesktopConnection(json.loads((Path.home()/'.pi-desktop/mcp-control.json').read_text()))
        self.sequence = 0
        self.rpc('initialize', {'protocolVersion':'2025-03-26', 'capabilities':{},
                               'clientInfo':{'name':'jarvis-pi-wake', 'version':'1.0.0'}})

    def rpc(self, method, params):
        self.sequence += 1
        result = self.connection.forward({'jsonrpc':'2.0', 'id':self.sequence, 'method':method, 'params':params})
        if 'error' in result:
            raise RuntimeError('Pi Desktop rejected the control request.')
        return result['result']

    def invoke(self, operation, args=None, confirm=False):
        result = self.rpc('tools/call', {'name':'pi_desktop_invoke', 'arguments':{
            'operation':operation, 'args':args or [], 'confirm':confirm}})
        if result.get('isError'):
            # Do not echo endpoint headers, conversations or arbitrary tool errors.
            raise RuntimeError('Pi Desktop could not complete '+operation+'. Check native settings/status.')
        payload = result.get('structuredContent') or json.loads(result['content'][0]['text'])
        return payload['result']

    def close(self):
        self.connection.close()


def queue_poll(root):
    config = json.loads((root/'inbox-runtime.json').read_text(encoding='utf-8-sig'))
    node = Path(config['node'])
    cli = root/'Inbox/cli.mjs'
    if not node.is_file() or not cli.is_file():
        raise RuntimeError('The existing shared Jarvis queue runtime is unavailable.')
    creationflags = getattr(subprocess, 'CREATE_NO_WINDOW', 0)
    done = subprocess.run([str(node), '--disable-warning=ExperimentalWarning', str(cli), 'tick'],
                          capture_output=True, timeout=8, creationflags=creationflags, check=True)
    if len(done.stdout) > 2*1024*1024:
        raise RuntimeError('Shared queue response exceeds the local limit.')
    packet = json.loads(done.stdout)
    return {'pendingCount':len(packet.get('pending', [])), 'lastInvitation':packet.get('lastInvitation'),
            'monitor':packet.get('monitor')}


def execute(client, request, root):
    operation = request.get('operation')
    if operation == 'captured-task':
        from captured_task import execute as captured_execute
        return captured_execute(client, request, root, execute)
    if operation == 'poll':
        status = client.invoke('voice/status')
        try:
            status.update(queue_poll(root))
        except (OSError, ValueError, RuntimeError, subprocess.SubprocessError):
            status.update(pendingCount=0, queueError='Shared queue monitoring is unavailable.')
        try:
            from captured_task import poll as capture_poll
            status['captureReports'] = capture_poll(client,root)
        except (OSError,ValueError,RuntimeError):
            status['captureError'] = 'Captured text task status is unavailable.'
        return status
    if operation == 'settings':
        return client.invoke('settings/openJarvis')
    if operation == 'status':
        return client.invoke('voice/status')
    if operation != 'voice':
        raise ValueError('Unknown listener operation.')
    action = request.get('action')
    if action not in ('wake', 'end', 'new-chat'):
        raise ValueError('Unknown voice action.')
    payload = {key:request[key] for key in ('requestId', 'action', 'intentId', 'intentSequence')}
    if action != 'end':
        payload.update(freshCoordinator=True, initialMuted=request.get('initialMuted', False),
                       presenceGreeting=request.get('presenceGreeting', False))
    if action != 'end' and request.get('presenceGreeting') and 'presenceTimeoutSeconds' in request:
        payload['presenceTimeoutSeconds'] = request['presenceTimeoutSeconds']
    if request.get('cleanupUnanswered') is True and action == 'end':
        payload['cleanupUnanswered'] = True
    if request.get('expectedCallId'):
        payload['expectedCallId'] = request['expectedCallId']
    return client.invoke('voice/control', [payload], True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', required=True, type=Path)
    parser.add_argument('--request', required=True, type=Path)
    parser.add_argument('--result', required=True, type=Path)
    args = parser.parse_args()
    client = None
    began = time.monotonic()
    try:
        if args.request.stat().st_size > 16384:
            raise ValueError('Oversized listener request.')
        request = json.loads(args.request.read_text(encoding='utf-8-sig'))
        client = Client()
        result = {'ok':True, 'result':execute(client, request, args.root)}
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError):
        result = {'ok':False, 'error':'Pi Desktop or the shared queue is unavailable, or the native action was refused. Check Pi Desktop and Jarvis status.'}
    finally:
        if client:
            client.close()
    result['milliseconds'] = round((time.monotonic()-began)*1000)
    temporary = args.result.with_suffix('.tmp')
    temporary.write_text(json.dumps(result), encoding='utf-8')
    os.replace(temporary, args.result)


if __name__ == '__main__':
    main()
