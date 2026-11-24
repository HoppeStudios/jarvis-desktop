import assert from "node:assert/strict";
import test from "node:test";
import {register} from "node:module";
import {dirname, join} from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";
register(pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), "helpers/ts-import-hooks.mjs")));
const {registerLiveVoiceIpc} = await import("../electron/main/ipc/live-voice-ipc.ts");
const {IPC} = await import("@pi-desktop/shared");

test("tray settings reveal only the trusted owner without the focus-taking widget action", async t => {
 const previous=process.env.ELECTRON_RENDERER_URL;
 process.env.ELECTRON_RENDERER_URL="http://127.0.0.1:54321/index.html";
 t.after(()=>{if(previous===undefined)delete process.env.ELECTRON_RENDERER_URL;else process.env.ELECTRON_RENDERER_URL=previous;});
 const handlers=new Map(),events=[];let shown=0;
 const frame={processId:1,routingId:2,url:process.env.ELECTRON_RENDERER_URL,send:(...args)=>events.push(args)};
 const contents={id:1,isDestroyed:()=>false,mainFrame:frame,getURL:()=>frame.url};
 const window={webContents:contents,isDestroyed:()=>false,showInactive:()=>shown++,isVisible:()=>shown>0};
 registerLiveVoiceIpc({registrar:{handle:(id,handler)=>handlers.set(id,handler),handleWithEvent:()=>{},assertMainWindowSender:()=>{}},
  service:{},getMainWindow:()=>window,widget:{requestAction:()=>{throw new Error("foreground-taking path forbidden");}}});
 assert.deepEqual(await handlers.get(IPC.invoke.jarvisSettingsOpen)(),{dispatched:true,visible:true});
 assert.equal(shown,1);assert.deepEqual(events,[[IPC.event.liveVoiceWidgetAction,{action:"settings"}]]);
 frame.url="https://untrusted.example/";
 await assert.rejects(handlers.get(IPC.invoke.jarvisSettingsOpen),{errorCode:"LIVE_INVALID_OWNER"});
 assert.equal(shown,1);
});
