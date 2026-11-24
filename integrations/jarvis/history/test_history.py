import importlib.util
import json
import pathlib
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('history', pathlib.Path(__file__).with_name('import-history.py'))
history = importlib.util.module_from_spec(spec)
spec.loader.exec_module(history)


class HistoryTests(unittest.TestCase):
    def test_paginated_history_keeps_order_and_excludes_analysis(self):
        with tempfile.TemporaryDirectory() as root:
            items = pathlib.Path(root)/'items.jsonl'
            values = [
                {'type':'userMessage','content':[{'type':'text','text':'Question'}]},
                {'type':'reasoning','text':'private reasoning'},
                {'type':'agentMessage','phase':'analysis','text':'private analysis'},
                {'type':'agentMessage','phase':'final_answer','text':'Answer'},
                {'type':'commandExecution','command':'historical command'},
            ]
            items.write_text('\n'.join(json.dumps({'turnId':'t','item':v}) for v in values), encoding='utf-8')
            data={'metadata':{'updatedAt':1},'itemsFile':str(items),'turnMetadata':{'t':{'startedAt':1}}}
            result=list(history.messages_from_export(data))
            self.assertEqual([r[0] for r in result], ['user','assistant','custom'])
            self.assertNotIn('private', json.dumps(result))
            self.assertIn('not executed', result[-1][1])

    def test_native_pages_exclude_analysis_instead_of_reclassifying_it(self):
        data={'metadata':{'updatedAt':1},'pages':[{'turns':[{'startedAt':1,'items':[{'type':'agentMessage','phase':'analysis','text':'private'}]}]}]}
        self.assertEqual(list(history.messages_from_export(data)), [])

    def test_owned_snapshot_is_idempotent_and_preserves_concurrent_changes(self):
        with tempfile.TemporaryDirectory() as root:
            target=pathlib.Path(root)/'owned.jsonl'
            meta={'kind':'codex','id':'fixture','createdAt':1,'updatedAt':2,'title':'Original title'}
            messages=[('user','Question',history.iso(1),None),('custom','x'*2000,history.iso(2),None)]
            receipt=history.write_session(target,meta,pathlib.Path(root),messages,'private source')
            entries=[json.loads(line) for line in target.read_text(encoding='utf-8').splitlines()]
            self.assertEqual(entries[-1]['name'],'Original title')
            self.assertIn('abbreviated',entries[-2]['message']['content'])
            self.assertEqual(history.write_session(target,meta,pathlib.Path(root),[],'source')['status'],'preserved-existing')
            target.write_text('concurrent edit',encoding='utf-8')
            with self.assertRaisesRegex(RuntimeError,'changed'):
                history.write_session(target,meta,pathlib.Path(root),messages,'source',receipt['sha256'])
            self.assertEqual(target.read_text(),'concurrent edit')

    def test_attachments_remain_references_without_fetching(self):
        self.assertNotIn('base64', history.content_text([{'type':'input_image','image_url':'data:image/png;base64,SECRET'}]))
        self.assertIn('original conversation', history.content_text([{'type':'input_image','image_url':'data:image/png;base64,SECRET'}]))


if __name__=='__main__': unittest.main()
