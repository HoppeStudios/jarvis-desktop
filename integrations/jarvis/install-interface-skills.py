"""Install only reviewed interface skills and their narrow global Pi instruction block."""
import argparse
import json
import os
from pathlib import Path
import re
import uuid

def install(home,validate_only=False):
    source=Path(__file__).parent
    changes=[]
    for name in ('jarvis-computer-control','jarvis-pi-switch-chat'):
        files=['SKILL.md']+(['scripts/chat.py'] if name=='jarvis-computer-control' else [])
        for relative in files:
            content=(source/'skills'/name/relative).read_text(encoding='utf-8')
            for directory in (home/'.agents/skills',home/'.pi/agent/skills'):
                changes.append((directory/name/relative,content))
    settings_path=home/'.pi/agent/settings.json'
    settings_text=settings_path.read_text(encoding='utf-8-sig')
    settings=json.loads(settings_text)
    skills=settings.setdefault('skills',[])
    if not isinstance(skills,list) or any(not isinstance(value,str) for value in skills):raise ValueError('Unexpected Pi skill registration shape')
    path=str(home/'.pi/agent/skills/jarvis-computer-control')
    if path not in skills:
        skills.append(path)
        changes.append((settings_path,json.dumps(settings,ensure_ascii=False,indent=2)+'\n'))
    begin='<!-- jarvis-computer-interface:begin -->';end='<!-- jarvis-computer-interface:end -->'
    block=re.search(re.escape(begin)+'.*?'+re.escape(end),(source/'AGENTS.pi.md').read_text(encoding='utf-8'),re.S)
    if not block:raise ValueError('Managed interface policy is missing')
    agents_path=home/'.pi/agent/AGENTS.md'
    agents=agents_path.read_text(encoding='utf-8-sig')
    if begin in agents or end in agents:
        if agents.count(begin)!=1 or agents.count(end)!=1:raise ValueError('Ambiguous managed policy')
        agents=re.sub(re.escape(begin)+'.*?'+re.escape(end),lambda _:block.group(),agents,flags=re.S)
    else:agents=agents.rstrip()+'\n\n'+block.group()+'\n'
    changes.append((agents_path,agents))
    plan=[(path,content,path.read_bytes() if path.exists() else None) for path,content in changes]
    plan=[entry for entry in plan if entry[2]!=entry[1].encode('utf-8')]
    if not validate_only:
        for path,content,before in plan:
            if (path.read_bytes() if path.exists() else None)!=before:raise RuntimeError('Concurrent configuration change; install deferred')
            path.parent.mkdir(parents=True,exist_ok=True)
            temporary=path.with_name(path.name+'.'+uuid.uuid4().hex+'.tmp')
            try:
                temporary.write_text(content,encoding='utf-8',newline='')
                if (path.read_bytes() if path.exists() else None)!=before:raise RuntimeError('Concurrent configuration change; install deferred')
                os.replace(temporary,path)
            finally:
                temporary.unlink(missing_ok=True)
    return {'changedFiles':len(plan),'validatedOnly':validate_only,'nativeSkillImportRequired':True,'skills':['jarvis-computer-control','jarvis-pi-switch-chat']}

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--validate-only',action='store_true')
    args=parser.parse_args();print(json.dumps(install(Path.home(),args.validate_only)))
