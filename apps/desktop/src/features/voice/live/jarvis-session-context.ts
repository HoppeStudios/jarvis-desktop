/** Strict Host-only native context serialization; a send receipt is not playback. */
export function sendJarvisSessionContext(input:{
 callId:string; currentCallId?:string; adapterId?:string; actionId:string; content:string;
 channel?:{readyState:string;send(value:string):void}; completed:Set<string>;
}):boolean {
 if(input.callId!==input.currentCallId || input.adapterId!=='codex-live' || !input.actionId ||
   !input.content || new TextEncoder().encode(input.content).byteLength>48*1024 || input.channel?.readyState!=='open')return false;
 if(input.completed.has(input.actionId))return true;
 try {
  input.channel.send(JSON.stringify({type:'session.context.append',channel:'speakable',content:[{type:'input_text',text:input.content}]}));
  input.completed.add(input.actionId);
  while(input.completed.size>256)input.completed.delete(input.completed.values().next().value!);
  return true;
 }catch{return false;}
}
