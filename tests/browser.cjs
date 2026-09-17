/* Integration checks run against the real HTML, real WebCodecs and real encoded fixtures. */
const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {spawn,spawnSync}=require('node:child_process');
const ROOT=path.resolve(__dirname,'..'),OUT=path.join(ROOT,'test-results');fs.mkdirSync(OUT,{recursive:true});
const results=[];
const log=(name,detail)=>{results.push({name,detail});console.log('PASS',name,JSON.stringify(detail??''));};
function fixture(args){const r=spawnSync('ffmpeg',['-v','error','-y',...args]);if(r.status)throw Error(r.stderr.toString());}
function probe(file){const r=spawnSync('ffprobe',['-v','error','-show_streams','-show_format','-of','json',file]);assert.equal(r.status,0,r.stderr.toString());return JSON.parse(r.stdout);}
(async()=>{
 fixture(['-f','lavfi','-i','testsrc2=size=320x240:rate=24','-t','4','-c:v','libx264','-pix_fmt','yuv420p',path.join(OUT,'source.mp4')]);
 fixture(['-f','lavfi','-i','testsrc2=size=240x426:rate=30','-t','3','-c:v','libx264','-pix_fmt','yuv420p',path.join(OUT,'portrait.mp4')]);
 fixture(['-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','4',path.join(OUT,'sound.wav')]);
 const server=spawn('python3',['-m','http.server','8765','--bind','127.0.0.1'],{cwd:ROOT,stdio:'ignore'});await new Promise(r=>setTimeout(r,800));
 const browser=await chromium.launch({headless:true,args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});
 const context=await browser.newContext({viewport:{width:1440,height:1100},acceptDownloads:true});const page=await context.newPage();page.setDefaultTimeout(45000);
 const errors=[],unexpected=[];page.on('pageerror',e=>errors.push(String(e)));page.on('dialog',d=>d.accept());
 page.on('request',r=>{if(!/^(http:\/\/127\.0\.0\.1|data:|blob:)/.test(r.url()))unexpected.push(r.url());});
 const saveBlob=async(index,name)=>{const encoded=await page.evaluate(async i=>{const b=JAE.downloads[i].blob;return await new Promise((r,j)=>{const f=new FileReader();f.onload=()=>r(f.result.split(',')[1]);f.onerror=j;f.readAsDataURL(b);});},index);const file=path.join(OUT,name);fs.writeFileSync(file,Buffer.from(encoded,'base64'));return probe(file);};
 const render=async(scope,res,format,name)=>{
  await page.click('#exportBtn');await page.selectOption('#exportScope',scope);await page.selectOption('#resolution',String(res));await page.selectOption('#format',format);await page.evaluate(()=>JAE.checkSupport());
  const msg=await page.locator('#supportStatus').innerText();assert.ok(!await page.locator('#startExport').isDisabled(),msg);
  const before=await page.evaluate(()=>JAE.downloads.length);await page.click('#startExport');await page.waitForFunction(n=>!document.getElementById('busyDialog').open&&JAE.downloads.length>n,before,{timeout:180000});
  const after=await page.evaluate(()=>JAE.downloads.length);assert.ok(after>before,await page.locator('#status').innerText());
  return {before,after,meta:await saveBlob(before,name)};
 };
 try{
  await page.goto('http://127.0.0.1:8765/index.html');
  assert.deepEqual(await page.evaluate(()=>({bpm:JAE.project.bpm,fps:JAE.project.fps,...JAE.core.dimensions(JAE.project)})),{bpm:130,fps:24,width:2160,height:3840});log('requested defaults');
  await page.click('#saveBtn');assert.equal(await page.locator('#localOpenBtn').isDisabled(),false);assert.equal(await page.locator('#downloadProjectBtn').isDisabled(),true);await page.click('[data-close="saveDialog"]');log('recovery accessible before adding footage');
  await page.click('#demoBtn');assert.equal(await page.locator('.clip-item').count(),3);await page.waitForTimeout(650);await page.screenshot({path:path.join(OUT,'desktop.png'),fullPage:true});
  await page.click('#metroBtn');await page.click('#playBtn');await page.waitForTimeout(400);assert.ok(await page.evaluate(()=>JAE.head)>.2);await page.click('#playBtn');log('live preview and metronome');
  await page.click('#duplicateBtn');assert.equal(await page.locator('.clip-item').count(),4);await page.click('#undoBtn');assert.equal(await page.locator('.clip-item').count(),3);await page.click('#redoBtn');assert.equal(await page.locator('.clip-item').count(),4);await page.click('#deleteBtn');assert.equal(await page.locator('.clip-item').count(),3);log('duplicate, undo, redo and remove');
  await page.fill('#defaultBars','.25');await page.locator('#defaultBars').press('Tab');await page.click('#equalBtn');await page.evaluate(()=>JAE.selectClip(JAE.project.clips[0].id));
  const webm=await render('all',720,'webm-vp9','demo-720.webm');assert.equal(webm.meta.streams[0].width,720);assert.equal(webm.meta.streams[0].height,1280);assert.ok(Math.abs(Number(webm.meta.format.duration)-18/13)<.05);log('frame-accurate 720p VP9 arrangement export',webm.meta.format.duration);
  const four=await render('selected',2160,'webm-vp9','demo-4k.webm');assert.equal(four.meta.streams[0].width,2160);assert.equal(four.meta.streams[0].height,3840);log('real 2160×3840 export',four.meta.streams[0].r_frame_rate);
  const codecs=await page.evaluate(async()=>{const out={};for(const codec of ['avc','hevc','vp8','vp9'])out[codec]=await Mediabunny.canEncodeVideo(codec,{width:720,height:1280,frameRate:24});return out;});log('actual codec availability',codecs);
  if(codecs.avc){let mp4=await render('selected',720,'mp4-avc','demo.mp4');assert.equal(mp4.meta.streams[0].codec_name,'h264');log('H.264 MP4 export');let mov=await render('selected',720,'mov-avc','demo.mov');assert.equal(mov.meta.streams[0].codec_name,'h264');log('H.264 MOV export');}
  await page.click('#newBtn');await page.setInputFiles('#videoInput',[path.join(OUT,'source.mp4'),path.join(OUT,'portrait.mp4')]);await page.waitForFunction(()=>!document.getElementById('busyDialog').open);assert.equal(await page.locator('.clip-item').count(),2,await page.locator('#status').innerText());log('two real video files decoded');
  await page.setInputFiles('#musicInput',path.join(OUT,'sound.wav'));await page.waitForFunction(()=>!document.getElementById('busyDialog').open);assert.match(await page.locator('#musicName').innerText(),/sound.wav/);
  await page.fill('#defaultBars','.25');await page.locator('#defaultBars').press('Tab');await page.click('#equalBtn');await page.fill('#projectName','Beat test');await page.locator('#projectName').press('Tab');
  let audio=await render('all',720,'webm-vp9','footage-audio.webm');assert.ok(audio.meta.streams.some(s=>s.codec_name==='opus'));log('uploaded footage and soundtrack export',audio.meta.streams.map(s=>s.codec_name));
  let packed=await page.evaluate(async()=>{return await new Promise((r,j)=>{const f=new FileReader();f.onload=()=>r(f.result.split(',')[1]);f.onerror=j;f.readAsDataURL(JAE.portableBlob());});});fs.writeFileSync(path.join(OUT,'roundtrip.jae'),Buffer.from(packed,'base64'));
  let before=await page.evaluate(()=>JSON.stringify(JAE.project));await page.click('#newBtn');await page.setInputFiles('#projectInput',path.join(OUT,'roundtrip.jae'));await page.waitForFunction(()=>!document.getElementById('busyDialog').open);assert.equal(await page.evaluate(()=>JSON.stringify(JAE.project)),before);assert.match(await page.locator('#musicName').innerText(),/sound.wav/);log('portable project round-trip, video and audio included');
  fs.writeFileSync(path.join(OUT,'corrupt.jae'),'not a JAE project');await page.setInputFiles('#projectInput',path.join(OUT,'corrupt.jae'));await page.waitForFunction(()=>!document.getElementById('busyDialog').open);assert.equal(await page.evaluate(()=>JSON.stringify(JAE.project)),before);log('corrupt project rejected without losing current edit');
  const each=await render('each',720,'webm-vp9','separate-01.webm');assert.equal(each.after-each.before,2);await saveBlob(each.before+1,'separate-02.webm');log('separate-clip batch export',2);
  // Save original bytes, reopen and compare bytes, not just filename.
  const original=Buffer.from(await page.evaluate(async()=>Array.from(new Uint8Array(await [...JAE.assets.values()][0].file.arrayBuffer()))));assert.ok(original.equals(fs.readFileSync(path.join(OUT,'source.mp4'))));log('original media bytes are lossless through .jae save');
  await page.click('#saveBtn');await page.click('#localSaveBtn');await page.waitForFunction(()=>!document.getElementById('busyDialog').open);await page.click('#newBtn');await page.click('#saveBtn');await page.click('#localOpenBtn');await page.waitForFunction(()=>!document.getElementById('busyDialog').open);assert.equal(await page.evaluate(()=>JAE.project.clips.length),2);log('IndexedDB recovery save / restore');
  await page.setViewportSize({width:390,height:844});await page.waitForTimeout(600);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:path.join(OUT,'mobile.png'),fullPage:true});log('390px mobile layout has no horizontal overflow');
  await page.click('#newBtn');const nineteen=Array.from({length:21},(_,i)=>({name:`clip-${i}.mp4`,mimeType:'video/mp4',buffer:fs.readFileSync(path.join(OUT,'source.mp4'))}));await page.setInputFiles('#videoInput',nineteen);await page.waitForFunction(()=>!document.getElementById('busyDialog').open,null,{timeout:180000});assert.equal(await page.evaluate(()=>JAE.project.clips.length),20);assert.equal(await page.locator('#addBtn').isDisabled(),true);log('20-clip limit');
  assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);log('no uncaught browser errors or remote app requests');
  fs.writeFileSync(path.join(OUT,'results.json'),JSON.stringify({passed:results.length,results},null,2));
 }catch(e){await page.screenshot({path:path.join(OUT,'failure.png'),fullPage:true});fs.writeFileSync(path.join(OUT,'failure.txt'),String(e.stack));throw e;}finally{await browser.close();server.kill();}
})().catch(e=>{console.error(e);process.exit(1);});
