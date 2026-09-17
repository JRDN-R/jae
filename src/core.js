/* Just Animate Everything: deterministic beat-domain motion engine. */
globalThis.JAECore = (() => {
  'use strict';
  const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
  const number=(x,d,a=-Infinity,b=Infinity)=>Number.isFinite(+x)?clamp(+x,a,b):d;
  const smooth=u=>u*u*(3-2*u);
  const primitive=u=>u*u*u-.5*u*u*u*u;
  const defaults=()=>({name:'Untitled rhythm',bpm:130,meter:4,defaultBars:2,resolution:2160,aspect:'9:16',fps:24,quality:'high',format:'mp4-avc',musicOffset:0,musicVolume:.8,clips:[]});
  function makeClip(asset,id){return {id,asset,bars:2,onset:2,attack:.25,release:.5,base:1,peak:2.5,slow:.55,zoom:1.65,returnZoom:true,ramp:true,preset:'swoop',trimIn:0,trimOut:1,fill:'loop',fit:'cover',fx:.5,fy:.5};}
  function normalizeClip(c,duration){
    const r={...makeClip(String(c.asset||''),String(c.id||'')),...c};
    for(const [k,d,a,b] of [['bars',2,.25,32],['onset',2,0,192],['attack',.25,.125,2],['release',.5,.125,4],['base',1,.125,4],['peak',2.5,.125,8],['slow',.55,.125,4],['zoom',1.65,1,3],['fx',.5,0,1],['fy',.5,0,1]])r[k]=number(r[k],d,a,b);
    r.bars=Math.round(r.bars*4)/4;r.onset=Math.round(r.onset*8)/8;
    r.trimIn=number(r.trimIn,0,0,Math.max(0,duration-.01));
    r.trimOut=number(r.trimOut,duration,Math.min(duration,r.trimIn+.01),duration);
    r.returnZoom=!!r.returnZoom;r.ramp=r.ramp!==false;
    r.fill=['loop','hold','fit'].includes(r.fill)?r.fill:'loop';r.fit=r.fit==='contain'?'contain':'cover';
    r.preset=['subtle','swoop','punch','flat'].includes(r.preset)?r.preset:'';
    return r;
  }
  function normalizeProject(p){const d=defaults(),r={...d};
    r.name=String(p.name||d.name).slice(0,80);r.bpm=number(p.bpm,130,30,300);r.meter=[3,4,6].includes(+p.meter)?+p.meter:4;
    r.defaultBars=Math.round(number(p.defaultBars,2,.25,32)*4)/4;
    r.resolution=[720,1080,1440,2160].includes(+p.resolution)?+p.resolution:2160;
    r.fps=[24,25,30,60].includes(+p.fps)?+p.fps:24;r.aspect=['9:16','16:9','1:1','4:5'].includes(p.aspect)?p.aspect:'9:16';
    r.format=['mp4-avc','mp4-hevc','mov-avc','mov-hevc','webm-vp9','webm-vp8'].includes(p.format)?p.format:'mp4-avc';
    r.quality=['standard','high','max'].includes(p.quality)?p.quality:'high';r.musicOffset=number(p.musicOffset,0,0,300);r.musicVolume=number(p.musicVolume,.8,0,1);
    r.clips=Array.isArray(p.clips)?p.clips:[];return r;
  }
  function dimensions(p){const [a,b]=p.aspect.split(':').map(Number),s=p.resolution;return a<=b?{width:s,height:Math.round(s*b/a/2)*2}:{width:Math.round(s*a/b/2)*2,height:s};}
  const secondsPerBeat=p=>60/p.bpm;
  const beats=(c,p)=>c.bars*p.meter;
  const duration=(c,p)=>beats(c,p)*secondsPerBeat(p);
  function keys(c,p){const B=beats(c,p);
    if(!c.ramp)return [{b:0,v:c.base,z:1},{b:B,v:c.base,z:1}];
    // Reserve the exit first, then proportionally compress only phases that cannot fit.
    let ex=c.returnZoom?Math.min(.5,B*.2):0,at=c.attack,re=c.release;
    const factor=Math.min(1,(B-ex)/(at+re));at*=factor;re*=factor;
    const st=clamp(c.onset,0,Math.max(0,B-ex-at-re));
    return [{b:0,v:c.base,z:1},{b:st,v:c.base,z:1},{b:st+at,v:c.peak,z:c.zoom},
      {b:st+at+re,v:c.slow,z:c.zoom},{b:B-ex,v:c.slow,z:c.zoom},
      {b:B,v:c.returnZoom?c.base:c.slow,z:c.returnZoom?1:c.zoom}];
  }
  function curve(c,p,b){const ks=keys(c,p);b=clamp(b,0,beats(c,p));let area=0,v=ks[0].v,z=1;
    for(let i=1;i<ks.length;i++){const a=ks[i-1],e=ks[i],len=e.b-a.b;if(len<1e-10)continue;
      const x=clamp(b-a.b,0,len),u=x/len;area+=a.v*x+(e.v-a.v)*len*primitive(u);
      if(b>=a.b&&b<=e.b){v=a.v+(e.v-a.v)*smooth(u);z=a.z+(e.z-a.z)*smooth(u);break;}
      if(b>=e.b){v=e.v;z=e.z;}
    }return {area,speed:v,zoom:z};
  }
  function motion(c,p,t){const k=curve(c,p,t/secondsPerBeat(p)),end=curve(c,p,beats(c,p));
    const raw=k.area*secondsPerBeat(p),range=Math.max(.001,c.trimOut-c.trimIn),needed=end.area*secondsPerBeat(p);
    let advance=raw,ratio=1;
    if(c.fill==='fit'){ratio=range/Math.max(.0001,needed);advance=raw*ratio;}
    else if(c.fill==='loop'){advance=((raw%range)+range)%range;}
    else advance=Math.min(raw,Math.max(0,range-.001));
    return {time:clamp(c.trimIn+advance,c.trimIn,Math.max(c.trimIn,c.trimOut-.0001)),speed:k.speed*ratio,zoom:k.zoom,needed};
  }
  function segments(p,repeats=1,clips=p.clips){let start=0,result=[];for(let loop=0;loop<repeats;loop++)for(const clip of clips){let d=duration(clip,p);result.push({clip,start,end:start+d,loop});start+=d;}return result;}
  function locate(p,t){const ss=segments(p);if(!ss.length)return null;for(const s of ss)if(t<s.end-1e-10)return {...s,local:Math.max(0,t-s.start)};const s=ss[ss.length-1];return {...s,local:Math.max(0,s.end-s.start-1e-7)};}
  function frameGroups(p,clips=p.clips,repeats=1){const ss=segments(p,repeats,clips),total=ss.at(-1)?.end||0,count=Math.ceil(total*p.fps-1e-8);return {total,count,groups:ss.map(s=>({...s,first:Math.max(0,Math.ceil(s.start*p.fps-1e-8)),last:Math.min(count,Math.ceil(s.end*p.fps-1e-8))}))};}
  const presets={subtle:{ramp:true,base:1,peak:1.7,slow:.8,zoom:1.25,onset:2,attack:.5,release:1,returnZoom:true},swoop:{ramp:true,base:1,peak:2.5,slow:.55,zoom:1.65,onset:2,attack:.25,release:.5,returnZoom:true},punch:{ramp:true,base:1,peak:4,slow:.35,zoom:1.85,onset:1,attack:.125,release:.5,returnZoom:true},flat:{ramp:false,base:1,peak:1,slow:1,zoom:1,onset:0,attack:.25,release:.5,returnZoom:false}};
  return {clamp,number,smooth,defaults,makeClip,normalizeClip,normalizeProject,dimensions,secondsPerBeat,beats,duration,keys,curve,motion,segments,locate,frameGroups,presets};
})();
if(typeof module!=='undefined')module.exports=globalThis.JAECore;
