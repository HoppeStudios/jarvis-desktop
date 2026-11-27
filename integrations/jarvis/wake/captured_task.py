"""Text admission through the installed native shared Codex adapter; no Live call."""
import json
import os
from pathlib import Path
import uuid
import time

def write_receipt(path,value):
    temporary=path.with_suffix('.tmp');temporary.write_text(json.dumps(value),encoding='utf-8');os.replace(temporary,path)

def execute(client,request,root,_unused=None):
    text=request.get('capturedText')
    if request.get('action')!='wake' or not isinstance(text,str) or not text.strip() or len(text)>2000:raise ValueError('Invalid captured command.')
    command_id=str(uuid.UUID(request['requestId']))
    def current():
        state=json.loads((root/'data/pi-state.json').read_text(encoding='utf-8-sig'))
        return not state.get('paused') and state.get('intentId')==request['intentId'] and state.get('intentSequence')==request['intentSequence']
    def idle():
        status=client.invoke('voice/status');call=status.get('call') or {}
        return not status.get('pendingRequestId') and call.get('phase','ended') in ('ended','failed')
    if not current() or not idle():return {'state':'superseded','taskDelivery':'cancelled'}
    runtime=json.loads((root/'capture-runtime.json').read_text(encoding='utf-8-sig'))
    bridge=json.loads(Path(runtime['bridgeConfig']).read_text(encoding='utf-8-sig'))
    if bridge.get('schemaVersion')!=1 or bridge.get('syncEnabled') is not True:raise RuntimeError('Shared Codex adapter is unavailable.')
    receipts=root/'data/captured-tasks';receipts.mkdir(exist_ok=True);receipt_path=receipts/(command_id+'.json')
    # Claim before mutation. An uncertain send is never automatically repeated.
    with receipt_path.open('x',encoding='utf-8') as file:json.dump({'state':'in-flight','requestId':command_id},file)
    created=client.invoke('session/create',[{'title':'Jarvis spoken command','mode':'agent','projectPath':runtime['taskDirectory'],'modelId':'gpt-6.1-sol','thinkingLevel':'medium'}])
    session=(created.get('session') or {}).get('id')
    if not session:raise RuntimeError('Native session creation is unconfirmed.')
    # Opening invokes the existing reviewed shared adapter before text is sent.
    client.invoke('session/open',[session])
    detail=client.invoke('session/get',[{'sessionId':session,'messageLimit':1}]).get('session') or {}
    if detail.get('source')!='codex' or detail.get('remoteHostKey')!='codex-shared':raise RuntimeError('Destination is not owned by shared Codex.')
    if not current() or not idle():return {'state':'superseded','taskDelivery':'cancelled','taskSessionId':session}
    admission=client.invoke('agent/prompt',[{'sessionId':session,'content':text,'messageId':command_id}])
    if not isinstance(admission,dict) or admission.get('accepted') is not True or not admission.get('turnId'):raise RuntimeError('Admission unconfirmed; do not retry automatically.')
    result={'state':'text-admitted','taskDelivery':'accepted','taskSessionId':session,'taskTurnId':admission['turnId'],'requestId':command_id,'source':'codex-shared'}
    write_receipt(receipt_path,result);return result

def poll(client,root):
    reports=[]
    for path in sorted((root/'data/captured-tasks').glob('*.json')):
        if path.name.endswith('.announced.json'):continue
        announcement=path.with_name(path.stem+'.announced.json')
        if announcement.exists():
            spoken=json.loads(announcement.read_text(encoding='utf-8'))
            if spoken.get('state')=='played' or spoken.get('deferredUntil',0)>time.time()*1000:continue
        value=json.loads(path.read_text(encoding='utf-8'))
        if value.get('state')=='text-admitted':
            session=value['taskSessionId'];state=client.invoke('agent/getStatus',[session]).get('status') or {}
            if state.get('isRunning') is not False:continue
            detail=client.invoke('session/get',[{'sessionId':session,'messageLimit':30}]).get('session') or {}
            if detail.get('source')!='codex':continue
            answers=[m for m in detail.get('messages',[]) if m.get('role')=='assistant' and m.get('turnId')==value['taskTurnId'] and m.get('status')=='complete' and isinstance(m.get('content'),str)]
            if not answers:continue
            value.update(state='text-finished',report=answers[-1]['content'][:16000]);write_receipt(path,value)
        if value.get('state')=='text-finished':reports.append({'requestId':value['requestId'],'taskSessionId':value['taskSessionId'],'text':value['report']})
    return reports
