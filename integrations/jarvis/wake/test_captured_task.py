import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import uuid

spec=importlib.util.spec_from_file_location('captured_task',Path(__file__).with_name('captured_task.py'))
capture=importlib.util.module_from_spec(spec);spec.loader.exec_module(capture)

class Client:
    def __init__(self):
        self.sent=[];self.accepted=True;self.source='codex';self.active=False;self.running=True;self.messages=[];self.after_create=None
    def invoke(self,operation,args=None,confirm=False):
        self.sent.append((operation,args))
        if operation=='voice/status':return {'resultBriefingSupported':True,'call':{'phase':'connected' if self.active else 'ended'}}
        if operation=='voice/control':return {'state':'connected','resultBriefingPlayed':True,'callId':'native-call'}
        if operation=='session/create':
            if self.after_create:self.after_create()
            return {'session':{'id':'pi-alias'}}
        if operation=='session/open':return {'ok':True}
        if operation=='session/get':return {'session':{'source':self.source,'remoteHostKey':'codex-shared','messages':self.messages}}
        if operation=='agent/getStatus':return {'status':{'isRunning':self.running}}
        if operation=='agent/prompt':return {'accepted':self.accepted,'turnId':'real-codex-turn'}
        raise AssertionError('Unexpected native operation: '+operation)

class CaptureTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.root=Path(self.temp.name);(self.root/'data').mkdir()
        self.state={'paused':False,'intentId':'intent','intentSequence':5};self.save()
        bridge=self.root/'bridge.json';bridge.write_text(json.dumps({'schemaVersion':1,'syncEnabled':True}))
        (self.root/'capture-runtime.json').write_text(json.dumps({'bridgeConfig':str(bridge),'taskDirectory':str(self.root)}))
        self.request={'requestId':str(uuid.uuid4()),'action':'wake','intentId':'intent','intentSequence':5,'capturedText':'otevři projekt a ukaž výsledky'}
    def save(self):(self.root/'data/pi-state.json').write_text(json.dumps(self.state))
    def test_exact_native_admission_and_at_most_once_without_voice_start(self):
        client=Client();result=capture.execute(client,self.request,self.root)
        self.assertEqual(result['taskTurnId'],'real-codex-turn')
        prompts=[args[0] for op,args in client.sent if op=='agent/prompt']
        self.assertEqual(prompts[0]['content'],self.request['capturedText']);self.assertEqual(prompts[0]['sessionId'],'pi-alias')
        self.assertFalse(any(op=='voice/control' for op,_ in client.sent))
        with self.assertRaises(FileExistsError):capture.execute(client,self.request,self.root)
        self.assertEqual(len([1 for op,_ in client.sent if op=='agent/prompt']),1)
    def test_paused_or_newer_intent_does_not_create(self):
        for change in ({'paused':True},{'paused':False,'intentSequence':6}):
            self.state.update(change);self.save();client=Client()
            self.assertEqual(capture.execute(client,self.request,self.root)['taskDelivery'],'cancelled');self.assertFalse(client.sent)
    def test_existing_call_is_preserved(self):
        client=Client();client.active=True
        self.assertEqual(capture.execute(client,self.request,self.root)['taskDelivery'],'cancelled')
        self.assertEqual([op for op,_ in client.sent],['voice/status'])
    def test_wrong_engine_is_not_silently_used(self):
        client=Client();client.source='desktop'
        with self.assertRaises(RuntimeError):capture.execute(client,self.request,self.root)
        self.assertFalse(any(op=='agent/prompt' for op,_ in client.sent))
    def test_uncertain_admission_is_not_retried(self):
        client=Client();client.accepted=False
        with self.assertRaises(RuntimeError):capture.execute(client,self.request,self.root)
        with self.assertRaises(FileExistsError):capture.execute(client,self.request,self.root)
        self.assertEqual(len([1 for op,_ in client.sent if op=='agent/prompt']),1)
    def test_end_during_creation_cancels_submission(self):
        client=Client()
        def interrupt():self.state.update(intentSequence=6);self.save()
        client.after_create=interrupt
        self.assertEqual(capture.execute(client,self.request,self.root)['taskDelivery'],'cancelled')
        self.assertFalse(any(op=='agent/prompt' for op,_ in client.sent))
    def test_only_verified_same_turn_completion_is_reported(self):
        client=Client();capture.execute(client,self.request,self.root)
        client.running=False;client.messages=[{'role':'assistant','turnId':'old','status':'complete','content':'wrong'}]
        self.assertEqual(capture.poll(client,self.root),[])
        client.messages.append({'role':'assistant','turnId':'real-codex-turn','status':'complete','content':'Hotovo, ověřeno.'})
        self.assertEqual(capture.poll(client,self.root)[0]['text'],'Hotovo, ověřeno.')
        receipt=self.root/'data/captured-tasks'/(self.request['requestId']+'.announced.json')
        receipt.write_text('{"state":"attempting"}')
        self.assertEqual(len(capture.poll(client,self.root)),1)
        receipt.write_text('{"state":"played"}')
        self.assertEqual(capture.poll(client,self.root),[])

    def finished(self):
        client=Client();capture.execute(client,self.request,self.root);client.running=False
        client.messages=[{'role':'assistant','turnId':'real-codex-turn','status':'complete','content':'Hotovo.'}]
        capture.poll(client,self.root)
        self.state['intentSequence']=6;self.save()
        request={'requestId':str(uuid.uuid4()),'action':'wake','intentId':'intent','intentSequence':6,'capturedResultRequestId':self.request['requestId']}
        return client,request

    def test_native_briefing_uses_receipt_source_without_caller_speech_and_is_at_most_once(self):
        client,request=self.finished();result=capture.brief(client,request,self.root)
        self.assertTrue(result['resultBriefingPlayed'])
        payload=[args[0] for op,args in client.sent if op=='voice/control'][0]
        self.assertEqual(payload['resultSource'],{'sessionId':'pi-alias','turnId':'real-codex-turn'})
        self.assertNotIn('text',payload);self.assertFalse(payload['initialMuted'])
        self.assertEqual(capture.brief(client,request,self.root)['state'],'superseded')
        self.assertEqual(len([1 for op,_ in client.sent if op=='voice/control']),1)

    def test_result_does_not_replace_existing_call_or_override_end_pause_or_new_intent(self):
        client,request=self.finished();client.active=True
        self.assertEqual(capture.brief(client,request,self.root)['state'],'already-on')
        self.assertFalse(any(op=='voice/control' for op,_ in client.sent))
        client.active=False
        for change in ({'paused':True},{'paused':False,'intentSequence':7}):
            self.state.update(change);self.save()
            self.assertEqual(capture.brief(client,request,self.root)['state'],'superseded')
        self.assertFalse(any(op=='voice/control' for op,_ in client.sent))

if __name__=='__main__':unittest.main()
