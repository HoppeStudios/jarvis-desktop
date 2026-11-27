import workletUrl from './interruption-worklet.js?url&no-inline';

/** Owned call-local stream; the original microphone and native mute remain authoritative. */
export class InterruptionGuard {
  private quietTimer?: ReturnType<typeof setTimeout>;
  private disposed = false;
  private speaking = false;
  private constructor(private source:MediaStreamAudioSourceNode, private node:AudioWorkletNode, private destination:MediaStreamAudioDestinationNode) {}
  static async create(context:AudioContext, stream:MediaStream, failed:()=>void):Promise<InterruptionGuard> {
    if (context.state !== 'running') {
      let timer:ReturnType<typeof setTimeout>|undefined;
      try { await Promise.race([context.resume(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('LIVE_MEDIA_UNSUPPORTED')),2000);})]); }
      finally { clearTimeout(timer); }
      if (String(context.state) !== 'running') throw new Error('LIVE_MEDIA_UNSUPPORTED');
    }
    await context.audioWorklet.addModule(workletUrl);
    let source:MediaStreamAudioSourceNode|undefined,node:AudioWorkletNode|undefined,destination:MediaStreamAudioDestinationNode|undefined;
    try {
      source = context.createMediaStreamSource(stream);
      node = new AudioWorkletNode(context,'pi-live-interruption-guard',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[1],channelCount:1,channelCountMode:'explicit'});
      destination = context.createMediaStreamDestination();
      node.onprocessorerror = failed;
      source.connect(node);node.connect(destination);
      const guard = new InterruptionGuard(source,node,destination);guard.setMuted(true);return guard;
    } catch(error) {
      for(const action of [()=>source?.disconnect(),()=>node?.disconnect(),()=>destination?.disconnect(),()=>destination?.stream.getTracks().forEach(track=>track.stop())])try{action();}catch{}
      throw error;
    }
  }
  get stream():MediaStream { return this.destination.stream; }
  setMuted(muted:boolean):void {
    for(const track of this.stream.getAudioTracks()) track.enabled = !muted;
    this.node.port.postMessage({kind:'muted',active:muted});
  }
  setSpeaking(active:boolean):void {
    if(this.disposed)return;
    if(active){clearTimeout(this.quietTimer);this.quietTimer=undefined;if(!this.speaking){this.speaking=true;this.node.port.postMessage({kind:'speaking',active:true});}}
    else if(this.speaking && !this.quietTimer)this.quietTimer=setTimeout(()=>{this.quietTimer=undefined;if(!this.disposed){this.speaking=false;this.node.port.postMessage({kind:'speaking',active:false});}},200);
  }
  dispose():void {
    if(this.disposed)return;this.disposed=true;clearTimeout(this.quietTimer);
    let failure:unknown;
    for(const action of [()=>this.setMuted(true),()=>this.node.port.postMessage({kind:'stop'}),()=>this.source.disconnect(),()=>this.node.disconnect(),()=>this.destination.disconnect(),()=>this.stream.getTracks().forEach(track=>track.stop())])try{action();}catch(error){failure??=error;}
    if(failure)throw failure;
  }
}
