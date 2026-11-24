import assert from "node:assert/strict";
import {readFileSync,readdirSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {join} from "node:path";

const root=fileURLToPath(new URL("..",import.meta.url));
const output=join(root,"apps/desktop/out/renderer");
const assets=join(output,"assets");const files=readdirSync(assets);
const javascript=files.filter(name=>name.endsWith(".js")).map(name=>readFileSync(join(assets,name),"utf8")).join("\n");
for(const prefix of ["pcm-worklet-","playback-worklet-"]){
 const candidates=files.filter(name=>name.startsWith(prefix)&&name.endsWith(".js"));
 assert.equal(candidates.length,1,`${prefix} must be an external packaged script`);
 assert.ok(javascript.includes(candidates[0]),"built renderer must reference the emitted asset");
 assert.match(readFileSync(join(assets,candidates[0]),"utf8"),/registerProcessor/);
}
for(const match of javascript.matchAll(/data:(?:text|application)\/javascript;base64,([A-Za-z0-9+/=]+)/g)){
 assert.ok(!Buffer.from(match[1],"base64").toString().includes("pi-live-playback-monitor"),"CSP forbids an inlined playback processor");
}
const html=readFileSync(join(output,"index.html"),"utf8");
assert.ok(!html.match(/script-src\s+([^;]*)/)[1].includes("data:"),"fix asset emission without weakening script policy");
console.log("PASS built microphone/playback worklets are external assets under the unchanged CSP");
