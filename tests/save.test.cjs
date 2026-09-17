/* Executes the real save/adoption/reconnect functions with file bytes and a small
 * DOM fixture. Browser picker UI and media decoding are intentionally stubbed. */
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {File}=require('node:buffer');
const E=require('../src/core.js');
const Backup=require('../src/edit-backup.js');
const Files=require('../src/file-storage.js');
const app=fs.readFileSync(path.join(__dirname,'../src/app.js'),'utf8');
function source(from,to){const begin=app.indexOf(from),end=app.indexOf(to,begin);assert.ok(begin>=0&&end>begin);return app.slice(begin,end);}
const plain=value=>JSON.parse(JSON.stringify(value));
const bytes=async file=>Buffer.from(await file.arrayBuffer());

function fixture(){
 const fileA=new File([Buffer.alloc(4111,31)],'First.mp4',{type:'video/mp4',lastModified:1700000000001});
 const fileB=new File([Buffer.alloc(2077,82)],'Second.mov',{type:'video/quicktime',lastModified:1700000000002});
 const audio=new File([Buffer.alloc(1031,63)],'Music.wav',{type:'audio/wav',lastModified:1700000000003});
 const project={...E.defaults(),name:'Saved rhythm',bpm:147.3,meter:3,musicOffset:4.5,musicVolume:.4};
 project.clips=[{...E.makeClip('A','clip-1'),bars:1.25,trimIn:1,trimOut:8,zoom:1.9,fx:.2,fy:.8,preset:''},
  {...E.makeClip('A','clip-2'),bars:.5,trimIn:2,trimOut:6,fill:'fit',preset:''},
  {...E.makeClip('B','clip-3'),bars:2,trimIn:.5,trimOut:7,fit:'contain',preset:''}];
 const assets=new Map([['A',{id:'A',kind:'video',name:fileA.name,file:fileA,duration:10,width:1080,height:1920,url:'blob:old-A'}],
  ['B',{id:'B',kind:'video',name:fileB.name,file:fileB,duration:9,width:1920,height:1080,url:'blob:old-B'}]]);
 return {project,assets,music:{id:'sound-1',name:audio.name,file:audio,buffer:{duration:60}},files:[fileA,fileB,audio]};
}
function environment(){
 const initial=fixture(),elements=new Map(),revoked=[],disposed=[],errors=[],decoded=[];let sequence=0;
 const catalog=new Map([...initial.assets].map(([id,a])=>[id,{duration:a.duration,width:a.width,height:a.height}]));
 function element(tag='div'){const handlers=new Map();return {tagName:tag.toUpperCase(),children:[],hidden:false,open:false,clicks:0,textContent:'',
  append(...children){this.children.push(...children);},addEventListener(name,fn){handlers.set(name,fn);},
  click(){this.clicks++;return handlers.get('click')?.({target:this});},remove(){this.removed=true;},
  close(){this.open=false;},showModal(){this.open=true;},scrollIntoView(){},setAttribute(){}};}
 const $=id=>{if(!elements.has(id))elements.set(id,element());return elements.get(id);};
 const native={chunks:[],closes:0,aborts:0,error:null};
 const handle={async createWritable(){return {async write(chunk){if(native.error)throw native.error;native.chunks.push(Buffer.from(chunk));},async close(){native.closes++;},async abort(){native.aborts++;}};},async getFile(){return new Blob(native.chunks);}};
 const local=new Map();
 const c={E,Blob,File,TextEncoder,TextDecoder,Uint8Array,DataView,structuredClone,DOMException,
  project:initial.project,assets:initial.assets,music:initial.music,selected:'clip-2',head:1.25,dirty:true,
  players:[],currentPreview:null,projectStorage:null,projectTemps:new Set(),history:['old undo'],future:['old redo'],downloadItems:[],pendingRelink:null,
  JAEBackup:Backup,JAEFiles:{...Files,async disposeTemp(temp){disposed.push(temp.name);}},
  URL:{createObjectURL:()=>`blob:prepared-${++sequence}`,revokeObjectURL:url=>revoked.push(url)},
  document:{createElement:element,querySelector:()=>null},window:{showSaveFilePicker:async()=>handle},navigator:{},$,
  localStorage:{setItem:(key,value)=>local.set(key,value),getItem:key=>local.get(key)||null},console:{error:error=>errors.push(error)},
  uid:()=>`id-${++sequence}`,bytes:n=>`${n} bytes`,esc:s=>String(s),safeName:s=>String(s),
  useBusy:async(title,fn)=>fn(),checkCancel(){},progress(){},say(){},
  assetFromFile:async(file,id)=>{decoded.push(id);return {id,kind:'video',name:file.name,file,...catalog.get(id),url:'blob:opened-'+id};},
  decodeMusic:async file=>({id:'restored-sound',name:file.name,file,buffer:{duration:60}}),
  demoAsset:()=>{throw Error('Unexpected demo source.');}
 };
 vm.createContext(c);
 vm.runInContext(source('function releaseAssets(','function newProject('),c);
 vm.runInContext(source('function portableBlob(','async function db('),c);
 const saveButton=()=>c.downloadItems.at(-1).row.children.find(el=>el.textContent==='Save file…');
 return {c,initial,revoked,disposed,errors,decoded,native,$,saveButton};
}

test('adoption retains private sources needed by Undo after clearing downloads and saving again',async()=>{
 const {c,initial,disposed}=environment(),first={name:'S1'},second={name:'S2'};
 const blob1=c.portableBlob();await c.adoptProjectBlob(blob1,first);c.addDownload(blob1,'first.jae',first,c.currentProjectKey());
 await c.clearDownloads();assert.deepEqual(disposed,[]);assert.equal(c.assets.get('B')._storage,first);
 const removed=c.project.clips.find(clip=>clip.asset==='B');c.project.clips=c.project.clips.filter(clip=>clip.asset!=='B');
 const blob2=c.portableBlob();await c.adoptProjectBlob(blob2,second);c.addDownload(blob2,'second.jae',second,c.currentProjectKey());await c.clearDownloads();
 assert.equal(c.assets.get('A')._storage,second);assert.equal(c.assets.get('B')._storage,first);assert.deepEqual(disposed,[],'removed source must remain available for Undo');
 c.project.clips.push(removed);assert.deepEqual(await bytes(c.assets.get('B').file),await bytes(initial.files[1]));
 c.releaseAssets();await Promise.resolve();assert.deepEqual(disposed.sort(),['S1','S2']);assert.equal(c.projectTemps.size,0);
});

test('saving an older prepared file cannot mark a changed soundtrack as saved',async()=>{
 for(const change of [c=>{c.music={...c.music,id:'sound-2'};},c=>{c.music={...c.music,file:new File(['replacement'],'Replacement.wav',{type:'audio/wav',lastModified:42})};}]){
  const {c,saveButton,native,errors}=environment(),key=c.currentProjectKey();c.addDownload(c.portableBlob(),'prepared.jae',null,key);change(c);
  assert.notEqual(c.currentProjectKey(),key);await saveButton().click();assert.equal(native.closes,1);assert.equal(c.dirty,true);assert.deepEqual(errors,[]);
 }
 const unchanged=environment();unchanged.c.addDownload(unchanged.c.portableBlob(),'prepared.jae',null,unchanged.c.currentProjectKey());await unchanged.saveButton().click();assert.equal(unchanged.c.dirty,false,'a verified write of the current snapshot may mark it saved');
});

test('a failed native destination write leaves the current project dirty',async()=>{
 const {c,saveButton,native,errors,$}=environment();c.addDownload(c.portableBlob(),'prepared.jae',null,c.currentProjectKey());native.error=Error('Destination unavailable');
 await saveButton().click();assert.equal(c.dirty,true);assert.equal(native.closes,0);assert.equal(native.aborts,1);assert.equal(errors.length,1);assert.match($('operationErrorMessage').textContent,/Destination unavailable/);assert.equal($('operationErrorDialog').open,true);
});

test('preparing and clicking a browser download never claims the project was saved',async()=>{
 const {c,errors}=environment();delete c.window.showSaveFilePicker;const expected=c.currentProjectKey();await c.saveProject();
 assert.deepEqual(errors,[]);assert.equal(c.downloadItems.length,1);assert.equal(c.dirty,true);assert.equal(c.currentProjectKey(),expected);
 const item=c.downloadItems[0],anchor=item.row.children.find(el=>el.tagName==='A');anchor.click();assert.equal(anchor.clicks,1);assert.equal(c.dirty,true);
 assert.ok((await item.blob.arrayBuffer()).byteLength>6000);assert.equal(item.projectKey,expected);
});

test('failed source reconnection preserves the current edit and cleans only staged sources',async()=>{
 for(const fail of ['missing','audio']){
  const {c,initial,revoked,disposed}=environment(),manifest=Backup.serialize(c.project,c.assets,c.music);
  const before={project:c.project,assets:c.assets,music:c.music,selected:c.selected,head:c.head,dirty:c.dirty,history:c.history,future:c.future};
  const temp={name:'current'};c.projectStorage=temp;c.projectTemps.add(temp);for(const asset of c.assets.values())asset._storage=temp;
  if(fail==='audio')c.decodeMusic=async()=>{throw Error('Audio decode failed');};
  await assert.rejects(c.restoreEdits(manifest,fail==='missing'?[initial.files[0]]:initial.files),fail==='missing'?/Missing original/:/Audio decode failed/);
  for(const [key,value] of Object.entries(before))assert.equal(c[key],value,`${key} must survive failed reconnection`);
  assert.equal(c.projectStorage,temp);assert.deepEqual(disposed,[]);assert.deepEqual(revoked,fail==='audio'?['blob:opened-A','blob:opened-B']:[]);
 }
});

test('successful reconnection restores shared source IDs, motion settings and soundtrack bytes',async()=>{
 const {c,initial,revoked,decoded}=environment(),manifest=Backup.serialize(c.project,c.assets,c.music),expected=plain(c.project);
 c.project={...c.project,name:'Current unsaved edit',bpm:95};await c.restoreEdits(manifest,initial.files);
 assert.deepEqual(plain(c.project),expected);assert.deepEqual(decoded,['A','B']);assert.equal(c.assets.size,2);assert.equal(c.project.clips[0].asset,c.project.clips[1].asset);
 assert.deepEqual(await bytes(c.assets.get('A').file),await bytes(initial.files[0]));assert.deepEqual(await bytes(c.assets.get('B').file),await bytes(initial.files[1]));assert.deepEqual(await bytes(c.music.file),await bytes(initial.files[2]));
 assert.equal(c.selected,'clip-1');assert.equal(c.head,0);assert.equal(c.dirty,true);assert.equal(c.history.length,0);assert.equal(c.future.length,0);assert.deepEqual(revoked,['blob:old-A','blob:old-B']);
});
