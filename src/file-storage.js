/* Local byte staging. A Blob wrapping an external File still depends on that
 * file; read every byte before offering a portable project as ready to keep. */
(function(root,factory){const api=factory();root.JAEFiles=api;if(typeof module==='object'&&module.exports)module.exports=api;})(globalThis,function(){
 'use strict';
 const DEFAULT_MEMORY_LIMIT=192*1048576,SAMPLE_BYTES=65536;
 const noop=()=>{};
 function sourceError(label,cause){const error=new Error(`${label||'Source media'}: the source is empty or no longer readable. Save a settings-only backup, then reselect the original file.`,{cause});error.name='SourceReadError';return error;}
 function byteSize(blob){if(!blob||!Number.isSafeInteger(blob.size)||blob.size<=0)throw sourceError(blob?.name||'Source media');return blob.size;}
 function sourceLabel(blob){return blob?.name||'Project media';}
 async function assertReadable(blob,label=sourceLabel(blob)){
  try{const size=byteSize(blob),length=Math.min(SAMPLE_BYTES,size);
   const first=await blob.slice(0,length).arrayBuffer();if(first.byteLength!==length)throw Error('The first bytes are incomplete.');
   if(size>length){const last=await blob.slice(size-length,size).arrayBuffer();if(last.byteLength!==length)throw Error('The last bytes are incomplete.');}
   return size;
  }catch(error){throw sourceError(label,error);}
 }
 async function disposeTemp(temp){if(!temp)return;try{await temp.root.removeEntry(temp.name);}catch(error){if(error?.name!=='NotFoundError')throw error;}}
 async function ignoreCleanup(temp){try{await disposeTemp(temp);}catch{}}
 async function readback(handle,expected){const file=await handle.getFile();if(!file||file.size!==expected||file.size<=0)throw Error(`The saved file is incomplete: expected ${expected} bytes, received ${file?.size||0}.`);return file;}
 async function writeToOpen(handle,blob,writer,{onProgress=noop,checkCancel=noop}={}){
  const expected=byteSize(blob);let reader=null,written=0,finished=false;
  try{checkCancel();try{reader=blob.stream().getReader();}catch(error){throw sourceError(sourceLabel(blob),error);}
   while(true){checkCancel();let item;try{item=await reader.read();}catch(error){throw sourceError(sourceLabel(blob),error);}checkCancel();
    if(item.done)break;const size=item.value?.byteLength;
    if(!Number.isSafeInteger(size)||size<=0||written+size>expected)throw sourceError(sourceLabel(blob),Error('The source stream has an invalid length.'));
    await writer.write(item.value);written+=size;onProgress(written,expected);
   }
   if(written!==expected)throw sourceError(sourceLabel(blob),Error(`Read ${written} of ${expected} bytes.`));
   checkCancel();await writer.close();checkCancel();await readback(handle,expected);finished=true;return written;
  }catch(error){try{await writer.abort();}catch{}throw error;}
  finally{if(reader){if(!finished)try{await reader.cancel();}catch{}try{reader.releaseLock();}catch{}}}
 }
 async function writeBlob(handle,blob,options={}){
  byteSize(blob);(options.checkCancel||noop)();const writer=await handle.createWritable();return writeToOpen(handle,blob,writer,options);
 }
 async function stageBlob(blob,{onProgress=noop,checkCancel=noop,storage=globalThis.navigator?.storage,maxMemoryBytes=DEFAULT_MEMORY_LIMIT}={}){
  const expected=byteSize(blob);checkCancel();let temp=null,writer=null;
  if(storage?.getDirectory){try{const root=await storage.getDirectory(),name='jae-staged-'+(globalThis.crypto?.randomUUID?.()||`${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);
    temp={root,name,handle:null};temp.handle=await root.getFileHandle(name,{create:true});writer=await temp.handle.createWritable();
   }catch(error){await ignoreCleanup(temp);temp=null;if(error?.name==='AbortError')throw error;}
  }
  if(writer){try{await writeToOpen(temp.handle,blob,writer,{onProgress,checkCancel});const saved=await readback(temp.handle,expected);await assertReadable(saved,'Prepared project');checkCancel();return {blob:new Blob([saved],{type:blob.type||saved.type||'application/octet-stream'}),temp};}
   catch(error){await ignoreCleanup(temp);throw error;}
  }
  checkCancel();if(!Number.isFinite(maxMemoryBytes)||maxMemoryBytes<0||expected>maxMemoryBytes)throw Error('This project is too large to prepare in memory and private file storage is unavailable. Free browser storage or save a settings-only backup.');
  let buffer;try{buffer=await blob.arrayBuffer();}catch(error){throw sourceError(sourceLabel(blob),error);}checkCancel();
  if(buffer.byteLength!==expected)throw sourceError(sourceLabel(blob),Error(`Read ${buffer.byteLength} of ${expected} bytes.`));
  const detached=new Blob([buffer],{type:blob.type||'application/octet-stream'});if(detached.size!==expected)throw Error('The prepared project has an incorrect byte count.');onProgress(expected,expected);checkCancel();return {blob:detached,temp:null};
 }
 return {stageBlob,writeBlob,assertReadable,disposeTemp};
});
