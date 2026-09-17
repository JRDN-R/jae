/* Optional desktop-console recovery for an ALREADY OPEN older JAE tab.
 * Keep the edit open. This reads only its in-memory project header, never media
 * payloads. It changes no clips. Do not bypass browser security prompts to run it.
 * The downloaded .jae-edit.json reopens in JAE 1.0.4+ with the original files.
 */
(async()=>{
 'use strict';
 if(!globalThis.JAE?.portableBlob)throw Error('Run this only in the existing Just Animate Everything editor tab.');
 const blob=JAE.portableBlob(),header=await blob.slice(0,12).arrayBuffer();
 if(new TextDecoder().decode(new Uint8Array(header,0,8))!=='JAEproj1')throw Error('The project header is not supported. Keep this tab open.');
 const length=new DataView(header).getUint32(8,true);
 if(length<2||length>16*1048576)throw Error('Invalid project header. Keep this tab open.');
 const manifest=JSON.parse(await blob.slice(12,12+length).text());
 const data={format:'JustAnimateEverythingEdits',version:1,project:manifest.project,assets:manifest.assets,music:manifest.music||null};
 const json=JSON.stringify(data),size=new TextEncoder().encode(json).length;
 let stored=false;try{localStorage.setItem('jae-edit-recovery',json);stored=localStorage.getItem('jae-edit-recovery')===json;}catch{}
 const dialog=document.createElement('dialog'),heading=document.createElement('h2'),message=document.createElement('p'),link=document.createElement('a'),text=document.createElement('textarea'),close=document.createElement('button');
 heading.textContent='Keep your edit';
 message.textContent=(stored?'Your settings were saved in this browser. ':'Browser recovery storage was unavailable. ')+`Download the ${size.toLocaleString()}-byte settings backup below. Keep your original videos and soundtrack. Reopen this backup in JAE 1.0.4 or later and choose those originals. Keep this tab open until the backup succeeds.`;
 link.href='data:application/json;charset=utf-8,'+encodeURIComponent(json);link.download='JAE-rescued-edit.jae-edit.json';link.textContent='Download settings backup';link.style.display='block';link.style.margin='16px 0';
 text.value=json;text.readOnly=true;text.rows=6;text.style.width='100%';text.setAttribute('aria-label','Settings backup JSON; select and copy if downloading fails');
 close.textContent='Close this message';close.type='button';close.onclick=()=>{dialog.close();dialog.remove();};
 dialog.append(heading,message,link,text,close);document.body.append(dialog);dialog.showModal();
})().catch(error=>{console.error('JAE recovery:',error);});
