/** Current-call work already delivered to this same target; never saved history. */
type Operation = {
  callId:string;workSessionId:string;operationId:string;providerRequestId:string;
  instruction:string;admission:string;execution:string;resultState?:string;resultSummary?:string;
};
export function spokenWorkContext(input:{callId:string;workSessionId:string;providerRequestId:string;operations:readonly Operation[]}): Array<Record<string,unknown>> {
  const eligible=input.operations.filter(item=>item.callId===input.callId && item.workSessionId===input.workSessionId &&
    item.providerRequestId!==input.providerRequestId && item.admission==='accepted' && item.execution!=='not-started').slice(-4);
  const entries:Array<Record<string,unknown>>=[];let remaining=3072;
  const size=(value:unknown)=>new TextEncoder().encode(JSON.stringify(value)).byteLength;
  for(const item of eligible.reverse()) {
    const result=item.resultState==='available' && typeof item.resultSummary==='string' ? item.resultSummary:undefined;
    let entry:Record<string,unknown>={operationId:item.operationId,execution:item.execution,request:item.instruction,...(result?{result}:{} )};
    if(size(entry)>remaining)entry={operationId:item.operationId,execution:item.execution,requestOmitted:true,...(result?{result}:{} )};
    if(size(entry)>remaining)entry={operationId:item.operationId,execution:item.execution,requestOmitted:true,...(result?{resultOmitted:true}:{} )};
    const bytes=size(entry)+1;if(bytes>remaining)break;
    remaining-=bytes;entries.unshift(entry);
  }
  return entries;
}
