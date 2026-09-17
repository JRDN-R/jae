/* Standalone regression checks for browser event ordering and audio scheduling.
 * These execute the application's actual functions with a small media-element
 * fixture; no browser, codec installation, or network access is required. */
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const E=require('../src/core.js');
const app=fs.readFileSync(path.join(__dirname,'../src/app.js'),'utf8');
function source(from,to){const begin=app.indexOf(from),end=app.indexOf(to,begin);assert.ok(begin>=0&&end>begin);return app.slice(begin,end);}

function previewFixture({trimIn=2,trimOut=5,head=0,playing=false}={}){
 const project=E.defaults(),clip={...E.makeClip('source','clip'),ramp:false,fill:'hold',trimIn,trimOut};
 project.clips=[clip];
 const rendered=[],elements=[];
 function video(){let time=0;const handlers={};const v={duration:6,readyState:0,seeking:false,paused:true,seeks:[],plays:0,pauses:0,style:{},
  setAttribute(){},load(){},pause(){this.paused=true;this.pauses++;},play(){this.paused=false;this.plays++;return Promise.resolve();},
  addEventListener(name,fn){handlers[name]=fn;},emit(name){handlers[name]?.();},
  finishSeek(){this.seeking=false;this.readyState=2;this.emit('seeked');}
 };
 Object.defineProperty(v,'currentTime',{get:()=>time,set(value){time=value;v.seeks.push(value);v.seeking=true;}});
 elements.push(v);return v;
 }
 const context={E,project,head,playing,busy:false,currentPreview:null,assets:new Map([['source',{id:'source',kind:'video',duration:6,url:'blob:fixture'}]]),
  document:{createElement:video,body:{append(){}}},$:()=>({getContext:()=>({})}),drawMedia:(ctx,image,c,p,local)=>rendered.push({image,local})};
 vm.createContext(context);
 vm.runInContext(source('const players=','const demoCanvas='),context);
 vm.runInContext(source('function choosePlayer(','async function initAudio('),context);
 return {context,elements,rendered};
}

test('a paused source seeks to its trim when metadata loads and renders when ready',()=>{
 const {context:c,elements,rendered}=previewFixture();c.drawPreview();
 assert.equal(rendered.length,0);const current=c.currentPreview;
 elements.find(v=>v!==current).emit('loadeddata');assert.equal(rendered.length,0,'preloading the next source must not replace the current frame');
 current.readyState=1;current.emit('loadedmetadata');assert.deepEqual(current.seeks,[2]);
 current.finishSeek();assert.equal(rendered.length,1);assert.equal(rendered[0].image,current);
 current.emit('loadeddata');assert.equal(rendered.length,2);
});

test('a completed paused seek catches up to a newer scrub position',()=>{
 const {context:c,rendered}=previewFixture();c.drawPreview();const v=c.currentPreview;
 v.readyState=1;v.emit('loadedmetadata');v.finishSeek();
 c.head=1;c.drawPreview();assert.equal(v.currentTime,3);assert.equal(v.seeking,true);
 c.head=2;c.drawPreview();assert.equal(v.currentTime,3,'do not replace an in-flight seek');
 v.finishSeek();assert.equal(v.currentTime,4,'seek completion must apply the latest playhead');
 v.finishSeek();assert.equal(rendered.at(-1).local,2);
});

test('holding the final trimmed frame pauses source playback while the arrangement advances',()=>{
 const {context:c}=previewFixture({trimIn:0,trimOut:1,head:2,playing:true});c.drawPreview();const v=c.currentPreview;
 v.readyState=2;v.currentTime=1.08;v.seeking=false;v.paused=false;c.drawPreview();
 assert.equal(v.currentTime,.999);assert.equal(v.paused,true);assert.equal(v.plays,0);
 v.finishSeek();assert.equal(v.seeking,false);assert.equal(v.paused,true);
});

test('metronome repeats downbeats for a quarter bar in 3/4 and respects non-loop playback',()=>{
 const project={...E.defaults(),bpm:120,meter:3},clicks=[];
 project.clips=[{...E.makeClip('source','clip'),bars:.25}];
 const context={E,project,playing:true,audioCtx:{currentTime:0},audioEpoch:0,nextClick:0,loop:true,
  $:()=>({value:'1'}),total:()=>E.duration(project.clips[0],project),clickAt:(time,beat)=>clicks.push({time,beat})};
 vm.createContext(context);vm.runInContext(source('function resetMetronome(','async function play('),context);
 context.resetMetronome(0);context.scheduleMetronome();context.audioCtx.currentTime=.3;context.scheduleMetronome();context.audioCtx.currentTime=.7;context.scheduleMetronome();
 assert.deepEqual(clicks,[{time:0,beat:0},{time:.375,beat:0},{time:.75,beat:0}]);
 context.resetMetronome(.4);assert.equal(context.nextClick,2,'a scrub between boundaries schedules the next downbeat');
 context.loop=false;context.resetMetronome(0);clicks.length=0;context.audioCtx.currentTime=0;context.scheduleMetronome();context.audioCtx.currentTime=.3;context.scheduleMetronome();
 assert.deepEqual(clicks,[{time:0,beat:0}]);
});
