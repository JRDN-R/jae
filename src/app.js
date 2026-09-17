/* JAE application. No fetch, telemetry, API keys, or remote media processing. */
(() => {
'use strict';
const E=globalThis.JAECore, M=globalThis.Mediabunny, $=id=>document.getElementById(id);
const uid=()=>globalThis.crypto?.randomUUID?.()||`jae-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
let project=E.defaults(), assets=new Map(), selected=null, music=null, dirty=false, playing=false, loop=true, metronome=false, head=0;
let audioCtx=null, masterGain=null, musicNode=null, musicGain=null, audioEpoch=0, perfEpoch=0, metroTimer=0, nextClick=0, lastLoop=-1, currentPreview=null;
let history=[],future=[],sliderBefore=null,busy=false,cancelled=false,activeOutput=null,wakeLock=null,toastTimer=0,checkVersion=0,capabilityOK=false;
let miniPlayer=null,playRequest=0,playPending=false;
const clicks=new Set(), downloadItems=[], MAX_CLIPS=20;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const fmt=(x,d=2)=>Number(x).toFixed(d), bytes=n=>n<1048576?`${fmt(n/1024,1)} KB`:`${fmt(n/1048576,1)} MB`;
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safeName=s=>String(s||'rhythm').replace(/\.[^.]+$/,'').replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').trim().slice(0,90)||'rhythm';
const selectedClip=()=>project.clips.find(c=>c.id===selected);
const total=()=>E.segments(project).at(-1)?.end||0;
const snapshot=()=>JSON.stringify({project,selected});
function say(s,popup=false){$('status').textContent=s;if(popup){clearTimeout(toastTimer);$('toast').textContent=s;$('toast').hidden=false;toastTimer=setTimeout(()=>$('toast').hidden=true,5000);}}
function fail(error){console.error(error);say(error?.message||String(error),true);}
function listen(id,event,fn){$(id).addEventListener(event,async e=>{try{await fn(e);}catch(err){fail(err);}});}
function checkpoint(s=snapshot()){history.push(s);if(history.length>60)history.shift();future=[];dirty=true;}
function commit(fn){pause();checkpoint();fn();project=E.normalizeProject(project);head=Math.min(head,Math.max(0,total()-.0001));render();}
function restore(s){const v=JSON.parse(s);project=E.normalizeProject(v.project);selected=v.selected;head=0;dirty=true;render();}
function undo(){if(busy||!history.length)return;pause();future.push(snapshot());restore(history.pop());}
function redo(){if(busy||!future.length)return;pause();history.push(snapshot());restore(future.pop());}
function selectClip(id,seek=true){pause();selected=id;if(seek){const s=E.segments(project).find(s=>s.clip.id===id);if(s)head=s.start;}render();}
function clipStart(id){return E.segments(project).find(s=>s.clip.id===id)?.start||0;}
function reorder(id,beforeId){if(id===beforeId)return;commit(()=>{const i=project.clips.findIndex(c=>c.id===id),j=project.clips.findIndex(c=>c.id===beforeId);if(i<0||j<0)return;const [c]=project.clips.splice(i,1);project.clips.splice(j,0,c);selected=id;head=clipStart(id);});}
function moveClip(delta){const i=project.clips.findIndex(c=>c.id===selected),j=i+delta;if(i<0||j<0||j>=project.clips.length)return;commit(()=>{[project.clips[i],project.clips[j]]=[project.clips[j],project.clips[i]];head=clipStart(selected);});}
function removeClip(){if(!selectedClip())return;commit(()=>{let i=project.clips.findIndex(c=>c.id===selected);project.clips.splice(i,1);selected=project.clips[Math.min(i,project.clips.length-1)]?.id||null;head=selected?clipStart(selected):0;});}
function duplicateClip(){if(!selectedClip())return;if(project.clips.length>=MAX_CLIPS){say('The arrangement can hold up to 20 clips.',true);return;}commit(()=>{const i=project.clips.findIndex(c=>c.id===selected),c={...project.clips[i],id:uid()};project.clips.splice(i+1,0,c);selected=c.id;head=clipStart(c.id);});}
function render(){
 $('projectName').value=project.name;$('bpm').value=project.bpm;$('meter').value=project.meter;$('defaultBars').value=project.defaultBars;
 $('clipCount').textContent=`${String(project.clips.length).padStart(2,'0')} / 20`;
 $('clipList').innerHTML=project.clips.map((c,i)=>{const a=assets.get(c.asset);return `<button class="clip-item${c.id===selected?' selected':''}" draggable="true" data-id="${esc(c.id)}" aria-pressed="${c.id===selected}" title="${esc(a?.name||'Missing source')}"><img src="${a?.thumb||''}" alt=""><span class="clip-text"><b>${esc(a?.name||'Missing source')}</b><small>${fmt(c.bars)} bars · ${fmt(E.duration(c,project))}s</small></span><span class="index">${String(i+1).padStart(2,'0')}</span></button>`;}).join('');
 const enabled=project.clips.length>0;
 for(const id of ['playBtn','backBtn','forwardBtn','exportBtn','equalBtn','shuffleBtn'])$(id).disabled=!enabled;
 $('downloadProjectBtn').disabled=!enabled;$('localSaveBtn').disabled=!enabled;$('addBtn').disabled=project.clips.length>=20;$('emptyFrame').hidden=enabled;$('timelineEmpty').hidden=enabled;$('playhead').hidden=!enabled;
 $('undoBtn').disabled=!history.length;$('redoBtn').disabled=!future.length;
 for(const id of ['moveLeftBtn','moveRightBtn','duplicateBtn','deleteBtn'])$(id).disabled=!selectedClip();
 $('scrubber').max=total()||1;$('totalTime').textContent=`${fmt(total())} s`;
 $('arrangementInfo').textContent=`${project.bpm} BPM · ${project.meter} beats / bar · ${fmt(project.clips.reduce((n,c)=>n+c.bars,0))} bars`;
 $('musicName').textContent=music?music.name:'No soundtrack';$('removeMusicBtn').hidden=!music;$('musicOffset').value=project.musicOffset;$('musicVolume').value=project.musicVolume;
 const dim=E.dimensions(project),is4k=project.resolution===2160;
 $('specLabel').textContent=is4k?'4K':project.resolution+'p';$('specDetails').textContent=`${project.fps} FPS · ${project.aspect}`;
 $('canvasTag').textContent=`${project.aspect} / ${is4k?'4K':project.resolution+'p'}`;
 const ratio=dim.width/dim.height,base=innerWidth<580?224:258;
 $('frame').style.aspectRatio=`${dim.width} / ${dim.height}`;$('frame').style.width=ratio<=1?base+'px':Math.min(600,$('stage').clientWidth-16)+'px';
 const pv=$('preview'),pw=ratio<=1?432:768,ph=Math.round(pw/ratio);if(pv.width!==pw||pv.height!==ph){pv.width=pw;pv.height=ph;}
 $('beatLights').innerHTML=Array.from({length:project.meter},()=>'<i></i>').join('');
 renderInspector();renderTimeline();drawPreview();updateTransport();miniPlayer?.sync();
}
function renderInspector(){const c=selectedClip(),a=c&&assets.get(c.asset);$('clipControls').hidden=!c;$('clipControls').disabled=!c;$('inspectorEmpty').hidden=!!c;
 $('selectedNumber').textContent=c?`CLIP ${String(project.clips.indexOf(c)+1).padStart(2,'0')}`:'NO CLIP';if(!c)return;
 $('selectedName').textContent=a?.name||'Missing source';
 document.querySelectorAll('[data-clip]').forEach(el=>{const k=el.dataset.clip;if(el.type==='checkbox')el.checked=!!c[k];else el.value=c[k];});
 $('onset').max=E.beats(c,project);$('trimIn').max=Math.max(0,(a?.duration||1)-.01);$('trimOut').max=a?.duration||1;
 document.querySelectorAll('[data-preset]').forEach(b=>b.classList.toggle('active',b.dataset.preset===c.preset));
 updateInspectorReadouts();
}
function updateInspectorReadouts(){const c=selectedClip();if(!c)return;
 for(const k of ['zoom','base'])$(k+'Out').textContent=fmt(c[k])+'×';for(const k of ['fx','fy'])$(k+'Out').textContent=Math.round(c[k]*100)+'%';
 const need=E.motion(c,project,0).needed,range=c.trimOut-c.trimIn,d=E.duration(c,project),ks=E.keys(c,project);
 let note=`${fmt(E.beats(c,project))} beats = ${fmt(d,3)}s. Uses ${fmt(need)}s of source.`;
 if(c.fill==='fit')note+=` Curve scaled ${fmt(range/need)}× to fit the trim.`;
 else if(need>range+.001)note+=c.fill==='loop'?' Source repeats inside this slot.':' Final frame holds when source ends.';
 if(c.ramp&&Math.abs(ks[1].b-c.onset)>.001)note+=' Ramp begins earlier to fit this short slot.';
 $('clipMath').textContent=note;$('curveTiming').textContent=fmt(d,2)+'s';drawCurve();
}
function curvePath(c,p,width,height,type='speed'){let max=type==='speed'?Math.max(c.base,c.peak,c.slow,1)*1.12:3.2;return Array.from({length:101},(_,i)=>{const r=E.curve(c,p,E.beats(c,p)*i/100),v=type==='speed'?r.speed:r.zoom;return `${i?'L':'M'}${fmt(i*width/100,2)},${fmt(height-5-v/max*(height-14),2)}`;}).join(' ');}
function drawCurve(){const c=selectedClip();if(!c)return;const B=E.beats(c,project),ticks=Math.min(32,Math.ceil(B));let grid='';for(let i=0;i<=ticks;i++){const x=i/ticks*280;grid+=`<path d="M${x} 5V91" stroke="#ffffff0b"/>`;}
 $('curve').innerHTML=grid+`<path d="M0 90H280" stroke="#ffffff14"/><path d="${curvePath(c,project,280,87,'speed')}" fill="none" stroke="#858cf0" stroke-width="1.7"/><path d="${curvePath(c,project,280,87,'zoom')}" fill="none" stroke="#b4a3e8" stroke-width="1.3"/><text x="1" y="103" fill="#8a7f96" font-size="8">0</text><text x="252" y="103" fill="#8a7f96" font-size="8">${fmt(B,0)} beats</text>`;
}
function renderTimeline(){const perBar=+$('timelineZoom').value,px=perBar/project.meter,bs=E.secondsPerBeat(project),segments=E.segments(project);let totalWidth=Math.max($('timelineScroll').clientWidth,total()/bs*px);$('timeline').style.width=totalWidth+'px';
 let r='',B=totalWidth/px;for(let b=0;b<B;b++){let x=b*px;if(b%project.meter===0)r+=`<span style="left:${x}px">${Math.floor(b/project.meter)+1}</span>`;else r+=`<i style="left:${x}px"></i>`;}$('ruler').innerHTML=r;
 $('timelineClips').innerHTML=segments.map(({clip:c},i)=>`<button class="timeline-clip${c.id===selected?' selected':''}" data-id="${esc(c.id)}" draggable="true" style="width:${E.beats(c,project)*px}px" aria-label="Clip ${i+1}, ${esc(assets.get(c.asset)?.name)}, ${c.bars} bars"><b>${String(i+1).padStart(2,'0')} / ${esc(assets.get(c.asset)?.name||'Clip')}</b><small>${c.bars} bars</small><svg viewBox="0 0 100 20" preserveAspectRatio="none" aria-hidden="true"><path d="${curvePath(c,project,100,20)}" fill="none" stroke="#b4a3e8" stroke-width=".9"/></svg></button>`).join('');updateTransport();
}
function updateTransport(){const t=Math.max(0,head),bs=E.secondsPerBeat(project),b=t/bs;
 const m=Math.floor(t/60),s=(t%60).toFixed(3).padStart(6,'0');$('clock').textContent=`${String(m).padStart(2,'0')}:${s}`;
 $('barClock').textContent=`BAR ${String(Math.floor(b/project.meter)+1).padStart(2,'0')} · BEAT ${Math.floor(b%project.meter)+1}`;
 $('scrubber').value=t;$('playhead').style.left=(b*+$('timelineZoom').value/project.meter)+'px';
 $('playBtn').textContent=playing?'Ⅱ':'▶';$('playBtn').setAttribute('aria-label',playing?'Pause':'Play');
 [...$('beatLights').children].forEach((el,i)=>el.classList.toggle('lit',playing&&i===Math.floor(b%project.meter)&&b%1<.38));
 const loc=E.locate(project,t);document.querySelectorAll('.clip-item').forEach(el=>el.classList.toggle('playing',playing&&el.dataset.id===loc?.clip.id));
 miniPlayer?.draw();
}
const players=Array.from({length:2},()=>{const v=document.createElement('video');v.muted=true;v.playsInline=true;v.setAttribute('playsinline','');v.preload='auto';v.style.cssText='position:fixed;width:1px;height:1px;left:-10px;top:0;opacity:0;pointer-events:none';document.body.append(v);
 // Metadata can arrive after the first paused render. A completed seek must also
 // catch up to the latest scrub position if the user moved while it was pending.
 for(const event of ['loadedmetadata','loadeddata','seeked'])v.addEventListener(event,()=>{if(!busy&&v===currentPreview)drawPreview();});
 return v;});
const demoCanvas=document.createElement('canvas');demoCanvas.width=540;demoCanvas.height=960;
function paintDemo(a,t,canvas=demoCanvas){const ctx=canvas.getContext('2d'),w=canvas.width,h=canvas.height,seed=a.seed||0;
 let g=ctx.createLinearGradient(0,0,w,h);g.addColorStop(0,['#0c0e2c','#0a0c21','#1d0d2d'][seed%3]);g.addColorStop(1,'#03030a');ctx.fillStyle=g;ctx.fillRect(0,0,w,h);
 const x=w*(.49+.10*Math.sin(t*.65+seed)),y=h*(.48+.05*Math.cos(t*.7+seed));
 ctx.save();ctx.translate(x,y);ctx.rotate(.2+Math.sin(t*.3+seed)*.13);
 for(let j=15;j>=0;j--){const k=j/15,rad=w*(.17+k*.30),yy=Math.sin(t*.8+k*4+seed)*h*.035;
 ctx.beginPath();ctx.ellipse(0,yy,rad,rad*(.33+.15*Math.sin(t*.22+seed)),.4+k*.55,0,Math.PI*2);
 ctx.lineWidth=1.2+(1-k)*2;ctx.strokeStyle=`rgba(${seed%2?'168,154,191':'137,146,221'},${.14+(1-k)*.65})`;ctx.shadowColor='#8879c9';ctx.shadowBlur=(1-k)*13;ctx.stroke();}
 ctx.restore();ctx.shadowBlur=0;
 const orbX=x+Math.cos(t*.55+seed)*w*.23,orbY=y+Math.sin(t*.55+seed)*h*.13;
 g=ctx.createRadialGradient(orbX-w*.023,orbY-w*.024,1,orbX,orbY,w*.064);g.addColorStop(0,'#f2eafb');g.addColorStop(.3,'#b3a3d5');g.addColorStop(1,'#30213e');ctx.fillStyle=g;ctx.beginPath();ctx.arc(orbX,orbY,w*.065,0,Math.PI*2);ctx.fill();
 ctx.fillStyle='#aaa1ba';ctx.font=`${w*.018}px monospace`;ctx.fillText(`MOTION STUDY / ${String(seed+1).padStart(2,'0')}`,w*.10,h*.12);
 ctx.fillStyle='#cbbbdc';ctx.font=`italic ${w*.085}px Georgia`;ctx.fillText(['in motion.','in rhythm.','in a moment.'][seed%3],w*.10,h*.82);
 ctx.fillStyle='#716985';ctx.font=`${w*.017}px monospace`;ctx.fillText('PROCEDURAL DEMO FOOTAGE',w*.10,h*.87);return canvas;
}
function drawMedia(ctx,source,c,p,local){const w=ctx.canvas.width,h=ctx.canvas.height,sw=source.videoWidth||source.width,sh=source.videoHeight||source.height;if(!sw||!sh)return;
 const m=E.motion(c,p,local),scale=(c.fit==='contain'?Math.min(w/sw,h/sh):Math.max(w/sw,h/sh))*m.zoom,dw=sw*scale,dh=sh*scale;
 ctx.fillStyle='#000';ctx.fillRect(0,0,w,h);ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';ctx.drawImage(source,(w-dw)*c.fx,(h-dh)*c.fy,dw,dh);
}
function choosePlayer(a){let v=players.find(v=>v._asset===a.id);if(!v){v=players.find(v=>v!==currentPreview)||players[0];v.pause();v._asset=a.id;v.src=a.url;v.load();v._pendingSeek=null;}return v;}
function drawPreview(sync=true){if(busy)return;const loc=E.locate(project,head),ctx=$('preview').getContext('2d',{alpha:false});if(!loc){ctx.fillStyle='#06060d';ctx.fillRect(0,0,ctx.canvas.width,ctx.canvas.height);return;}
 const c=loc.clip,a=assets.get(c.asset);if(!a)return;const m=E.motion(c,project,loc.local);
 if(a.kind==='demo'){if(currentPreview)currentPreview.pause();currentPreview=null;drawMedia(ctx,paintDemo(a,m.time),c,project,loc.local);return;}
 const v=choosePlayer(a);if(currentPreview!==v){if(currentPreview)currentPreview.pause();currentPreview=v;}
 const target=Math.min(Math.max(0,v.duration-.001)||a.duration,m.time);
 const holding=c.fill==='hold'&&m.time>=Math.max(c.trimIn,c.trimOut-.001)-1e-7;
 if(v.readyState>=1&&sync){
   const outsideTrim=v.currentTime<c.trimIn-.001||v.currentTime>=c.trimOut;
   if(!v.seeking&&(outsideTrim||Math.abs(v.currentTime-target)>(playing&&!holding?.10:.001))){v.currentTime=target;}
   try{v.playbackRate=E.clamp(m.speed,.0625,16);}catch{}
   if(playing&&!holding&&v.paused)v.play().catch(()=>{});else if(!playing||holding)v.pause();
 }
 if(v.readyState>=2&&!v.seeking)drawMedia(ctx,v,c,project,loc.local);
 else if(!playing&&a.thumbImage?.complete)drawMedia(ctx,a.thumbImage,c,project,loc.local);
 if(playing){const ss=E.segments(project),i=ss.findIndex(s=>s.clip.id===c.id),next=assets.get(ss[(i+1)%ss.length]?.clip.asset);if(next&&next.id!==a.id&&next.kind!=='demo'){const nv=choosePlayer(next),nc=ss[(i+1)%ss.length].clip;if(nv.readyState>=1&&!nv.seeking&&Math.abs(nv.currentTime-nc.trimIn)>.05)nv.currentTime=nc.trimIn;}}
}
async function initAudio(){if(!audioCtx){const AC=window.AudioContext||window.webkitAudioContext;if(!AC)return;audioCtx=new AC();masterGain=audioCtx.createGain();masterGain.gain.value=1;masterGain.connect(audioCtx.destination);}if(audioCtx.state!=='running')await audioCtx.resume();}
function musicStop(){if(musicNode){try{musicNode.stop();}catch{}musicNode.disconnect();musicNode=null;}if(musicGain){musicGain.disconnect();musicGain=null;}}
function startMusic(offset){musicStop();if(!music?.buffer||!audioCtx)return;const start=project.musicOffset+offset,d=Math.min(total()-offset,music.buffer.duration-start);if(d<=0)return;
 musicNode=audioCtx.createBufferSource();musicNode.buffer=music.buffer;musicGain=audioCtx.createGain();musicGain.gain.value=project.musicVolume;musicNode.connect(musicGain);musicGain.connect(masterGain);musicNode.start(audioCtx.currentTime,start,d);
}
function nowHead(){return audioCtx?.state==='running'?audioCtx.currentTime-audioEpoch:performance.now()/1000-perfEpoch;}
function clickAt(time,beat){if(!audioCtx||!metronome)return;let B=total()/E.secondsPerBeat(project),inLoop=B>0?((beat%B)+B)%B:beat;const down=Math.abs(inLoop%project.meter)<1e-6,quarter=Math.abs(inLoop-Math.round(inLoop))<1e-6;
 const o=audioCtx.createOscillator(),g=audioCtx.createGain();o.type='sine';o.frequency.value=down?1560:quarter?1120:790;
 const vol=down?.13:quarter?.08:.037;g.gain.setValueAtTime(.0001,time);g.gain.exponentialRampToValueAtTime(vol,time+.0015);g.gain.exponentialRampToValueAtTime(.0001,time+.027);o.connect(g);g.connect(masterGain);o.start(time);o.stop(time+.03);clicks.add(o);o.onended=()=>{clicks.delete(o);o.disconnect();g.disconnect();};}
function resetMetronome(position){const dt=E.secondsPerBeat(project)*+$('metroGrid').value,T=total();if(!T){nextClick=0;return;}const steps=Math.ceil(T/dt-1e-8),cycle=Math.floor(position/T);nextClick=cycle*steps+Math.ceil((position-cycle*T)/dt-1e-6);}
function scheduleMetronome(){if(!playing||!audioCtx)return;const grid=+$('metroGrid').value,dt=E.secondsPerBeat(project)*grid,T=total();if(!T)return;const steps=Math.ceil(T/dt-1e-8);
 // Restart the beat grid at each loop boundary, including partial bars in 3/4
 // and 6/4 whose duration is not a whole number of the chosen subdivision.
 while(true){const cycle=Math.floor(nextClick/steps),step=nextClick%steps,position=cycle*T+step*dt,at=audioEpoch+position;if(at>=audioCtx.currentTime+.12||(!loop&&position>=T))break;if(at>=audioCtx.currentTime-.003)clickAt(Math.max(at,audioCtx.currentTime),step*grid);nextClick++;}}
function startPlayback(){
 audioEpoch=(audioCtx?.currentTime||0)-head;perfEpoch=performance.now()/1000-head;playing=true;lastLoop=0;
 resetMetronome(head);startMusic(head);metroTimer=setInterval(scheduleMetronome,25);scheduleMetronome();updateTransport();}
async function play(){if(busy||!project.clips.length)return;if(playing||playPending){pause();return;}const request=++playRequest;playPending=true;
 try{await initAudio();if(request!==playRequest||busy||!project.clips.length||document.querySelector('dialog[open]'))return;if(head>=total()-.0001)head=0;startPlayback();}
 finally{if(request===playRequest)playPending=false;}}
function pause(){playRequest++;playPending=false;if(playing){let n=nowHead();head=loop&&total()?n%total():Math.min(n,total());}playing=false;clearInterval(metroTimer);for(const o of clicks){try{o.stop();}catch{}}clicks.clear();musicStop();players.forEach(v=>v.pause());updateTransport();}
function seek(t){pause();head=E.clamp(t,0,Math.max(0,total()-.000001));drawPreview();updateTransport();}
function skipPreview(amount){if(busy||!project.clips.length||document.querySelector('dialog[open]'))return;const T=total(),resume=playing,position=playing?(loop?nowHead()%T:Math.min(nowHead(),T)):head,next=E.clamp(position+amount,0,T);
 pause();head=next;if(resume&&next<T)startPlayback();drawPreview();updateTransport();miniPlayer?.flash(amount);}
function tick(){if(playing&&!busy){const n=nowHead(),T=total();if(!T){pause();}else if(!loop&&n>=T){pause();head=T;updateTransport();}else{const cycle=Math.floor(n/T);head=n%T;if(cycle!==lastLoop){lastLoop=cycle;startMusic(head);}drawPreview();updateTransport();}}
 requestAnimationFrame(tick);}
async function useBusy(title,fn,{canCancel=true}={}){if(busy)throw Error('Finish the current operation first.');pause();busy=true;cancelled=false;$('busyTitle').textContent=title;$('progressText').textContent='Working on your device…';$('progress').value=0;$('cancelBtn').hidden=!canCancel;$('busyDialog').showModal();
 try{wakeLock=await navigator.wakeLock?.request('screen').catch(()=>null);return await fn();}finally{busy=false;activeOutput=null;try{await wakeLock?.release();}catch{}wakeLock=null;$('busyDialog').close();render();}}
function checkCancel(){if(cancelled)throw new DOMException('Operation cancelled.','AbortError');}
function progress(value,text){$('progress').value=E.clamp(value,0,1);$('progressText').textContent=text;}
async function waitVisible(){while(document.hidden){checkCancel();$('progressText').textContent='Paused while this tab is hidden. Return here to continue.';await sleep(150);}}
async function assetFromFile(file,id=uid()){
 if(!M)throw Error('The embedded media engine did not load. Reopen the complete HTML in Safari or Chrome.');
 const input=new M.Input({source:new M.BlobSource(file),formats:M.ALL_FORMATS});
 try{const track=await input.getPrimaryVideoTrack();if(!track)throw Error(`${file.name}: no video track found.`);
 const first=await track.getFirstTimestamp(),end=await track.computeDuration(),duration=end-first;
 if(!Number.isFinite(duration)||duration<=0)throw Error(`${file.name}: cannot determine a valid video duration.`);
 if(!await track.canDecode())throw Error(`${file.name}: this browser cannot decode its video codec. Try an H.264 MP4 or another browser.`);
 const width=await track.getDisplayWidth(),height=await track.getDisplayHeight();
 const sink=new M.CanvasSink(track,{width:160,poolSize:1});const wrapped=await sink.getCanvas(first+Math.min(.15,duration/4));
 let thumb='';if(wrapped)thumb=wrapped.canvas.toDataURL('image/jpeg',.7);
 const a={id,kind:'video',name:file.name,file,duration,width,height,first,thumb,url:URL.createObjectURL(file)};
 a.thumbImage=new Image();a.thumbImage.src=thumb;return a;
 }catch(error){throw Error(`${file.name}: ${String(error.message||error).replace(file.name+': ','')}`);}finally{input.dispose();}
}
function demoAsset(seed,id=uid()){const a={id,kind:'demo',seed,name:['Orbit study','Quiet current','Afterglow'][seed%3],duration:20,width:540,height:960,first:0};a.thumb=paintDemo(a,.2).toDataURL('image/jpeg',.8);a.thumbImage=new Image();a.thumbImage.src=a.thumb;return a;}
async function addVideos(files){if(!files.length)return;const room=MAX_CLIPS-project.clips.length;if(!room){say('Maximum 20 clips. Remove one to add another.',true);return;}const list=[...files].slice(0,room),rejected=[];
 if(files.length>room)say(`Only the first ${room} videos will be added; the limit is 20 clips.`,true);
 await useBusy('Reading your footage',async()=>{checkpoint();for(let i=0;i<list.length;i++){checkCancel();progress(i/list.length,`Reading ${i+1} of ${list.length}: ${list[i].name}`);
 try{const a=await assetFromFile(list[i]);if(cancelled){URL.revokeObjectURL(a.url);checkCancel();}assets.set(a.id,a);const c=E.makeClip(a.id,uid());c.bars=project.defaultBars;c.trimOut=a.duration;project.clips.push(c);if(!selected)selected=c.id;}catch(e){if(e.name==='AbortError')throw e;rejected.push(e.message);}}
 progress(1,`${list.length-rejected.length} clips added.`);});
 if(rejected.length)say(rejected.join(' '),true);else say('Footage is ready. Press play to feel the timing.',true);
}
function releaseAssets(){players.forEach(v=>{v.pause();v.removeAttribute('src');v.load();delete v._asset;});currentPreview=null;for(const a of assets.values())if(a.url)URL.revokeObjectURL(a.url);assets=new Map();music=null;history=[];future=[];}
function newProject(){if(busy)return;if(dirty&&!confirm('Start a new project? Save a .jae backup first to keep the current edit.'))return;pause();releaseAssets();project=E.defaults();selected=null;head=0;dirty=false;render();say('A fresh rhythm.');}
function loadDemo(){if(busy)return;if(project.clips.length&&!confirm('Replace the current arrangement with the motion demo? Save first to keep your edit.'))return;pause();releaseAssets();project=E.defaults();for(let i=0;i<3;i++){const a=demoAsset(i);assets.set(a.id,a);const c=E.makeClip(a.id,uid());c.trimOut=a.duration;c.preset=['subtle','swoop','punch'][i];Object.assign(c,E.presets[c.preset]);project.clips.push(c);}selected=project.clips[0].id;head=0;dirty=true;render();say('Three procedural clips. Try the metronome and adjust their motion.',true);}
async function decodeMusic(file){if(file.size>80*1048576)throw Error('Choose a soundtrack under 80 MB. This keeps decoded audio manageable on mobile.');await initAudio();if(!audioCtx)throw Error('This browser has no audio decoding support.');const buffer=await audioCtx.decodeAudioData(await file.arrayBuffer());if(buffer.duration>300)throw Error('Choose a soundtrack no longer than five minutes. Trim the audio first.');return {id:uid(),name:file.name,file,buffer};}
async function addMusic(file){await useBusy('Reading soundtrack',async()=>{const m=await decodeMusic(file);checkCancel();music=m;project.musicOffset=0;dirty=true;});say('Soundtrack loaded. Its speed stays unchanged while the footage ramps.',true);}
function portableBlob(){
 if(!project.clips.length)throw Error('Add at least one clip before saving a portable project.');
 const p=structuredClone(project),used=[...new Set(p.clips.map(c=>c.asset))],entries=[],chunks=[];let offset=0;
 for(const id of used){const a=assets.get(id);if(!a)throw Error('A source file is missing.');const e={id:a.id,kind:a.kind,name:a.name,duration:a.duration,width:a.width,height:a.height,seed:a.seed};if(a.kind==='video'){e.offset=offset;e.size=a.file.size;e.type=a.file.type;e.lastModified=a.file.lastModified;chunks.push(a.file);offset+=a.file.size;}entries.push(e);}
 let audio=null;if(music){audio={name:music.name,offset,size:music.file.size,type:music.file.type,lastModified:music.file.lastModified};chunks.push(music.file);offset+=music.file.size;}
 const manifest={format:'JustAnimateEverything',version:1,created:new Date().toISOString(),project:p,assets:entries,music:audio};
 const json=new TextEncoder().encode(JSON.stringify(manifest));if(json.byteLength>16*1048576)throw Error('Project manifest is too large.');const header=new Uint8Array(12);header.set(new TextEncoder().encode('JAEproj1'));new DataView(header.buffer).setUint32(8,json.byteLength,true);
 return new Blob([header,json,...chunks],{type:'application/octet-stream'});
}
async function openPortable(file){
 await useBusy('Opening your project',async()=>{const header=await file.slice(0,12).arrayBuffer();if(header.byteLength!==12||new TextDecoder().decode(new Uint8Array(header,0,8))!=='JAEproj1')throw Error('This is not a supported .jae project.');
 const len=new DataView(header).getUint32(8,true);if(len>16*1048576||len<2||12+len>file.size)throw Error('The project header is incomplete or invalid.');
 const m=JSON.parse(await file.slice(12,12+len).text()),start=12+len;
 if(m.format!=='JustAnimateEverything'||m.version!==1||!Array.isArray(m.assets)||!Array.isArray(m.project?.clips)||m.project.clips.length<1||m.project.clips.length>20||m.assets.length>20)throw Error('Unsupported project version or clip count.');
 const p=E.normalizeProject(m.project),staged=new Map();let stagedMusic=null;
 function getFile(entry){const o=entry.offset,n=entry.size;if(!Number.isSafeInteger(o)||!Number.isSafeInteger(n)||o<0||n<1||start+o+n>file.size)throw Error('A media entry is truncated or corrupt.');return new File([file.slice(start+o,start+o+n)],String(entry.name||'source.mp4').slice(0,200),{type:String(entry.type||''),lastModified:E.number(entry.lastModified,0)});}
 try{for(let i=0;i<m.assets.length;i++){checkCancel();const e=m.assets[i];if(typeof e.id!=='string'||staged.has(e.id))throw Error('Invalid or duplicate source ID.');progress(i/(m.assets.length+1),`Reopening ${e.name}`);let a;
 if(e.kind==='video')a=await assetFromFile(getFile(e),e.id);else if(e.kind==='demo')a=demoAsset(Math.round(E.number(e.seed,0,0,2)),e.id);else throw Error('Unsupported source type.');staged.set(e.id,a);}
 const ids=new Set();p.clips=p.clips.map(c=>{const a=staged.get(c.asset);if(!a||typeof c.id!=='string'||ids.has(c.id))throw Error('Invalid clip reference.');ids.add(c.id);return E.normalizeClip(c,a.duration);});
 if(m.music){progress(.95,'Reopening soundtrack…');stagedMusic=await decodeMusic(getFile(m.music));}checkCancel();
 releaseAssets();assets=staged;music=stagedMusic;project=p;selected=p.clips[0].id;head=0;dirty=false;progress(1,'Project ready.');
 }catch(e){for(const a of staged.values())if(a.url)URL.revokeObjectURL(a.url);throw e;}});
 say('Project reopened with its original media and motion settings.',true);
}
function addDownload(blob,name,temp=null){const url=URL.createObjectURL(blob),id=uid(),row=document.createElement('div');row.className='download-row';row.innerHTML=`<div class="download-text">${esc(name)}<small>${bytes(blob.size)} · stays on this device</small></div>`;
 const a=document.createElement('a');a.href=url;a.download=name;a.textContent='Download';row.append(a);
 const share=document.createElement('button');share.className='quiet small';share.textContent='Share / Save';const file=new File([blob],name,{type:blob.type||'application/octet-stream'});
 if(navigator.canShare?.({files:[file]})){share.addEventListener('click',async()=>{try{await navigator.share({files:[file],title:name});}catch(e){if(e.name!=='AbortError')fail(e);}});row.append(share);}
 $('downloadList').append(row);$('downloads').hidden=false;downloadItems.push({id,url,blob,name,temp,row});return {url,a,blob,name};}
async function clearDownloads(){for(const item of downloadItems){URL.revokeObjectURL(item.url);if(item.temp){try{await item.temp.root.removeEntry(item.temp.name);}catch{}}item.row.remove();}downloadItems.length=0;$('downloads').hidden=true;}
async function saveProject(){const blob=portableBlob(),name=safeName(project.name)+'.jae';$('saveDialog').close();
 if(window.showSaveFilePicker){let handle;try{handle=await showSaveFilePicker({suggestedName:name,types:[{description:'JAE project',accept:{'application/octet-stream':['.jae']}}]});}catch(e){if(e.name==='AbortError')return;throw e;}
 await useBusy('Saving your complete project',async()=>{const writer=await handle.createWritable();try{const reader=blob.stream().getReader();let n=0;while(true){checkCancel();const {done,value}=await reader.read();if(done)break;await writer.write(value);n+=value.byteLength;progress(n/blob.size,`${bytes(n)} / ${bytes(blob.size)}`);}await writer.close();}catch(e){await writer.abort().catch(()=>{});throw e;}});
 }else{const d=addDownload(blob,name);d.a.click();}
 dirty=false;say('Project file prepared. Keep the downloaded .jae file as your backup.',true);
}
async function db(){return new Promise((resolve,reject)=>{const r=indexedDB.open('just-animate-everything',1);r.onupgradeneeded=()=>r.result.createObjectStore('recovery');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
async function recovery(save){if(!indexedDB)throw Error('This browser does not provide local project storage.');if(save){const blob=portableBlob();$('saveDialog').close();await useBusy('Saving local recovery',async()=>{await navigator.storage?.persist?.().catch(()=>false);const estimate=await navigator.storage?.estimate?.();if(estimate?.quota&&blob.size>estimate.quota-estimate.usage)throw Error('Not enough browser storage. Download a portable project instead.');const database=await db();try{await new Promise((resolve,reject)=>{const tx=database.transaction('recovery','readwrite');tx.objectStore('recovery').put(blob,'last');tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||Error('Recovery storage failed.'));});}finally{database.close();}}, {canCancel:false});say('Recovery copy saved on this device. Download a .jae file for a permanent backup.',true);
 }else{const database=await db();let blob;try{blob=await new Promise((resolve,reject)=>{const r=database.transaction('recovery').objectStore('recovery').get('last');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}finally{database.close();}if(!blob)throw Error('No recovery copy has been saved in this browser.');if(dirty&&!confirm('Replace this edit with the saved recovery copy?'))return;$('saveDialog').close();await openPortable(blob);}}
function bitrate(p){const d=E.dimensions(p),q={standard:.075,high:.16,max:.24}[p.quality];return Math.round(E.clamp(d.width*d.height*p.fps*q,2000000,100000000));}
function syncExportUI(){for(const id of ['resolution','aspect','fps','quality','format'])$(id).value=project[id];$('exportLoops').disabled=$('exportScope').value!=='all';}
function exportPlan(p=project){const scope=$('exportScope').value,repeats=scope==='all'?Math.round(E.number($('exportLoops').value,1,1,16)):1;
 const clip=selectedClip();if(scope==='selected'&&!clip)return [];
 return scope==='each'?p.clips.map((c,i)=>({clips:[c],repeats:1,musicStart:clipStart(c.id),name:`${safeName(p.name)}-${String(i+1).padStart(2,'0')}-${safeName(assets.get(c.asset)?.name)}`})):
 [{clips:scope==='selected'?[clip]:p.clips,repeats,musicStart:scope==='selected'?clipStart(clip.id):0,name:scope==='selected'?`${safeName(p.name)}-${safeName(assets.get(clip.asset)?.name)}`:safeName(p.name),whole:scope==='all'}];}
async function checkSupport(){const version=++checkVersion;capabilityOK=false;$('startExport').disabled=true;$('supportStatus').textContent='Checking the exact resolution, frame rate, and codec…';$('supportStatus').classList.remove('error');
 const p=structuredClone(project),d=E.dimensions(p),[container,codec]=p.format.split('-'),jobs=exportPlan(p),dur=jobs.reduce((s,j)=>s+E.frameGroups(p,j.clips,j.repeats).total,0);
 $('exportSummary').textContent=`${d.width} × ${d.height} · ${p.fps} fps · ${jobs.length} file${jobs.length!==1?'s':''} · ${fmt(dur)}s · approximately ${bytes(dur*bitrate(p)/8)}. Repeats apply only to whole-arrangement export.`;
 try{if(!M||!window.VideoEncoder)throw Error('Frame-accurate export needs WebCodecs VideoEncoder. Open this page in a supported full browser.');
 const options={...d,frameRate:p.fps,quality:new M.Quality({bitrate:bitrate(p)})};
 if(!await M.canEncodeVideo(codec,options))throw Error(`${d.width} × ${d.height} at ${p.fps} fps with ${codec.toUpperCase()} is not supported by this device. Select another format or resolution; nothing is automatically downgraded.`);
 if(music&&$('includeMusic').checked){const ac=container==='webm'?'opus':'aac';if(!await M.canEncodeAudio(ac,{numberOfChannels:2,sampleRate:48000,quality:new M.Quality({bitrate:192000})}))throw Error(`Video is supported, but ${ac.toUpperCase()} soundtrack encoding is not. Choose WebM or turn off the soundtrack.`);}
 if(version!==checkVersion)return;capabilityOK=true;$('supportStatus').textContent=`Encoder available · ${d.width} × ${d.height} / ${p.fps} fps / ${codec.toUpperCase()}. A successful check does not guarantee enough memory for every source.`;$('startExport').disabled=!project.clips.length;
 }catch(e){if(version!==checkVersion)return;$('supportStatus').classList.add('error');$('supportStatus').textContent=e.message;}
}
function openExport(scope='all'){if(!project.clips.length){say('Add at least one clip first.',true);return;}pause();$('exportScope').value=scope;syncExportUI();$('exportDialog').showModal();checkSupport();}
async function makeTarget(estimated){let temp=null;
 if(navigator.storage?.getDirectory){let root,name,handle;try{root=await navigator.storage.getDirectory();const e=await navigator.storage.estimate();if(e.quota&&estimated*1.2>e.quota-e.usage)throw new DOMException('Not enough browser storage for this export. Clear old downloads or export individual clips.','QuotaExceededError');name='jae-export-'+uid();handle=await root.getFileHandle(name,{create:true});const writable=await handle.createWritable();temp={root,name,handle};return {target:new M.StreamTarget(writable,{chunked:true,chunkSize:1048576}),temp};}catch(e){if(root&&name)await root.removeEntry(name).catch(()=>{});if(e.name==='QuotaExceededError')throw e;}}
 if(estimated>192*1048576)throw Error('This browser cannot stream exports to temporary storage. This render is too large for the safe memory fallback. Export separate clips or lower the output resolution.');
 return {target:new M.BufferTarget(),temp};
}
async function renderJob(p,job,ordinal,count){const plan=E.frameGroups(p,job.clips,job.repeats),d=E.dimensions(p),[container,codec]=p.format.split('-');if(!plan.count)throw Error('There are no frames to render.');
 const format=container==='mp4'?new M.Mp4OutputFormat({fastStart:false}):container==='mov'?new M.MovOutputFormat({fastStart:false}):new M.WebMOutputFormat();
 const storage=await makeTarget(plan.total*(bitrate(p)+(music&&$('includeMusic').checked?192000:0))/8),output=new M.Output({format,target:storage.target});activeOutput=output;
 const canvas=document.createElement('canvas');canvas.width=d.width;canvas.height=d.height;let input=null,iterator=null,done=false,lastWrapped=null;
 try{const ctx=canvas.getContext('2d',{alpha:false});if(!ctx)throw Error('The device could not allocate the output canvas. Try a smaller resolution.');
 const video=new M.CanvasSource(canvas,{codec,quality:new M.Quality({bitrate:bitrate(p)}),keyFrameInterval:2});output.addVideoTrack(video,{frameRate:p.fps});
 let audioSource=null,audioFrame=0;const sr=48000,audioEnd=Math.round(plan.total*sr),withMusic=music&&$('includeMusic').checked;
 if(withMusic){audioSource=new M.AudioSampleSource({codec:container==='webm'?'opus':'aac',quality:new M.Quality({bitrate:192000})});output.addAudioTrack(audioSource);}
 const mb=withMusic?music.buffer:null,channels=mb?Array.from({length:Math.min(2,mb.numberOfChannels)},(_,i)=>mb.getChannelData(i)):[];
 async function writeAudio(until){if(!audioSource)return;const goal=Math.min(audioEnd,Math.ceil(until*sr));while(audioFrame<goal){const n=Math.min(2048,audioEnd-audioFrame),data=new Float32Array(n*2);
 for(let i=0;i<n;i++){let time=(audioFrame+i)/sr,pt=job.whole?time%total():job.musicStart+time,st=(p.musicOffset+pt)*mb.sampleRate,si=Math.floor(st),f=st-si;
 if(si>=0&&si<mb.length){const fade=Math.min(1,time/.003,(plan.total-time)/.003)*p.musicVolume;for(let ch=0;ch<2;ch++){const a=channels[Math.min(ch,channels.length-1)],v=a[si]||0;data[2*i+ch]=(v+((a[Math.min(si+1,a.length-1)]||0)-v)*f)*fade;}}}
 const sample=new M.AudioSample({format:'f32',sampleRate:sr,numberOfChannels:2,timestamp:audioFrame/sr,data});try{await audioSource.add(sample);}finally{sample.close();}audioFrame+=n;}}
 await output.start();let rendered=0,startTime=performance.now();
 for(const group of plan.groups){checkCancel();const c=group.clip,a=assets.get(c.asset);if(!a)throw Error('An original clip is missing.');
 if(a.kind!=='demo'){input=new M.Input({source:new M.BlobSource(a.file),formats:M.ALL_FORMATS});const track=await input.getPrimaryVideoTrack();if(!track||!await track.canDecode())throw Error(`${a.name}: decoding unavailable.`);const first=await track.getFirstTimestamp();const sink=new M.CanvasSink(track,{poolSize:1});
 iterator=sink.canvasesAtTimestamps((function*(){for(let k=group.first;k<group.last;k++)yield first+E.motion(c,p,k/p.fps-group.start).time;})());}
 try{for(let k=group.first;k<group.last;k++){checkCancel();await waitVisible();const t=k/p.fps,local=t-group.start,dt=Math.min(1/p.fps,plan.total-t);let image;
 if(a.kind==='demo')image=paintDemo(a,E.motion(c,p,local).time);else{const item=await iterator.next();if(item.done||!item.value)throw Error(`${a.name}: a requested source frame could not be decoded.`);lastWrapped=item.value;image=item.value.canvas;}
 drawMedia(ctx,image,c,p,local);await writeAudio(Math.min(plan.total,t+dt));await video.add(t,dt,{keyFrame:k===group.first||k%(p.fps*2)===0});rendered++;
 if(rendered%4===0||rendered===plan.count){const elapsed=(performance.now()-startTime)/1000,remaining=rendered?elapsed*(plan.count-rendered)/rendered:0;progress((ordinal+rendered/plan.count)/count,`File ${ordinal+1}/${count} · frame ${rendered}/${plan.count} · ${fmt(rendered/plan.count*100,0)}% · ~${fmt(remaining,0)}s remaining`);await sleep(0);}}
 }finally{if(iterator){await iterator.return().catch(()=>{});iterator=null;}if(input){input.dispose();input=null;}if(lastWrapped){lastWrapped.canvas.width=1;lastWrapped.canvas.height=1;lastWrapped=null;}}}
 await writeAudio(plan.total);video.close();audioSource?.close();checkCancel();progress((ordinal+.99)/count,`Finalizing file ${ordinal+1} of ${count}…`);await output.finalize();
 const blob=storage.temp?new Blob([await storage.temp.handle.getFile()],{type:format.mimeType}):new Blob([storage.target.buffer],{type:format.mimeType});checkCancel();const result=addDownload(blob,job.name+format.fileExtension,storage.temp);done=true;return result;
 }finally{if(iterator)await iterator.return().catch(()=>{});input?.dispose();if(!done){await output.cancel().catch(()=>{});if(storage.temp)await storage.temp.root.removeEntry(storage.temp.name).catch(()=>{});}canvas.width=1;canvas.height=1;activeOutput=null;}
}
async function startExport(){await checkSupport();if(!capabilityOK)return;const p=structuredClone(project),jobs=exportPlan(p);$('exportDialog').close();let complete=0;
 try{await useBusy('Rendering your movement',async()=>{for(let i=0;i<jobs.length;i++){checkCancel();const result=await renderJob(p,jobs[i],i,jobs.length);complete++;if(jobs.length===1)result.a.click();}progress(1,'Your rendered files are ready.');});
 say(`${complete} rendered file${complete===1?' is':'s are'} ready in “Ready to keep”.`,true);$('downloads').scrollIntoView({behavior:'smooth',block:'nearest'});
 }catch(e){if(cancelled||e.name==='AbortError')say(`Export cancelled. ${complete?`${complete} completed file(s) remain available.`:'Your project is unchanged.'}`,true);else fail(e);}}
// Keep touch recognition separate from media state so a scroll or drag never
// becomes a seek. These are the same double-tap thresholds used by JAA.
function previewTapGestures({rectangle,onSkip,enabled,now=()=>performance.now()}){let pointer=null,tap=null;
 const reset=()=>{pointer=null;tap=null;};
 return {reset,down(e){if(!enabled()||!e.isPrimary||e.button!==0||e.altKey){reset();return;}pointer={id:e.pointerId,x:e.clientX,y:e.clientY};},
 up(e){if(!enabled()||e.altKey||!pointer||pointer.id!==e.pointerId||Math.hypot(e.clientX-pointer.x,e.clientY-pointer.y)>16){reset();return;}pointer=null;
 const rect=rectangle(),side=e.clientX<rect.left+rect.width/2?-1:1,time=now();
 if(tap&&time-tap.time<350&&tap.side===side&&Math.hypot(e.clientX-tap.x,e.clientY-tap.y)<55){tap=null;e.preventDefault();onSkip(side*5);}else tap={time,side,x:e.clientX,y:e.clientY};}};
}
function floatingPreviewBounds(box,viewport,aspect){const chrome=80,maxWidth=Math.max(80,Math.min(viewport.width-24,(viewport.height-24-chrome)*aspect,640)),minWidth=Math.min(180,maxWidth),width=E.clamp(box.width,minWidth,maxWidth),height=width/aspect+chrome;
 return {width,x:E.clamp(box.x,viewport.left+12,Math.max(viewport.left+12,viewport.left+viewport.width-width-12)),y:E.clamp(box.y,viewport.top+12,Math.max(viewport.top+12,viewport.top+viewport.height-height-12))};
}
function createMiniPlayer(){const stage=$('stage'),frame=$('frame'),canvas=$('preview'),toggle=$('focusBtn');
 const shell=document.createElement('div');shell.className='jae-preview-shell';shell.id='miniPlayer';stage.insertBefore(shell,frame);
 const button=(id,text,label,action)=>{const b=document.createElement('button');b.type='button';b.id=id;b.className='quiet small';b.textContent=text;b.title=label;b.setAttribute('aria-label',label);b.addEventListener('click',action);b.addEventListener('keydown',e=>{if(e.key===' ')e.stopPropagation();});return b;};
 const bar=document.createElement('div');bar.className='jae-float-bar';
 const grip=button('miniMove','⠿ Preview','Move preview. Drag, or use the arrow keys.',()=>{});grip.className='jae-float-grip quiet small';
 const returnButton=button('miniReturn','↗','Return to the full preview',()=>{manual=false;dismissed=true;setFloating(false);stage.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'center'});});
 const closeButton=button('miniClose','×','Hide the mini player until you return to the preview',()=>{manual=false;dismissed=true;setFloating(false);});bar.append(grip,returnButton,closeButton);
 const controls=document.createElement('div');controls.className='jae-float-controls';
 const back=button('miniBack','↶ 5s','Back 5 seconds',()=>skipPreview(-5)),playButton=button('miniPlay','▶','Play preview',()=>play().catch(fail)),forward=button('miniForward','5s ↷','Forward 5 seconds',()=>skipPreview(5));
 const clock=document.createElement('span');clock.className='jae-float-clock';controls.append(back,playButton,forward,clock);
 const resize=button('miniResize','◢','Resize preview. Drag, or use the arrow keys.',()=>{});resize.className='jae-float-resize quiet';shell.append(bar,frame,controls,resize);
 const glow=document.createElement('div');glow.className='jae-skip-flash';glow.setAttribute('aria-hidden','true');frame.append(glow);
 const announcement=document.createElement('span');announcement.className='jae-screen-reader';announcement.setAttribute('role','status');announcement.setAttribute('aria-live','polite');shell.append(announcement);
 const placeholder=document.createElement('span');placeholder.className='jae-float-placeholder';placeholder.textContent='Preview is floating while you edit';placeholder.hidden=true;stage.append(placeholder);
 let floating=false,manual=false,sawStageAway=false,dismissed=false,queued=false,placed=false,gesture=null,flashTimer=0,box={x:0,y:0,width:280};
 const blocked=()=>busy||!project.clips.length||!!document.querySelector('dialog[open]');
 const viewport=()=>({width:window.visualViewport?.width||innerWidth,height:window.visualViewport?.height||innerHeight,left:window.visualViewport?.offsetLeft||0,top:window.visualViewport?.offsetTop||0});
 const aspect=()=>canvas.width/canvas.height||9/16;
 function bounds(){box=floatingPreviewBounds(box,viewport(),aspect());shell.style.left=box.x+'px';shell.style.top=box.y+'px';shell.style.width=box.width+'px';shell.classList.toggle('is-compact',box.width<210);shell.classList.toggle('is-tiny',box.width<150);}
 function keepStageSize(){const css=getComputedStyle(stage),paddingY=parseFloat(css.paddingTop)+parseFloat(css.paddingBottom),paddingX=parseFloat(css.paddingLeft)+parseFloat(css.paddingRight),width=Math.min(parseFloat(frame.style.width)||258,Math.max(1,stage.clientWidth-paddingX));stage.style.height=Math.max(parseFloat(css.minHeight)||0,width/aspect()+paddingY)+'px';}
 function setFloating(value){if(value===floating)return;gesture=null;const hadFocus=shell.contains(document.activeElement);
  if(value){stage.style.height=stage.getBoundingClientRect().height+'px';placeholder.hidden=false;document.body.append(shell);shell.classList.add('is-floating');floating=true;
   if(!placed){const v=viewport();box.width=Math.min(280,v.width*.62);box.x=v.left+v.width-box.width-16;box.y=v.top+v.height-box.width/aspect()-96;placed=true;}bounds();
  }else{floating=false;shell.classList.remove('is-floating');for(const property of ['left','top','width'])shell.style.removeProperty(property);stage.insertBefore(shell,placeholder);stage.style.removeProperty('height');placeholder.hidden=true;if(hadFocus)canvas.focus({preventScroll:true});}
  toggle.setAttribute('aria-pressed',String(floating));toggle.title=floating?'Return preview to the page':'Pop out preview';toggle.setAttribute('aria-label',toggle.title);draw();
 }
 function checkFloating(){queued=false;const past=stage.getBoundingClientRect().bottom<=8;
  if(!past)dismissed=false;if(manual&&past)sawStageAway=true;else if(manual&&sawStageAway&&!past){manual=false;sawStageAway=false;}
  if(!project.clips.length){manual=false;dismissed=false;placed=false;}
  setFloating(!blocked()&&(manual||past&&!dismissed));
 }
 function schedule(){if(!queued){queued=true;requestAnimationFrame(checkFloating);}}
 function popOut(){if(blocked())return;if(floating){manual=false;dismissed=true;setFloating(false);}else{manual=true;sawStageAway=stage.getBoundingClientRect().bottom<=8;dismissed=false;setFloating(true);canvas.focus({preventScroll:true});}}
 function flash(amount){glow.textContent=(amount<0?'−':'+')+Math.abs(amount)+'s';glow.dataset.side=amount<0?'left':'right';glow.classList.remove('is-visible');void glow.offsetWidth;glow.classList.add('is-visible');clearTimeout(flashTimer);flashTimer=setTimeout(()=>glow.classList.remove('is-visible'),750);announcement.textContent=(amount<0?'Back ':'Forward ')+Math.abs(amount)+' seconds';}
 const taps=previewTapGestures({rectangle:()=>frame.getBoundingClientRect(),enabled:()=>!blocked(),onSkip:skipPreview});
 frame.addEventListener('pointerdown',taps.down);frame.addEventListener('pointerup',taps.up);frame.addEventListener('pointercancel',taps.reset);
 canvas.addEventListener('keydown',e=>{if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();e.stopPropagation();skipPreview(e.key==='ArrowLeft'?-5:5);}else if(e.key===' '){e.preventDefault();e.stopPropagation();if(!blocked())play().catch(fail);}});
 for(const [element,kind] of [[grip,'move'],[resize,'resize']]){
  element.addEventListener('pointerdown',e=>{if(!floating||blocked()||e.button!==0||!e.isPrimary)return;e.preventDefault();e.stopPropagation();gesture={kind,id:e.pointerId,x:e.clientX,y:e.clientY,box:{...box}};element.setPointerCapture(e.pointerId);});
  element.addEventListener('pointermove',e=>{if(!gesture||gesture.id!==e.pointerId)return;const dx=e.clientX-gesture.x,dy=e.clientY-gesture.y;if(kind==='move'){box.x=gesture.box.x+dx;box.y=gesture.box.y+dy;}else box.width=gesture.box.width+(Math.abs(dx)>Math.abs(dy)?dx:dy*aspect());bounds();});
  const end=()=>{gesture=null;};for(const event of ['pointerup','pointercancel','lostpointercapture'])element.addEventListener(event,end);
  element.addEventListener('keydown',e=>{if(!floating||blocked()||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();e.stopPropagation();const amount=e.shiftKey?40:10;if(kind==='resize')box.width+=e.key==='ArrowLeft'||e.key==='ArrowUp'?-amount:amount;else if(e.key==='ArrowLeft'||e.key==='ArrowRight')box.x+=e.key==='ArrowLeft'?-amount:amount;else box.y+=e.key==='ArrowUp'?-amount:amount;bounds();});
 }
 function draw(){clock.textContent=$('clock').textContent.replace(/\.\d+$/,'');const disabled=blocked();for(const control of [toggle,back,playButton,forward])control.disabled=disabled;playButton.textContent=playing?'Ⅱ':'▶';playButton.title=playing?'Pause preview':'Play preview';playButton.setAttribute('aria-label',playButton.title);}
 function sync(){shell.style.setProperty('--jae-inline-width',frame.style.width||'258px');if(floating){keepStageSize();bounds();}draw();schedule();}
 window.addEventListener('scroll',schedule,{passive:true});const resized=()=>{if(floating){keepStageSize();bounds();}schedule();};window.addEventListener('resize',resized,{passive:true});window.visualViewport?.addEventListener('resize',resized,{passive:true});window.visualViewport?.addEventListener('scroll',resized,{passive:true});
 if(typeof MutationObserver!=='undefined'){const observer=new MutationObserver(()=>{taps.reset();checkFloating();draw();});for(const dialog of document.querySelectorAll('dialog'))observer.observe(dialog,{attributes:true,attributeFilter:['open']});}
 return {draw,sync,flash,popOut};
}
// All DOM events are registered after the embedded runtime and engine are ready.
listen('addBtn','click',()=>$('videoInput').click());listen('emptyAdd','click',()=>$('videoInput').click());
listen('videoInput','change',async e=>{const files=[...e.target.files];e.target.value='';await addVideos(files);});
listen('openBtn','click',()=>{if(!busy)$('projectInput').click();});
listen('projectInput','change',async e=>{const f=e.target.files[0];e.target.value='';if(f&&(!dirty||confirm('Replace the current project? Save first to keep this edit.')))await openPortable(f);});
listen('saveBtn','click',()=>{pause();$('projectSize').textContent=project.clips.length?`Approximately ${bytes(portableBlob().size)} · original media included`:'No open project. Restore a saved recovery copy below.';$('saveDialog').showModal();});
listen('downloadProjectBtn','click',saveProject);listen('localSaveBtn','click',()=>recovery(true));listen('localOpenBtn','click',()=>recovery(false));
listen('exportBtn','click',()=>openExport());listen('specBtn','click',()=>{if(project.clips.length)openExport();else{$('exportScope').value='all';syncExportUI();$('exportDialog').showModal();checkSupport();}});
listen('exportClipBtn','click',()=>openExport('selected'));listen('startExport','click',startExport);
for(const id of ['helpBtn','aboutBtn'])listen(id,'click',()=>$('helpDialog').showModal());
for(const b of document.querySelectorAll('[data-close]'))b.addEventListener('click',()=>$(b.dataset.close).close());
$('busyDialog').addEventListener('cancel',e=>{e.preventDefault();});
listen('cancelBtn','click',()=>{cancelled=true;$('progressText').textContent='Stopping safely…';activeOutput?.cancel().catch(()=>{});});
listen('newBtn','click',newProject);listen('demoBtn','click',loadDemo);listen('playBtn','click',play);
listen('loopBtn','click',()=>{pause();loop=!loop;$('loopBtn').setAttribute('aria-pressed',String(loop));});
listen('metroBtn','click',async()=>{await initAudio();metronome=!metronome;$('metroBtn').setAttribute('aria-pressed',String(metronome));if(!metronome){for(const o of clicks){try{o.stop();}catch{}}clicks.clear();}});
listen('metroGrid','change',()=>{if(playing){for(const o of clicks){try{o.stop();}catch{}}clicks.clear();resetMetronome(nowHead());scheduleMetronome();}});
listen('backBtn','click',()=>{const ss=E.segments(project),i=ss.findIndex(s=>head<s.end-.00001);seek(ss[Math.max(0,i-1)]?.start||0);});
listen('forwardBtn','click',()=>{const ss=E.segments(project),i=ss.findIndex(s=>head<s.end-.00001);seek(ss[(i+1)%ss.length]?.start||0);});
listen('scrubber','input',e=>seek(+e.target.value));listen('focusBtn','click',()=>miniPlayer?.popOut());
for(const id of ['projectName','bpm','meter','defaultBars'])listen(id,'change',e=>{commit(()=>project[id==='projectName'?'name':id]=id==='projectName'?e.target.value:+e.target.value);});
listen('equalBtn','click',()=>commit(()=>{project.clips.forEach(c=>c.bars=project.defaultBars);head=0;}));
let taps=[];listen('tapBtn','click',()=>{const now=performance.now();if(taps.length&&now-taps.at(-1)>2000)taps=[];taps.push(now);if(taps.length>8)taps.shift();if(taps.length>=3){const bpm=60e3/((taps.at(-1)-taps[0])/(taps.length-1));commit(()=>project.bpm=Math.round(E.clamp(bpm,30,300)*10)/10);say(`Tap tempo: ${project.bpm} BPM.`);}else say(`Tap ${3-taps.length} more time${3-taps.length===1?'':'s'}.`);});
listen('undoBtn','click',undo);listen('redoBtn','click',redo);listen('moveLeftBtn','click',()=>moveClip(-1));listen('moveRightBtn','click',()=>moveClip(1));listen('duplicateBtn','click',duplicateClip);listen('deleteBtn','click',removeClip);
listen('shuffleBtn','click',()=>commit(()=>{for(let i=project.clips.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[project.clips[i],project.clips[j]]=[project.clips[j],project.clips[i]];}head=0;}));
listen('timelineZoom','input',renderTimeline);
for(const id of ['clipList','timelineClips']){const el=$(id);el.addEventListener('click',e=>{const b=e.target.closest('[data-id]');if(b&&!busy)selectClip(b.dataset.id);});el.addEventListener('dragstart',e=>{const b=e.target.closest('[data-id]');if(b){e.dataTransfer.setData('application/x-jae-clip',b.dataset.id);e.dataTransfer.effectAllowed='move';}});el.addEventListener('dragover',e=>{if(e.dataTransfer.types.includes('application/x-jae-clip'))e.preventDefault();});el.addEventListener('drop',e=>{const id=e.dataTransfer.getData('application/x-jae-clip'),b=e.target.closest('[data-id]');if(id&&b){e.preventDefault();reorder(id,b.dataset.id);}});}
for(const el of [$('addBtn'),$('stage')]){el.addEventListener('dragover',e=>{if(e.dataTransfer.types.includes('Files')){e.preventDefault();el.classList.add('dragging');}});el.addEventListener('dragleave',()=>el.classList.remove('dragging'));el.addEventListener('drop',e=>{el.classList.remove('dragging');if(e.dataTransfer.files.length){e.preventDefault();addVideos([...e.dataTransfer.files]).catch(fail);}});}
$('ruler').addEventListener('pointerdown',e=>{if(busy)return;const rect=$('ruler').getBoundingClientRect(),b=(e.clientX-rect.left)/+$('timelineZoom').value*project.meter;seek(b*E.secondsPerBeat(project));});
for(const el of document.querySelectorAll('[data-clip]')){
 const set=()=>{const c=selectedClip();if(!c)return;const key=el.dataset.clip;c[key]=el.type==='checkbox'?el.checked:el.type==='range'||el.type==='number'?+el.value:el.value;c.preset='';const normalized=E.normalizeClip(c,assets.get(c.asset).duration);Object.assign(c,normalized);dirty=true;};
 if(el.type==='range'){el.addEventListener('input',()=>{if(!sliderBefore){pause();sliderBefore=snapshot();}set();updateInspectorReadouts();drawPreview();});el.addEventListener('change',()=>{if(sliderBefore){checkpoint(sliderBefore);sliderBefore=null;}render();});}
 else el.addEventListener('change',()=>{commit(set);});
}
for(const b of document.querySelectorAll('[data-preset]'))b.addEventListener('click',()=>{const c=selectedClip();if(c)commit(()=>{Object.assign(c,E.presets[b.dataset.preset]);c.preset=b.dataset.preset;});});
listen('momentBtn','click',()=>{const c=selectedClip();if(!c)return;commit(()=>{const a=assets.get(c.asset),need=E.motion(c,project,0).needed;c.trimIn=Math.random()*Math.max(0,a.duration-need);c.trimOut=a.duration;head=clipStart(c.id);});});
listen('applyMotionBtn','click',()=>{const c=selectedClip();if(!c)return;commit(()=>{const keys=['onset','attack','release','base','peak','slow','zoom','returnZoom','ramp','preset'];for(const o of project.clips)for(const k of keys)o[k]=c[k];});say('Motion copied to all clips. Trims, lengths, and framing were kept.',true);});
$('preview').addEventListener('click',e=>{const c=selectedClip();if(!e.altKey||!c||busy||document.querySelector('dialog[open]'))return;const r=$('preview').getBoundingClientRect();commit(()=>{c.fx=E.clamp((e.clientX-r.left)/r.width,0,1);c.fy=E.clamp((e.clientY-r.top)/r.height,0,1);head=clipStart(c.id);});$('focalMarker').style.left=(c.fx*100)+'%';$('focalMarker').style.top=(c.fy*100)+'%';$('focalMarker').hidden=false;setTimeout(()=>$('focalMarker').hidden=true,900);});
listen('musicBtn','click',()=>$('musicInput').click());listen('musicInput','change',async e=>{const f=e.target.files[0];e.target.value='';if(f)await addMusic(f);});
listen('removeMusicBtn','click',()=>{pause();music=null;dirty=true;render();});
for(const id of ['musicOffset','musicVolume'])listen(id,'change',e=>commit(()=>project[id]=+e.target.value));
for(const id of ['resolution','aspect','fps','quality','format'])listen(id,'change',e=>{commit(()=>project[id]=['resolution','fps'].includes(id)?+e.target.value:e.target.value);checkSupport();});
for(const id of ['exportScope','exportLoops','includeMusic'])listen(id,'change',()=>{syncExportUI();checkSupport();});
listen('clearDownloads','click',clearDownloads);
window.addEventListener('keydown',e=>{if(busy||document.querySelector('dialog[open]')||/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)||e.target.isContentEditable||!e.ctrlKey&&!e.metaKey&&e.target.closest('button,a,summary'))return;
 if((e.ctrlKey||e.metaKey)&&e.code==='KeyZ'){e.preventDefault();e.shiftKey?redo():undo();}
 else if(e.code==='Space'){e.preventDefault();play().catch(fail);}else if(e.code==='ArrowLeft'){e.preventDefault();seek(head-1/project.fps);}else if(e.code==='ArrowRight'){e.preventDefault();seek(head+1/project.fps);}});
window.addEventListener('resize',()=>{if(!busy)render();});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&playing){pause();say('Preview paused while the page was hidden.');}});
window.addEventListener('beforeunload',e=>{if(dirty||busy){e.preventDefault();e.returnValue='';}});
// Deliberately small diagnostic API for deterministic automated tests and future development.
window.JAE={get project(){return project;},get assets(){return assets;},get downloads(){return downloadItems;},get head(){return head;},get playing(){return playing;},loadDemo,addVideos,portableBlob,openPortable,renderJob,render,seek,skipPreview,play,pause,undo,redo,selectClip,checkSupport,core:E};
miniPlayer=createMiniPlayer();render();requestAnimationFrame(tick);
if(!M)say('Media engine missing. Use the complete standalone HTML.',true);
})();
