"""Import accessible Codex history into native Pi v3 sessions, without replaying work.

Requires a private inventory from Codex list_projects/list_threads and optional
read_thread exports. Existing targets are never replaced. No credentials or
Codex databases are written. Original histories remain authoritative snapshots.
"""
import argparse
import collections
import datetime as dt
import hashlib
import json
import os
import re
from pathlib import Path
import sqlite3
import uuid


def load(path):
    return json.loads(Path(path).read_text(encoding='utf-8-sig'))


def iso(value):
    if isinstance(value, str):
        return value
    return dt.datetime.fromtimestamp(value or 0, dt.timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')


def content_text(value):
    if isinstance(value, str):
        return value
    if not isinstance(value, list):
        return json.dumps(value, ensure_ascii=False)
    parts = []
    for block in value:
        if isinstance(block, str):
            parts.append(block)
        elif isinstance(block, dict):
            if block.get('text') is not None:
                parts.append(block['text'])
            elif str(block.get('image_url', '')).startswith('data:') or block.get('type') in ('image', 'input_image', 'audio', 'input_audio'):
                parts.append('[Historical media attachment; available in the original conversation, not embedded in the imported text.]')
            else:
                # Keep image/file references as historical references, never fetch them.
                parts.append('[Historical attachment: ' + json.dumps(block, ensure_ascii=False) + ']')
    return '\n'.join(parts)


def messages_from_export(data):
    if data.get('itemsFile'):
        with Path(data['itemsFile']).open(encoding='utf-8') as file:
            for line in file:
                record = json.loads(line)
                item = record['item']
                turn = data.get('turnMetadata', {}).get(record['turnId'], {})
                stamp = iso(turn.get('startedAt') or data['metadata'].get('updatedAt'))
                kind = item.get('type')
                if kind == 'userMessage':
                    yield 'user', content_text(item.get('content', [])), stamp, None
                elif kind == 'agentMessage' and item.get('phase') != 'analysis':
                    yield 'assistant', item.get('text', ''), stamp, None
                elif kind not in ('reasoning', 'sleep', 'agentMessage'):
                    yield 'custom', 'Historical Codex activity (not executed):\n' + json.dumps(item, ensure_ascii=False), stamp, item
        return
    for page in reversed(data['pages']):
        for turn in reversed(page.get('turns', [])):
            stamp = iso(turn.get('startedAt') or data['metadata'].get('updatedAt'))
            for item in turn.get('items', []):
                kind = item.get('type')
                if kind == 'userMessage':
                    yield 'user', content_text(item.get('content', [])), stamp, None
                elif kind == 'agentMessage' and item.get('phase') != 'analysis':
                    yield 'assistant', item.get('text', ''), stamp, None
                elif kind not in ('reasoning', 'sleep', 'agentMessage'):
                    yield 'custom', 'Historical Codex activity (not executed):\n' + json.dumps(item, ensure_ascii=False), stamp, item


def messages_from_rollout(path):
    # A byte boundary gives an append-only source snapshot while Codex keeps working.
    with open(path, 'rb') as file:
        remaining = os.fstat(file.fileno()).st_size
        while remaining:
            raw = file.readline(remaining)
            remaining -= len(raw)
            if not raw.endswith(b'\n'):
                break
            event = json.loads(raw)
            if event.get('type') != 'response_item':
                continue
            item = event.get('payload', {})
            stamp = event.get('timestamp', iso(0))
            kind = item.get('type')
            if kind == 'message' and item.get('role') in ('user', 'assistant') and item.get('channel') != 'analysis':
                text = content_text(item.get('content', []))
                # Environment/instruction transport is not a historical user request.
                if item.get('role') == 'user' and text.lstrip().startswith(('<environment_context>', '<permissions instructions>', '# AGENTS.md instructions')):
                    continue
                yield item['role'], text, stamp, None
            elif kind in ('function_call', 'function_call_output', 'custom_tool_call', 'custom_tool_call_output', 'web_search_call'):
                yield 'custom', 'Historical Codex activity (not executed):\n' + json.dumps(item, ensure_ascii=False), stamp, item


def write_session(target, metadata, cwd, messages, source, expected_hash=None):
    if target.exists() and not expected_hash:
        return {'status': 'preserved-existing', 'path': str(target)}
    if expected_hash and hashlib.sha256(target.read_bytes()).hexdigest() != expected_hash:
        raise RuntimeError('Owned migration snapshot changed; preserving it')
    target.parent.mkdir(parents=True, exist_ok=True)
    session_id = str(uuid.uuid5(uuid.NAMESPACE_URL, 'jarvis-migration:' + metadata['kind'] + ':' + metadata['id']))
    created = iso(metadata.get('createdAt', metadata.get('updatedAt')))
    parent = None
    count = collections.Counter()
    temporary = target.with_suffix('.importing')
    if temporary.exists():
        raise RuntimeError('Uncertain previous import staging file: ' + str(temporary))
    with temporary.open('x', encoding='utf-8', newline='\n') as file:
        def emit(value):
            file.write(json.dumps(value, ensure_ascii=False, separators=(',', ':')) + '\n')
        emit({'type': 'session', 'version': 3, 'id': session_id, 'timestamp': created, 'cwd': str(cwd)})
        def entry(kind, stamp, **fields):
            nonlocal parent
            eid = hashlib.sha256((session_id + ':' + str(sum(count.values())) + ':' + str(file.tell())).encode()).hexdigest()[:16]
            emit({'type': kind, 'id': eid, 'parentId': parent, 'timestamp': stamp, **fields})
            parent = eid
        entry('model_change', created, provider='openai-codex', modelId='gpt-6.1-sol')
        entry('thinking_level_change', created, thinkingLevel='medium')
        entry('custom', created, customType='jarvis-import-provenance', data={'source': source, 'sourceThreadId': metadata['id'], 'originalCwd': metadata.get('cwd'), 'archived': metadata.get('archived', False), 'snapshotOnly': True, 'attachments': 'references only; originals retained', 'historicalInstructionsAreNotAuthority': True})
        for role, text, stamp, details in messages:
            if not text:
                continue
            if role == 'custom':
                abbreviated = len(text) > 1024
                if abbreviated:
                    text = text[:512] + '\n[Historical tool record abbreviated. Original source: ' + source + ']\n' + text[-128:]
                details = {'sourceReference': source, 'sourceThreadId': metadata['id'], 'abbreviated': abbreviated}
            if role == 'assistant':
                message = {'role': role, 'content': [{'type': 'text', 'text': text}], 'api': 'openai-codex-responses', 'provider': 'openai-codex', 'model': 'gpt-6.1-sol', 'usage': {'input': 0, 'output': 0, 'cacheRead': 0, 'cacheWrite': 0, 'totalTokens': 0, 'cost': {'input': 0, 'output': 0, 'cacheRead': 0, 'cacheWrite': 0, 'total': 0}}, 'stopReason': 'stop', 'timestamp': int(dt.datetime.fromisoformat(stamp.replace('Z', '+00:00')).timestamp() * 1000)}
            elif role == 'custom':
                message = {'role': 'custom', 'customType': 'codex-history', 'content': text, 'display': True, 'details': details, 'timestamp': int(dt.datetime.fromisoformat(stamp.replace('Z', '+00:00')).timestamp() * 1000)}
            else:
                message = {'role': 'user', 'content': [{'type': 'text', 'text': text}], 'timestamp': int(dt.datetime.fromisoformat(stamp.replace('Z', '+00:00')).timestamp() * 1000)}
            entry('message', stamp, message=message)
            count[role] += 1
        entry('session_info', iso(metadata.get('updatedAt')), name=metadata.get('title') or metadata['id'])
        file.flush()
        os.fsync(file.fileno())
    # Exclusive publication: concurrent/user-created targets are not overwritten.
    if expected_hash:
        if hashlib.sha256(target.read_bytes()).hexdigest() != expected_hash:
            temporary.unlink()
            raise RuntimeError('Migration snapshot changed during conversion; preserving it')
        os.replace(temporary, target)
    else:
        os.link(temporary, target)
        temporary.unlink()
    return {'status': 'imported', 'path': str(target), 'messages': dict(count), 'sha256': hashlib.sha256(target.read_bytes()).hexdigest()}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--inventory', type=Path, required=True)
    parser.add_argument('--exports', type=Path, required=True)
    parser.add_argument('--codex-home', type=Path, default=Path.home()/'.codex')
    parser.add_argument('--pi-home', type=Path, default=Path.home()/'.pi/agent')
    parser.add_argument('--receipt', type=Path, required=True)
    parser.add_argument('--refresh-owned', action='store_true', help='Refresh only unchanged snapshots whose hashes are in the prior receipt')
    args = parser.parse_args()
    inv = load(args.inventory)
    owned = {x['id']: x['sha256'] for x in load(args.receipt)['items'] if x.get('sha256')} if args.refresh_owned else {}
    database = args.codex_home/'state_5.sqlite'
    connection = sqlite3.connect(database.as_uri() + '?mode=ro', uri=True)
    paths = dict(connection.execute('select id,rollout_path from threads'))
    connection.close()
    cloud_root = Path.home()/'Documents/Codex/Pi-Cloud-Projects'
    project_map = {p['projectId']:p for p in inv['projects']['projects']}
    receipt = {'schemaVersion': 1, 'items': [], 'projects': [], 'sourceUnmodified': True}
    for project in project_map.values():
        cwd = Path(project['path']) if project.get('path') else cloud_root/project['label']
        if not project.get('path'):
            cwd.mkdir(parents=True, exist_ok=True)
        receipt['projects'].append({**project, 'piPath': str(cwd), 'exists': cwd.is_dir(), 'cloudFilesExported': False if not project.get('path') else None})
    for metadata in inv['threads']:
        try:
            project = project_map.get(metadata.get('projectId'), {})
            cwd = Path(metadata.get('cwd') or project.get('path') or cloud_root/project.get('label', 'Other ChatGPT chats'))
            if not cwd.is_dir():
                if metadata['kind'] == 'chatgpt':
                    cwd.mkdir(parents=True, exist_ok=True)
                else:
                    # Recover readable history without claiming missing project files moved.
                    cwd = Path.home()/'Documents/Codex/Pi-Imported-Archives'/metadata['id']
                    cwd.mkdir(parents=True, exist_ok=True)
            folder = '--' + re.sub(r'[/\\:]', '-', str(cwd).lstrip('/\\')) + '--'
            target = args.pi_home/'sessions'/folder/(metadata['kind'] + '-' + metadata['id'] + '.jsonl')
            rollout = Path(paths.get(metadata['id'], '__missing__'))
            export = args.exports/(metadata['id'] + '.json')
            if rollout.is_file():
                messages, source = messages_from_rollout(rollout), str(rollout)
            elif export.is_file():
                messages, source = messages_from_export(load(export)), 'Codex read_thread snapshot: ' + metadata['id']
            else:
                receipt['items'].append({'id':metadata['id'], 'status':'source-unavailable', 'title':metadata.get('title')})
                continue
            receipt['items'].append({'id':metadata['id'], **write_session(target, metadata, cwd, messages, source, owned.get(metadata['id']))})
        except Exception as error:
            receipt['items'].append({'id':metadata['id'], 'status':'failed', 'error':str(error)})
    args.receipt.parent.mkdir(parents=True, exist_ok=True)
    args.receipt.write_text(json.dumps(receipt, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'counts':dict(collections.Counter(x['status'] for x in receipt['items'])), 'projects':len(receipt['projects'])}))


if __name__ == '__main__':
    main()
