/* Exercises the bundled decoder iterator without a browser or codec installation.
 * Fake decoded samples isolate the real Mediabunny timestamp scheduler, including
 * backwards seeks caused by short source trims and early export cancellation. */
const test=require('node:test');
const assert=require('node:assert/strict');
const M=require('../runtime/package/dist/bundles/mediabunny.min.cjs');
const E=require('../src/core.js');

class FixtureSink extends M.BaseMediaSampleSink {
 constructor(){super();this._track={input:{_disposed:false}};this.flushes=0;this.closed=false;this.live=new Set();}
 sample(timestamp){const owner=this,sample={timestamp,clone(){return owner.sample(timestamp);},close(){owner.live.delete(sample);}};this.live.add(sample);return sample;}
 async _createDecoder(output){return {decode:p=>output(this.sample(p.timestamp)),flush:async()=>{this.flushes++;},getDecodeQueueSize:()=>0,close:()=>{this.closed=true;}};}
 _createPacketSink(){const packet=i=>({timestamp:i/24,sequenceNumber:i});return {
  getPacket:async t=>packet(Math.floor(t*24+1e-8)),
  getKeyPacket:async t=>packet(Math.floor(t*24/48)*48),
  getNextPacket:async p=>packet(p.sequenceNumber+1)
 };}
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));

test('bundled iterator preserves repeated frames and backwards trim-loop seeks',async()=>{
 const p=E.defaults(),c={...E.makeClip('source','clip'),trimIn:.125,trimOut:.375};
 const times=Array.from({length:Math.ceil(E.duration(c,p)*p.fps)},(_,k)=>E.motion(c,p,k/p.fps).time);
 assert.ok(times.some((t,i)=>i>0&&t<times[i-1]),'fixture must wrap the source trim');
 const sink=new FixtureSink(),actual=[];
 for await(const sample of sink.mediaSamplesAtTimestamps(times,{})){assert.ok(sample);actual.push(sample.timestamp);sample.close();}
 await settle();
 assert.deepEqual(actual,times.map(t=>Math.floor(t*24+1e-8)/24));
 assert.ok(sink.flushes>1,'backwards seeks must reset decode runs');
 assert.equal(sink.closed,true);
 assert.equal(sink.live.size,0);
});

test('returning a running decoder iterator releases queued samples',async()=>{
 const sink=new FixtureSink();
 const iterator=sink.mediaSamplesAtTimestamps(Array.from({length:1000},(_,i)=>i/24),{});
 const first=await iterator.next();assert.equal(first.done,false);first.value.close();
 await iterator.return();await settle();
 assert.equal(sink.closed,true);
 assert.equal(sink.live.size,0);
 assert.equal((await iterator.next()).done,true);
});
