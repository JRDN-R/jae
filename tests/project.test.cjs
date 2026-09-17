/* Portable-project integration checks using the actual serializer, importer, and
 * asset-release function. Browser video/audio decoding is intentionally stubbed:
 * these tests prove the container, bytes, references, settings, and atomic import
 * behavior, not real browser codec support. runtime.test.cjs exercises the actual
 * bundled media iterator separately. */
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {File}=require('node:buffer');
const E=require('../src/core.js');
const app=fs.readFileSync(path.join(__dirname,'../src/app.js'),'utf8');
function source(from,to){const begin=app.indexOf(from),end=app.indexOf(to,begin);assert.ok(begin>=0&&end>begin);return app.slice(begin,end);}
const plain=value=>JSON.parse(JSON.stringify(value));
const bytes=file=>file.arrayBuffer().then(value=>Buffer.from(value));

function fixture(){
 const mediaA=new File([Uint8Array.from({length:4099},(_,i)=>(i*71)%256)],'Portrait take.mp4',{type:'video/mp4',lastModified:1700000000123});
 const mediaB=new File([Uint8Array.from({length:2053},(_,i)=>(255-i*13)&255)],'Second take.mov',{type:'video/quicktime',lastModified:1700000000456});
 const audio=new File([Uint8Array.from({length:1027},(_,i)=>(i*19+128)%256)],'Soundtrack.wav',{type:'audio/wav',lastModified:1700000000789});
 const project={...E.defaults(),name:'Saved rhythm – 日本',bpm:147.3,meter:3,defaultBars:1.25,resolution:1080,aspect:'4:5',fps:30,format:'mov-hevc',quality:'max',musicOffset:37.5,musicVolume:.37};
 project.clips=[
  {...E.makeClip('asset-a','clip-1'),bars:1.25,trimIn:1.75,trimOut:9.5,zoom:2.1,fx:.27,fy:.76,fill:'hold',preset:''},
  {...E.makeClip('asset-a','clip-2'),bars:.5,trimIn:3.25,trimOut:8.25,base:.75,peak:3.5,slow:.25,onset:.625,attack:.5,release:1,returnZoom:false,fit:'contain',preset:''},
  {...E.makeClip('asset-b','clip-3'),bars:2.75,trimIn:.5,trimOut:7.5,fill:'fit'}
 ];
 const assets=new Map([
  ['asset-a',{id:'asset-a',kind:'video',name:mediaA.name,file:mediaA,duration:12,width:1080,height:1920,url:'blob:old-asset-a'}],
  ['asset-b',{id:'asset-b',kind:'video',name:mediaB.name,file:mediaB,duration:8,width:1920,height:1080,url:'blob:old-asset-b'}],
  ['unused',{id:'unused',kind:'video',name:'Removed.mp4',file:new File(['unused media'],'Removed.mp4'),duration:3,url:'blob:unused'}]
 ]);
 return {project,assets,music:{name:audio.name,file:audio,buffer:{duration:120}},files:{mediaA,mediaB,audio}};
}

function environment(initial=fixture()){
 const revoked=[],decodedVideos=[],decodedAudio=[];
 const catalog=new Map([...initial.assets].map(([id,a])=>[id,{duration:a.duration,width:a.width,height:a.height}]));
 const context={E,Blob,File,TextEncoder,TextDecoder,Uint8Array,DataView,structuredClone,DOMException,
  project:initial.project,assets:initial.assets,music:initial.music,selected:'clip-2',head:1.2,dirty:true,
  players:[],currentPreview:null,history:['old undo'],future:['old redo'],URL:{revokeObjectURL:url=>revoked.push(url)},
  useBusy:async(title,fn)=>fn(),checkCancel(){},progress(){},say(){},
  assetFromFile:async(file,id)=>{decodedVideos.push({file,id});return {id,kind:'video',name:file.name,file,...catalog.get(id),url:'blob:opened-'+id};},
  decodeMusic:async file=>{decodedAudio.push(file);return {name:file.name,file,buffer:{duration:120}};},
  demoAsset:()=>{throw Error('This fixture only includes original media files.');}
 };
 vm.createContext(context);
 vm.runInContext(source('function releaseAssets(','function newProject('),context);
 vm.runInContext(source('function portableBlob(','function addDownload('),context);
 return {context,revoked,decodedVideos,decodedAudio,initial};
}

async function unpack(blob){const buffer=await blob.arrayBuffer(),length=new DataView(buffer).getUint32(8,true);return {manifest:JSON.parse(new TextDecoder().decode(new Uint8Array(buffer,12,length))),payload:blob.slice(12+length),headerSize:12+length};}
async function changeManifest(blob,change){const {manifest,payload}=await unpack(blob);change(manifest);const json=new TextEncoder().encode(JSON.stringify(manifest)),header=new Uint8Array(12);header.set(new TextEncoder().encode('JAEproj1'));new DataView(header.buffer).setUint32(8,json.length,true);return new Blob([header,json,payload]);}

test('portable save/reopen preserves video and soundtrack bytes, settings, and shared media references',async()=>{
 const {context:c,initial,decodedVideos,decodedAudio,revoked}=environment(),expected=plain(c.project),blob=c.portableBlob();
 const {manifest,payload}=await unpack(blob);
 assert.equal(manifest.assets.length,2,'duplicate clips must embed a shared original only once');
 assert.equal(payload.size,initial.files.mediaA.size+initial.files.mediaB.size+initial.files.audio.size);
 assert.equal(manifest.assets.some(a=>a.id==='unused'),false,'removed and unused sources do not enlarge the saved project');
 await c.openPortable(blob);
 assert.deepEqual(plain(c.project),expected);
 assert.equal(c.assets.size,2);assert.equal(decodedVideos.length,2);assert.equal(decodedAudio.length,1);
 assert.equal(c.project.clips[0].asset,c.project.clips[1].asset);
 for(const [id,original] of [['asset-a',initial.files.mediaA],['asset-b',initial.files.mediaB]]){
  const restored=c.assets.get(id).file;assert.deepEqual(await bytes(restored),await bytes(original));
  assert.equal(restored.name,original.name);assert.equal(restored.type,original.type);assert.equal(restored.lastModified,original.lastModified);
 }
 assert.deepEqual(await bytes(c.music.file),await bytes(initial.files.audio));
 assert.equal(c.music.file.name,initial.files.audio.name);assert.equal(c.music.file.type,initial.files.audio.type);assert.equal(c.music.file.lastModified,initial.files.audio.lastModified);
 assert.equal(c.selected,'clip-1');assert.equal(c.head,0);assert.equal(c.dirty,false);
 assert.equal(c.history.length,0);assert.equal(c.future.length,0);
 assert.deepEqual(revoked,['blob:old-asset-a','blob:old-asset-b','blob:unused']);
 const secondSave=await unpack(c.portableBlob());assert.deepEqual(secondSave.manifest.project,expected);
 assert.deepEqual(await bytes(secondSave.payload),await bytes(payload));
});

test('corrupt header and truncated media reject without replacing the existing edit',async()=>{
 const {context:c,revoked}=environment(),blob=c.portableBlob(),before={project:c.project,assets:c.assets,music:c.music,selected:c.selected,head:c.head,dirty:c.dirty};
 for(const invalid of [new Blob(['not a project']),blob.slice(0,20),blob.slice(0,blob.size-1)]){
  await assert.rejects(c.openPortable(invalid),/supported|incomplete|truncated|corrupt/);
  for(const [key,value] of Object.entries(before))assert.equal(c[key],value,`${key} must survive a failed import`);
 }
 assert.ok(!revoked.some(url=>url.startsWith('blob:old-')),'an invalid import must retain current media URLs');
 assert.deepEqual(revoked,['blob:opened-asset-a','blob:opened-asset-b'],'staged sources must be released when the final soundtrack is truncated');
});

test('invalid clip references and duplicate asset IDs reject atomically and release staged sources',async()=>{
 for(const mutate of [m=>{m.project.clips[1].asset='missing';},m=>{m.assets[1].id=m.assets[0].id;}]){
  const {context:c,revoked}=environment(),blob=await changeManifest(c.portableBlob(),mutate),before={project:c.project,assets:c.assets,music:c.music};
  await assert.rejects(c.openPortable(blob),/Invalid clip reference|duplicate source ID/);
  for(const [key,value] of Object.entries(before))assert.equal(c[key],value);
  assert.ok(revoked.length>0);assert.ok(revoked.every(url=>url.startsWith('blob:opened-')));
  assert.equal(c.dirty,true);assert.equal(c.selected,'clip-2');assert.equal(c.head,1.2);
 }
});

test('a soundtrack decode failure retains the current edit and cleans all staged video URLs',async()=>{
 const {context:c,revoked}=environment(),blob=c.portableBlob(),before={project:c.project,assets:c.assets,music:c.music};
 c.decodeMusic=async()=>{throw Error('Soundtrack decoding unavailable.');};
 await assert.rejects(c.openPortable(blob),/Soundtrack decoding unavailable/);
 for(const [key,value] of Object.entries(before))assert.equal(c[key],value);
 assert.deepEqual(revoked,['blob:opened-asset-a','blob:opened-asset-b']);
});
