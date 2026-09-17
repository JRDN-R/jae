const test=require('node:test');
const assert=require('node:assert/strict');
const {File}=require('node:buffer');
const Backup=require('../src/edit-backup.js');
const E=require('../src/core.js');

function original(name,size,lastModified=1234,type='video/mp4'){return new File([new Uint8Array(size)],name,{lastModified,type});}
function unreadable(file){for(const method of ['arrayBuffer','stream','text','slice'])Object.defineProperty(file,method,{value(){throw Error('Original bytes are no longer readable.');}});return file;}
function fixture(){
 const video=original('Original video.mp4',19),sound=original('Soundtrack.wav',23,5678,'audio/wav');
 const project={...E.defaults(),name:'Keep every edit',bpm:147.3,meter:3,resolution:1440,aspect:'4:5',fps:30,format:'mov-hevc',quality:'max',musicOffset:7.25,musicVolume:.37,extra:{nested:['future',true,42]}};
 project.clips=[{...E.makeClip('source-a','clip-1'),bars:1.25,trimIn:2,trimOut:9,zoom:2.3,fx:.17,fy:.81},{...E.makeClip('source-a','clip-2'),bars:.5,trimIn:3,trimOut:7,base:.5,slow:.25,returnZoom:false,fill:'fit'}];
 const assets=new Map([['source-a',{id:'source-a',kind:'video',name:video.name,duration:12,width:1920,height:1080,file:video}],['unused',{id:'unused',kind:'video',file:unreadable(original('Unused.mp4',11))}]]);
 return {project,assets,music:{name:sound.name,file:sound},video,sound};
}

test('settings-only serialization preserves all edits and shared IDs without touching unreadable media bytes',()=>{
 const f=fixture();unreadable(f.video);unreadable(f.sound);
 const backup=Backup.serialize(f.project,f.assets,f.music);
 assert.equal(backup.format,'JustAnimateEverythingEdits');assert.equal(backup.version,1);assert.equal(backup.assets.length,1);
 assert.deepEqual(backup.project,f.project);assert.notEqual(backup.project,f.project);assert.notEqual(backup.project.clips,f.project.clips);
 assert.deepEqual(backup.assets[0],{id:'source-a',kind:'video',name:f.video.name,duration:12,width:1920,height:1080,size:19,type:'video/mp4',lastModified:1234});
 assert.deepEqual(backup.music,{name:f.sound.name,size:23,type:'audio/wav',lastModified:5678});
 assert.deepEqual(Backup.parse(JSON.parse(JSON.stringify(backup))),backup);
 backup.project.extra.nested[0]='changed';assert.equal(f.project.extra.nested[0],'future');
 assert.equal(globalThis.JAEBackup,Backup);
});

test('original files match by exact name and size, with timestamp resolving duplicate candidates',()=>{
 const f=fixture(),manifest=Backup.serialize(f.project,f.assets,f.music),wrongVersion=original(f.video.name,19,999),copiedSound=original(f.sound.name,23,888,'audio/wav');
 const result=Backup.matchFiles(manifest,[wrongVersion,f.video,copiedSound]);
 assert.equal(result.assets.size,1);assert.equal(result.assets.get('source-a'),f.video);assert.equal(result.music,copiedSound,'a unique copied file may have a different timestamp');
 const shared={...manifest,assets:[...manifest.assets,{...manifest.assets[0],id:'source-b'}],project:{...manifest.project,clips:manifest.project.clips.map((c,i)=>i?{...c,asset:'source-b'}:c)}};
 const reused=Backup.matchFiles(shared,[f.video,f.sound]);assert.equal(reused.assets.get('source-a'),reused.assets.get('source-b'),'separately imported references can reconnect to the same original');
});

test('missing and ambiguous originals reject with the filename instead of guessing',()=>{
 const f=fixture(),manifest=Backup.serialize(f.project,f.assets,f.music);
 assert.throws(()=>Backup.matchFiles(manifest,[original(f.video.name,18),f.sound]),/Missing original video: “Original video.mp4”/);
 assert.throws(()=>Backup.matchFiles(manifest,[f.video]),/Missing original soundtrack: “Soundtrack.wav”/);
 assert.throws(()=>Backup.matchFiles(manifest,[f.video,original(f.video.name,19,1234),f.sound]),/More than one version matches “Original video.mp4”/);
 assert.throws(()=>Backup.matchFiles(manifest,[original(f.video.name,19,77),original(f.video.name,19,88),f.sound]),/More than one version matches/);
 assert.equal(Backup.matchFiles(manifest,[f.video,f.video,f.sound]).assets.get('source-a'),f.video,'listing the same File object twice is not ambiguous');
});

test('demo-only edits backups need no original files',()=>{
 const project={...E.defaults(),clips:[{...E.makeClip('demo-a','clip-1'),trimOut:20}]},assets=new Map([['demo-a',{id:'demo-a',kind:'demo',name:'Orbit study',seed:0,duration:20,width:540,height:960}]]);
 const manifest=Backup.serialize(project,assets,null),matched=Backup.matchFiles(manifest,[]);
 assert.equal(matched.assets.size,0);assert.equal(matched.music,null);assert.equal(manifest.assets[0].seed,0);
});

test('invalid counts, IDs, references, sizes, and nonfinite metadata are rejected',()=>{
 const f=fixture(),valid=Backup.serialize(f.project,f.assets,f.music);
 const changes=[
  m=>m.project.clips=[],m=>m.project.clips=Array.from({length:21},(_,i)=>({...m.project.clips[0],id:'clip-'+i})),
  m=>m.assets=[],m=>m.assets.push({...m.assets[0]}),m=>m.assets[0].id='',m=>m.project.clips[1].id=m.project.clips[0].id,
  m=>m.project.clips[0].asset='missing',m=>m.assets[0].size=0,m=>m.assets[0].size=1.5,m=>m.assets[0].duration=Infinity,
  m=>m.assets[0].width=NaN,m=>m.assets[0].height=-1,m=>m.music.size=-1,m=>m.music.lastModified=Infinity,
  m=>m.assets.push({...m.assets[0],id:'unreferenced'}),m=>m.format='JustAnimateEverything',m=>m.version=2
 ];
 for(const change of changes){const corrupt=structuredClone(valid);change(corrupt);assert.throws(()=>Backup.parse(corrupt));}
 const before=structuredClone(valid);Backup.parse(valid);assert.deepEqual(valid,before,'validation must not mutate the loaded backup');
});
