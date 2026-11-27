// Copy the already installed, locked JS/FFI packages; never invoke npm/latest.
import {readFile, writeFile, realpath, mkdir, readdir, cp, stat} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const [configPath,target]=process.argv.slice(2);
const config=JSON.parse(await readFile(configPath,'utf8'));
const hash=async file=>createHash('sha256').update(await readFile(file)).digest('hex');
for(const key of ['module','library','model']) {
  if(await hash(config[key])!==config[key+'Sha256'])throw Error('ASR preflight hash mismatch');
}
const pkg=path.dirname(path.dirname(await realpath(config.module)));
if(JSON.parse(await readFile(path.join(pkg,'package.json'),'utf8')).version!=='0.2.2')throw Error('Unexpected transcription dependency');
const require=createRequire(config.module);
const koffi=path.dirname(await realpath(require.resolve('koffi')));
const nativeName='@koromix/koffi-'+process.platform+'-'+process.arch;
const koffiRequire=createRequire(path.join(koffi,'package.json'));
const native=path.dirname(await realpath(koffiRequire.resolve(nativeName)));
if(JSON.parse(await readFile(path.join(koffi,'package.json'),'utf8')).version!==JSON.parse(await readFile(path.join(native,'package.json'),'utf8')).version)throw Error('Koffi native version mismatch');
async function rejectLinks(root) {
  for(const entry of await readdir(root,{withFileTypes:true})) {
    if(entry.isSymbolicLink())throw Error('Dependency contains an unexpected link');
    if(entry.isDirectory())await rejectLinks(path.join(root,entry.name));
  }
}
const modules=path.join(target,'node_modules');await mkdir(modules,{recursive:true});
for(const [name,source] of [['transcribe-cpp',pkg],['koffi',koffi],[nativeName,native]]) {
  await rejectLinks(source);if(path.resolve(source)!==path.resolve(path.join(modules,name)))await cp(source,path.join(modules,name),{recursive:true,force:true});
}
await mkdir(path.join(target,'models'),{recursive:true});
const model=path.join(target,'models',path.basename(config.model));
let modelCurrent=false;try{modelCurrent=await hash(model)===config.modelSha256;}catch{}
if(!modelCurrent&&path.resolve(model)!==path.resolve(config.model))await cp(config.model,model);
const pinned={...config,module:path.join(modules,'transcribe-cpp','dist','index.js'),model,files:[]};
async function collect(root) {
  for(const entry of await readdir(root,{withFileTypes:true})) {
    const file=path.join(root,entry.name);
    if(entry.isDirectory())await collect(file);
    else if(entry.isFile())pinned.files.push({path:file,sha256:await hash(file)});
  }
}
await collect(modules);
// Exercise the COPIED package graph, including the platform-specific FFI module,
// before this runtime can replace a listener. Source-tree success is insufficient.
process.env.TRANSCRIBE_LIBRARY=config.library;
const copied=await import(pathToFileURL(pinned.module).href);copied.version();
for(const entry of await readdir(path.dirname(config.library))) {
  const file=path.join(path.dirname(config.library),entry);
  if(entry.endsWith('.dll')&&(await stat(file)).isFile())pinned.files.push({path:file,sha256:await hash(file)});
}
await writeFile(path.join(target,'runtime.json'),JSON.stringify(pinned),{mode:0o600});
console.log(JSON.stringify({pinnedFiles:pinned.files.length,modelBytes:(await stat(model)).size,nativeLoadVerified:true}));
