/* Settings-only backups never read the bytes of an original media file. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;root.JAEBackup=api;})(globalThis,function(){
'use strict';
const FORMAT='JustAnimateEverythingEdits',VERSION=1,MAX_CLIPS=20;
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const id=value=>typeof value==='string'&&value.length>0&&value.length<=256;
const positive=value=>typeof value==='number'&&Number.isFinite(value)&&value>0;
function copy(value){try{return structuredClone(value);}catch{throw Error('This edits backup contains unsupported data.');}}
function fileDescriptor(file,label){
 if(!file||typeof file.name!=='string'||!file.name||file.name.length>1024||!Number.isSafeInteger(file.size)||file.size<1)throw Error(`${label}: the original file name or size is missing.`);
 const type=file.type??'',lastModified=file.lastModified??0;
 if(typeof type!=='string'||type.length>256||!Number.isSafeInteger(lastModified))throw Error(`${label}: the original file metadata is invalid.`);
 return {name:file.name,size:file.size,type,lastModified};
}
function parse(raw){
 if(!object(raw)||raw.format!==FORMAT||raw.version!==VERSION)throw Error('This is not a supported JAE edits backup.');
 if(!object(raw.project)||!Array.isArray(raw.project.clips)||raw.project.clips.length<1||raw.project.clips.length>MAX_CLIPS)throw Error('An edits backup must contain 1–20 clips.');
 if(!Array.isArray(raw.assets)||raw.assets.length<1||raw.assets.length>MAX_CLIPS)throw Error('The edits backup has an invalid number of original sources.');
 const sourceIds=new Set(),descriptors=[];
 for(const a of raw.assets){
  if(!object(a)||!id(a.id)||sourceIds.has(a.id))throw Error('The edits backup has an invalid or duplicate source ID.');
  if(a.kind!=='video'&&a.kind!=='demo')throw Error('The edits backup contains an unsupported source type.');
  if(typeof a.name!=='string'||!a.name||a.name.length>1024||!positive(a.duration)||!positive(a.width)||!positive(a.height))throw Error(`The source “${typeof a.name==='string'?a.name:'unknown'}” has invalid duration or dimensions.`);
  const descriptor={id:a.id,kind:a.kind,name:a.name,duration:a.duration,width:a.width,height:a.height};
  if(a.kind==='video')Object.assign(descriptor,fileDescriptor(a,`Video “${a.name}”`));
  else{if(!Number.isInteger(a.seed)||a.seed<0||a.seed>2)throw Error(`The demo source “${a.name}” has an invalid seed.`);Object.assign(descriptor,{seed:a.seed,size:0,type:'',lastModified:0});}
  sourceIds.add(a.id);descriptors.push(descriptor);
 }
 const clipIds=new Set(),referenced=new Set();
 for(const clip of raw.project.clips){
  if(!object(clip)||!id(clip.id)||clipIds.has(clip.id))throw Error('The edits backup has an invalid or duplicate clip ID.');
  if(!id(clip.asset)||!sourceIds.has(clip.asset))throw Error('A clip in the edits backup refers to a missing original source.');
  clipIds.add(clip.id);referenced.add(clip.asset);
 }
 if(referenced.size!==sourceIds.size)throw Error('The edits backup contains an unreferenced original source.');
 if(raw.music!==null&&!object(raw.music))throw Error('The edits backup has invalid soundtrack metadata.');
 return {format:FORMAT,version:VERSION,project:copy(raw.project),assets:descriptors,music:raw.music===null?null:fileDescriptor(raw.music,'Soundtrack')};
}
function serialize(project,assets,music){
 const saved=copy(project);
 if(!object(saved)||!Array.isArray(saved.clips)||saved.clips.length<1||saved.clips.length>MAX_CLIPS)throw Error('Add 1–20 clips before saving an edits backup.');
 if(!assets||typeof assets.get!=='function')throw Error('The original source list is unavailable.');
 const descriptors=[],used=new Set();
 for(const clip of saved.clips){
  if(!object(clip)||!id(clip.asset))throw Error('A clip has an invalid original source ID.');
  if(used.has(clip.asset))continue;used.add(clip.asset);
  const a=assets.get(clip.asset);if(!a||a.id!==clip.asset)throw Error(`The original source for clip “${clip.id||'unknown'}” is missing.`);
  const descriptor={id:a.id,kind:a.kind,name:a.name,duration:a.duration,width:a.width,height:a.height};
  if(a.kind==='video')Object.assign(descriptor,fileDescriptor(a.file,`Video “${a.name||'unknown'}”`));
  else if(a.kind==='demo')Object.assign(descriptor,{seed:a.seed,size:0,type:'',lastModified:0});
  descriptors.push(descriptor);
 }
 return parse({format:FORMAT,version:VERSION,project:saved,assets:descriptors,music:music?fileDescriptor(music.file,'Soundtrack'):null});
}
function matchFiles(raw,files){const manifest=parse(raw);let chosen;
 try{if(!files||typeof files[Symbol.iterator]!=='function')throw Error();chosen=[...new Set(files)];}catch{throw Error('Choose the original video and soundtrack files to reopen this edits backup.');}
 for(const file of chosen)if(!file||typeof file.name!=='string'||!Number.isSafeInteger(file.size)||typeof file.slice!=='function')throw Error('One of the selected items is not an original file.');
 function match(descriptor,kind){
  let candidates=chosen.filter(file=>file.name===descriptor.name&&file.size===descriptor.size);
  if(!candidates.length)throw Error(`Missing original ${kind}: “${descriptor.name}” (${descriptor.size.toLocaleString('en-US')} bytes). Choose the original file to reconnect it.`);
  if(candidates.length>1)candidates=candidates.filter(file=>file.lastModified===descriptor.lastModified);
  if(candidates.length!==1)throw Error(`More than one version matches “${descriptor.name}”. Choose only the original ${kind} file to reconnect it.`);
  return candidates[0];
 }
 const restored=new Map();for(const descriptor of manifest.assets)if(descriptor.kind==='video')restored.set(descriptor.id,match(descriptor,'video'));
 return {assets:restored,music:manifest.music?match(manifest.music,'soundtrack'):null};
}
return {serialize,parse,matchFiles};
});
