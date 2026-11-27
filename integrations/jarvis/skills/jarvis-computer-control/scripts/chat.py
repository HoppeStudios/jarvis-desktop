"""Use the installed authenticated Pi adapter when this chat has a stale MCP catalog."""
import argparse
import json
import os
from pathlib import Path
import sys

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    actions=parser.add_subparsers(dest='action',required=True)
    find=actions.add_parser('find');find.add_argument('query');find.add_argument('--owner',choices=['codex'])
    find.add_argument('--include-archived',action='store_true');find.add_argument('--project');find.add_argument('--limit',type=int,default=3)
    opening=actions.add_parser('open');opening.add_argument('session_id')
    args=parser.parse_args()
    root=Path(os.environ.get('LOCALAPPDATA',str(Path.home()/'AppData/Local')))/'JarvisWake'
    if not (root/'pi-runtime.json').is_file():raise RuntimeError('PI_CONTROL_UNAVAILABLE')
    runtime=json.loads((root/'pi-runtime.json').read_text(encoding='utf-8-sig'))
    if runtime.get('backend')!='pi-desktop':raise RuntimeError('PI_RUNTIME_NOT_SELECTED')
    sys.path.insert(0,str(root/'Pi/wake'))
    from desktop_control import Client
    client=Client()
    try:
        if args.action=='find':
            query={'query':args.query,'includeArchived':args.include_archived,'limit':args.limit}
            if args.owner:query['owner']=args.owner
            if args.project:query['project']=args.project
            result=client.invoke('session/find',[query])
        else:
            result=client.invoke('session/open',[args.session_id]);session=result.get('session') or {}
            owner=session.get('nativeOwner') or {}
            canonical_receipt=(result.get('requestedSessionId')==args.session_id and owner.get('hostKey')=='codex-shared' and owner.get('viewId')==session.get('id'))
            if not session.get('id') or session.get('id')!=args.session_id and not canonical_receipt:raise RuntimeError('PI_OPEN_UNCONFIRMED')
            result={'requestedSessionId':args.session_id,'sessionId':session['id'],'title':session.get('title'),'nativeOpenAccepted':True,'selectionVerified':False,'navigationOnly':True}
        print(json.dumps(result,ensure_ascii=False))
    finally:client.close()

if __name__=='__main__':
    try:main()
    except (OSError,ValueError,RuntimeError,ImportError):
        print(json.dumps({'ok':False,'error':'Native Pi operation unavailable or refused; no fallback action was attempted.'}))
        sys.exit(1)
