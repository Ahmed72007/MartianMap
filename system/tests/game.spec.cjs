// End-to-end check for field-operations.html (desktop keyboard + phone touch). Run: node system/tests/game.spec.cjs
const { chromium, devices } = require('playwright'); const fs=require('fs'); const path=require('path'); const file=path.resolve(__dirname,'../../field-operations.html'); const SP=process.env.SHOTS||null;
// Optional offline vendor dir (npm i leaflet@1.9.4 three@0.160.0) via VENDOR=/path/node_modules; otherwise the real CDN is used.
const nm=process.env.VENDOR?process.env.VENDOR.replace(/\/?$/,'/'):null;
async function route(p){ if(!nm) return; await p.route('https://cdn.jsdelivr.net/**', r=>{const u=r.request().url();
  if(u.includes('leaflet.css')) return r.fulfill({contentType:'text/css',body:fs.readFileSync(nm+'leaflet/dist/leaflet.css')});
  if(u.includes('leaflet.js')) return r.fulfill({contentType:'application/javascript',body:fs.readFileSync(nm+'leaflet/dist/leaflet.js')});
  if(u.includes('three.min.js')) return r.fulfill({contentType:'application/javascript',body:fs.readFileSync(nm+'three/build/three.min.js')});
  return r.abort();}); await p.route('https://trek.nasa.gov/**', r=>r.abort()); }
(async()=>{ const b=await chromium.launch({args:['--use-gl=swiftshader','--enable-unsafe-swiftshader']});
 for (const [tag,ctxOpt] of [['desk',{viewport:{width:1440,height:900}}],['phone',{...devices['iPhone 13']}]]) {
  const ctx=await b.newContext(ctxOpt); const p=await ctx.newPage(); const errs=[]; p.on('pageerror',e=>errs.push('PE '+e.message)); await route(p);
  await p.goto(process.env.GAME_URL||('file://'+file)); await p.waitForTimeout(4500);
  // pick Jezero via its pin
  await p.locator('.feature-pin', {hasText:'Jezero'}).first().dispatchEvent('click'); await p.waitForTimeout(300);
  console.log(tag,'selected:', await p.locator('#selectedName').innerText(), '| link:', await p.locator('#realDataLink').innerText());
  if(SP) await p.screenshot({path:`${SP}/${tag}-g-select.png`});
  await p.locator('#landBtn').click(); await p.waitForTimeout(5200);
  const before=await p.evaluate(()=>document.getElementById('coords').textContent);
  if(tag==='desk'){ await p.keyboard.down('KeyW'); await p.waitForTimeout(1500); await p.keyboard.up('KeyW'); }
  else { const btn=p.locator('#touchPad [data-key=KeyW]'); const bb=await btn.boundingBox(); await p.mouse.move(bb.x+20,bb.y+20); await p.mouse.down(); await p.waitForTimeout(1500); await p.mouse.up(); }
  await p.waitForTimeout(300);
  const after=await p.evaluate(()=>document.getElementById('coords').textContent);
  console.log(tag,'moved:',before,'->',after, 'paused:', await p.locator('#pauseScreen').evaluate(e=>e.classList.contains('show')));
  if(SP) await p.screenshot({path:`${SP}/${tag}-g-play.png`});
  if(errs.length||before===after) { console.error('FAILED',tag,errs,before,after); process.exitCode=1; } await ctx.close(); }
 await b.close(); if(!process.exitCode) console.log('ALL PASSED');})();
