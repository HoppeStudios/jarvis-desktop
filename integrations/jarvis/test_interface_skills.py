import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec=importlib.util.spec_from_file_location('interface_install',Path(__file__).with_name('install-interface-skills.py'))
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)

class InstallTests(unittest.TestCase):
    def test_preserves_unrelated_config_and_instruction_text_and_is_idempotent(self):
        with tempfile.TemporaryDirectory() as folder:
            home=Path(folder);agent=home/'.pi/agent';agent.mkdir(parents=True)
            settings={'skills':['custom-skill'],'permissionMode':'custom','voice':{'binding':'chosen'},'other':{'keep':True}}
            (agent/'settings.json').write_text(json.dumps(settings),encoding='utf-8');(agent/'AGENTS.md').write_text('User instructions remain.\n',encoding='utf-8')
            self.assertEqual(module.install(home,True)['changedFiles'],8)
            self.assertFalse((home/'.agents/skills/jarvis-computer-control/SKILL.md').exists())
            module.install(home)
            updated=json.loads((agent/'settings.json').read_text(encoding='utf-8'))
            for key in ('permissionMode','voice','other'):self.assertEqual(updated[key],settings[key])
            self.assertIn('custom-skill',updated['skills']);self.assertTrue((agent/'AGENTS.md').read_text().startswith('User instructions remain.'))
            self.assertEqual(module.install(home)['changedFiles'],0)
            self.assertEqual((agent/'AGENTS.md').read_text().count('<!-- jarvis-computer-interface:begin -->'),1)
    def test_malformed_registration_is_refused_before_writes(self):
        with tempfile.TemporaryDirectory() as folder:
            home=Path(folder);agent=home/'.pi/agent';agent.mkdir(parents=True)
            (agent/'settings.json').write_text('{"skills":"wrong"}');(agent/'AGENTS.md').write_text('User')
            with self.assertRaises(ValueError):module.install(home)
            self.assertFalse((home/'.agents').exists())

if __name__=='__main__':unittest.main()
