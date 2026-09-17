/* Actual player helpers with deterministic pointer/media clocks. These checks
 * require Node only; they do not claim to verify browser layout or touch APIs. */
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const E=require('../src/core.js');
const app=fs.readFileSync(path.join(__dirname,'../src/app.js'),'utf8');
function source(from,to){const begin=app.indexOf(from),end=app.indexOf(to,begin);assert.ok(begin>=0&&end>begin,`Missing helper section: ${from}`);return app.slice(begin,end);}
function helpers(){const c={E};vm.createContext(c);vm.runInContext(source('function previewTapGestures(','function createMiniPlayer('),c);return c;}
function touchFixture(){
 const c=helpers(),skips=[];let time=0,enabled=true,prevented=0;
 const gestures=c.previewTapGestures({rectangle:()=>({left:100,width:200}),onSkip:amount=>skips.push(amount),enabled:()=>enabled,now:()=>time});
 const event=(x,extra={})=>({pointerId:1,isPrimary:true,button:0,clientX:x,clientY:60,altKey:false,preventDefault(){prevented++;},...extra});
 const tap=(x,at)=>{time=at;gestures.down(event(x));gestures.up(event(x));};
 return {gestures,skips,event,tap,setTime(value){time=value;},setEnabled(value){enabled=value;},get prevented(){return prevented;}};
}

test('double taps on either preview half skip five seconds once',()=>{
 const f=touchFixture();f.tap(140,0);f.tap(146,200);assert.deepEqual(f.skips,[-5]);
 f.tap(255,400);f.tap(250,600);assert.deepEqual(f.skips,[-5,5]);assert.equal(f.prevented,2);
 f.tap(250,700);assert.deepEqual(f.skips,[-5,5],'third tap starts a new pair');
});

test('single, slow, opposite-side, dragged, canceled and disabled taps do not seek',()=>{
 const scenarios=[
  f=>f.tap(140,0),
  f=>{f.tap(140,0);f.tap(140,400);},
  f=>{f.tap(190,0);f.tap(210,200);},
  f=>{f.tap(140,0);f.setTime(200);f.gestures.down(f.event(140));f.gestures.up(f.event(180));},
  f=>{f.tap(140,0);f.gestures.down(f.event(140));f.gestures.reset();f.setTime(200);f.gestures.up(f.event(140));},
  f=>{f.tap(140,0);f.setEnabled(false);f.tap(140,200);},
  f=>{f.tap(140,0);f.setTime(200);f.gestures.down(f.event(140,{altKey:true}));f.gestures.up(f.event(140,{altKey:true}));},
  f=>{f.tap(140,0);f.setTime(200);f.gestures.down(f.event(140,{isPrimary:false}));f.gestures.up(f.event(140,{isPrimary:false}));}
 ];
 for(const scenario of scenarios){const f=touchFixture();scenario(f);assert.deepEqual(f.skips,[]);}
});

function playbackFixture({playing=false,head=3,clockHead=head,loop=true}={}){
 const calls={reset:[],music:[],flash:[],scheduled:0,drawn:0,stopped:0};let modal=false;
 const c={E,project:{clips:[{}]},busy:false,playing,head,loop,audioCtx:{currentTime:100},audioEpoch:100-clockHead,perfEpoch:0,lastLoop:0,playRequest:0,playPending:false,metroTimer:0,
  total:()=>12,document:{querySelector:()=>modal?{}:null},performance:{now:()=>100000},clicks:new Set(),players:[],
  musicStop(){calls.stopped++;},updateTransport(){},resetMetronome:t=>calls.reset.push(t),startMusic:t=>calls.music.push(t),scheduleMetronome(){calls.scheduled++;},
  drawPreview(){calls.drawn++;},miniPlayer:{flash:amount=>calls.flash.push(amount)},setInterval:()=>1,clearInterval(){},initAudio:async()=>{}};
 c.nowHead=()=>c.audioCtx.currentTime-c.audioEpoch;
 vm.createContext(c);vm.runInContext(source('function startPlayback(','function tick('),c);
 return {c,calls,showModal(){modal=true;}};
}

test('preview skips preserve paused state or restart active playback at the live clock',()=>{
 const paused=playbackFixture();paused.c.skipPreview(5);assert.equal(paused.c.head,8);assert.equal(paused.c.playing,false);assert.deepEqual(paused.calls.reset,[]);assert.deepEqual(paused.calls.flash,[5]);
 const active=playbackFixture({playing:true,head:2,clockHead:4});active.c.skipPreview(5);
 assert.equal(active.c.head,9,'use live playback time, not the stale rendered head');assert.equal(active.c.playing,true);assert.equal(active.c.audioEpoch,91);
 assert.deepEqual(active.calls.reset,[9]);assert.deepEqual(active.calls.music,[9]);assert.equal(active.calls.scheduled,1);assert.equal(active.calls.drawn,1);
});

test('preview skips clamp to the arrangement and stop when reaching its end',()=>{
 for(const playing of [false,true])for(const loop of [false,true]){
  const start=playbackFixture({playing,head:1,loop});start.c.skipPreview(-5);assert.equal(start.c.head,0);assert.equal(start.c.playing,playing);
  const end=playbackFixture({playing,head:10,loop});end.c.skipPreview(5);assert.equal(end.c.head,12);assert.equal(end.c.playing,false);assert.deepEqual(end.calls.reset,[]);
 }
 const repeated=playbackFixture({playing:true,clockHead:28,head:3});repeated.c.skipPreview(5);assert.equal(repeated.c.head,9);assert.equal(repeated.c.playing,true);
});

test('preview skips do not disturb playback during a modal or busy operation',()=>{
 for(const block of [f=>{f.c.busy=true;},f=>f.showModal(),f=>{f.c.project.clips=[];}]){
  const f=playbackFixture({playing:true,head:3});block(f);f.c.skipPreview(5);assert.equal(f.c.head,3);assert.equal(f.c.playing,true);assert.deepEqual(f.calls.flash,[]);assert.equal(f.calls.stopped,0);
 }
});

test('floating preview remains inside phone, desktop and landscape viewports',()=>{
 const c=helpers();
 for(const viewport of [{width:390,height:844,left:0,top:0},{width:1440,height:900,left:0,top:0},{width:844,height:390,left:0,top:0},{width:320,height:360,left:60,top:110}]){
  for(const aspect of [9/16,16/9,1,4/5])for(const box of [{x:-1000,y:-1000,width:1},{x:10000,y:10000,width:5000},{x:100,y:90,width:280}]){
   const b=c.floatingPreviewBounds(box,viewport,aspect);
   assert.ok(b.width>0&&b.width<=640);
   assert.ok(b.x>=viewport.left+12&&b.y>=viewport.top+12);
   assert.ok(b.x+b.width<=viewport.left+viewport.width-12+1e-9);
   assert.ok(b.y+b.width/aspect+80<=viewport.top+viewport.height-12+1e-9);
   assert.deepEqual(c.floatingPreviewBounds(b,viewport,aspect),b,'bounds are stable after clamping');
  }
 }
});

test('a canceled or superseded audio resume cannot restart playback later',async()=>{
 for(const cancel of [c=>c.pause(),c=>c.play()]){
  const {c,calls}=playbackFixture();let resume;c.initAudio=()=>new Promise(resolve=>{resume=resolve;});
  const pending=c.play();assert.equal(c.playPending,true);cancel(c);assert.equal(c.playPending,false);
  resume();await pending;assert.equal(c.playing,false);assert.deepEqual(calls.reset,[]);
  c.initAudio=async()=>{};await c.play();assert.equal(c.playing,true);assert.deepEqual(calls.reset,[3]);
 }
});
