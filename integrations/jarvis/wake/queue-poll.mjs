// Application-owned adapter; does not modify the separately maintained Inbox.
import {createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';

export function pendingFingerprint(items,now=Date.now()) {
  const due=items.filter(item=>item.state==='pending' && (item.deferredUntil??0)<=now && item.created<=now-2500 && item.questions?.some(q=>!q.answered));
  const identities=due.map(item=>[item.id,item.revision]).sort((a,b)=>a[0].localeCompare(b[0]));
  return {pendingCount:due.length,pendingFingerprint:identities.length?createHash('sha256').update(JSON.stringify(identities)).digest('hex'):null};
}

if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  const root=resolve(process.argv[2]);
  const {Inbox}=await import(pathToFileURL(join(root,'Inbox/store.mjs')).href);
  const {scan}=await import(pathToFileURL(join(root,'Inbox/monitor.mjs')).href);
  const inbox=new Inbox();
  try {
    const monitor=scan(inbox);const all=[];let offset=0;
    for(let pageNumber=0;;pageNumber++) {
      if(pageNumber>=200)throw new Error('Queue pagination exceeds bounded poll');
      const page=inbox.list({offset,limit:100});all.push(...page.items);
      if(page.nextOffset==null)break;
      if(!Number.isSafeInteger(page.nextOffset)||page.nextOffset<=offset)throw new Error('Invalid queue pagination');
      offset=page.nextOffset;
    }
    const metadata=pendingFingerprint(all);
    // Respect the existing Inbox retry/defer notification policy as well.
    const eligible=inbox.pending({notification:true}).length;
    console.log(JSON.stringify({...metadata,...(!eligible?{pendingCount:0}:{}),monitor,lastInvitation:inbox.state('lastInvitation')}));
  } finally {inbox.close();}
}
