import {join,resolve} from "node:path";
import type {AppSettings} from "@pi-desktop/shared";
import type {UserMcpRuntime} from "../user-mcp";
import {inboxResult,JarvisInboxProducer} from "./inbox-producer";

export function createJarvisInboxProducer(input: {
  dataDir: string;
  sessionProjects: Map<string,string|null>;
  settings: ()=>Promise<AppSettings>;
  userMcp: Pick<UserMcpRuntime,"toolsForProject"|"callTool"|"cancelSessionCalls">;
  refreshUserMcp: (projectPath?: string|null)=>Promise<unknown>;
  failure: (metadata:{sessionId:string;operation:string})=>void;
  notifyFailure?: () => void;
  timeoutMs?: number;
}) {
  let lastNotice=0;
  const samePath=(a:string,b:string)=>process.platform==="win32" ? resolve(a).toLowerCase()===resolve(b).toLowerCase() : resolve(a)===resolve(b);
  const producer=new JarvisInboxProducer({
    enabled:async sessionId=>{
      if(!input.sessionProjects.has(sessionId)) return false;
      const project=input.sessionProjects.get(sessionId);
      if(project && samePath(project,join(input.dataDir,"jarvis","workspace"))) return false;
      const settings=await input.settings();
      return settings.jarvisEnabled===true && settings.jarvisQueueEnabled===true;
    },
    call:async(tool,args,scope)=>{
      let timer:ReturnType<typeof setTimeout>|undefined;let expired=false;
      const operation=(async()=>{
        await input.refreshUserMcp(null);
        if(expired) throw new Error("Capture expired");
        const tools=await input.userMcp.toolsForProject(null,"Jarvis-Inbox");
        if(expired) throw new Error("Capture expired");
        const selected=tools.find(t=>t.serverId==="Jarvis-Inbox" && t.toolName===tool);
        if(!selected) throw new Error("Registered Inbox tool unavailable");
        return inboxResult(await input.userMcp.callTool(selected.fullName,args,null,scope));
      })();
      try {
        return await Promise.race([operation,new Promise<never>((_,reject)=>{
          timer=setTimeout(()=>{expired=true;input.userMcp.cancelSessionCalls(scope);reject(new Error("Queue capture deadline exceeded"));},input.timeoutMs??4000);
        })]);
      }finally{if(timer)clearTimeout(timer);}
    },
    failure:metadata=>{
      input.failure(metadata);
      if(Date.now()-lastNotice>=60000){lastNotice=Date.now();input.notifyFailure?.();}
    },
  });
  return producer;
}
