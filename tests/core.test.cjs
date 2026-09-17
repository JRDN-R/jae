const assert=require('node:assert/strict');
const C=require('../src/core.js');
let tests=0;
function test(name,f){f();tests++;console.log('✓',name);}
function close(a,b,eps=1e-8){assert.ok(Math.abs(a-b)<eps,`${a} != ${b}`);}
function project(){const p=C.defaults();p.clips=[C.makeClip('a','1'),C.makeClip('b','2'),C.makeClip('a','3')];p.clips.forEach(c=>c.trimOut=20);return p;}
test('defaults: 130 BPM, 24fps, 4K portrait',()=>{const p=project();assert.equal(p.bpm,130);assert.equal(p.fps,24);assert.deepEqual(C.dimensions(p),{width:2160,height:3840});close(C.duration(p.clips[0],p),48/13);});
test('zoom starts and returns at 1×',()=>{let p=project(),c=p.clips[0];close(C.motion(c,p,0).zoom,1);close(C.motion(c,p,C.duration(c,p)).zoom,1);let ks=C.keys(c,p);close(C.curve(c,p,ks[2].b).zoom,c.zoom);});
test('speed integral agrees with numeric integration',()=>{let p=project(),c=p.clips[0];for(const b of [.125,1,2,2.125,2.25,2.5,4,7.75,8]){let n=20000,step=b/n,sum=0;for(let k=0;k<n;k++)sum+=C.curve(c,p,(k+.5)*step).speed*step;close(C.curve(c,p,b).area,sum,2e-6);}});
test('tempo changes time, not rhythmic phases',()=>{const p=project(),c=p.clips[0],p2={...p,bpm:65};for(let b=0;b<8;b+=.125){close(C.motion(c,p,b*60/130).zoom,C.motion(c,p2,b*60/65).zoom);close(C.motion(c,p2,b*60/65).time,2*C.motion(c,p,b*60/130).time);}});
test('short slots keep monotonic phase ordering',()=>{const p=project(),c={...p.clips[0],bars:.25,onset:192,attack:2,release:4};const keys=C.keys(c,p);for(let i=1;i<keys.length;i++)assert.ok(keys[i].b>=keys[i-1].b);assert.equal(keys.at(-1).b,1);close(C.motion(c,p,C.duration(c,p)).zoom,1);});
test('source bounds hold with looping, freezing and fit',()=>{const p=project();for(const fill of ['loop','hold','fit']){const c={...p.clips[0],trimIn:2,trimOut:2.5,fill};for(let t=0;t<C.duration(c,p);t+=.013){let m=C.motion(c,p,t);assert.ok(m.time>=2&&m.time<2.5);assert.ok(m.speed>0);}if(fill==='fit')close(C.motion(c,p,C.duration(c,p)).time,2.4999);}});
test('global frame lattice has no overlaps, gaps or accumulated rounding',()=>{for(const bpm of [30,65,130,147.3,300])for(const fps of [24,25,30,60]){const p=project();p.bpm=bpm;p.fps=fps;p.clips[1].bars=.25;p.clips[2].bars=1.5;const plan=C.frameGroups(p,p.clips,7);let cursor=0;for(const g of plan.groups){assert.equal(g.first,cursor);cursor=g.last;}assert.equal(cursor,plan.count);assert.equal(plan.count,Math.ceil(plan.total*fps-1e-8));assert.ok(plan.count/fps-plan.total<1/fps+1e-7);}});
test('normalization rejects illegal settings',()=>{const p=C.normalizeProject({bpm:999,fps:7,resolution:5,aspect:'junk',format:'x',clips:[]});assert.equal(p.bpm,300);assert.equal(p.fps,24);assert.equal(p.resolution,2160);assert.equal(p.aspect,'9:16');assert.equal(p.format,'mp4-avc');const c=C.normalizeClip({bars:-1,zoom:9,trimIn:999,trimOut:-1,attack:0},4);assert.equal(c.zoom,3);assert.equal(c.bars,.25);assert.ok(c.trimOut>c.trimIn);});
console.log(`${tests} test groups passed.`);
