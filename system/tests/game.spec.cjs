// End-to-end check for field-operations.html: site selection, landing, briefing, mission win/lose, replay, desktop + touch.
// Run: node system/tests/game.spec.cjs   (optional: VENDOR=<node_modules with leaflet@1.9.4 three@0.160.0> for offline, SHOTS=<dir>)
const { chromium, devices } = require('playwright'); const fs = require('fs'); const path = require('path'); const assert = require('assert');
const file = path.resolve(__dirname, '../../field-operations.html'); const SP = process.env.SHOTS || null;
const nm = process.env.VENDOR ? process.env.VENDOR.replace(/\/?$/, '/') : null;
async function route(p) { if (!nm) return; await p.route('https://cdn.jsdelivr.net/**', r => { const u = r.request().url();
  if (u.includes('leaflet.css')) return r.fulfill({ contentType: 'text/css', body: fs.readFileSync(nm + 'leaflet/dist/leaflet.css') });
  if (u.includes('leaflet.js')) return r.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(nm + 'leaflet/dist/leaflet.js') });
  if (u.includes('three.min.js')) return r.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(nm + 'three/build/three.min.js') });
  return r.abort(); }); await p.route('https://trek.nasa.gov/**', r => r.abort()); }
const shot = async (p, n) => { if (SP) await p.screenshot({ path: `${SP}/${n}.png` }); };
(async () => { const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  for (const [tag, ctxOpt] of [['desk', { viewport: { width: 1440, height: 900 } }], ['phone', { ...devices['iPhone 13'] }]]) {
    const ctx = await b.newContext(ctxOpt); const p = await ctx.newPage(); const errs = [];
    p.on('pageerror', e => errs.push('PE ' + e.message)); p.on('console', m => { if (m.type() === 'error' && !/ERR_FAILED|net::/.test(m.text())) errs.push(m.text()); });
    p.on('requestfailed', r => { if (!/trek\.nasa|jsdelivr/.test(r.url())) errs.push('REQ ' + r.url()); });
    await route(p); await p.goto(process.env.GAME_URL || ('file://' + file)); await p.waitForTimeout(4500);
    await shot(p, `${tag}-map`);
    await p.locator('.feature-pin', { hasText: 'Jezero' }).first().dispatchEvent('click'); await p.waitForTimeout(800);
    assert.equal(await p.locator('#selectedName').innerText(), 'Jezero Crater');
    await shot(p, `${tag}-select`);
    await p.locator('#landBtn').click(); await p.waitForTimeout(5200);
    assert.ok(await p.locator('#briefing').isVisible(), 'briefing visible'); await shot(p, `${tag}-briefing`);
    await p.locator('#beginBtn').click(); await p.waitForTimeout(400);
    const before = await p.evaluate(() => [FIELD_OPS.player.x, FIELD_OPS.player.z]);
    if (tag === 'desk') { await p.keyboard.down('KeyW'); await p.waitForTimeout(1500); await p.keyboard.up('KeyW'); }
    else { const bb = await p.locator('#touchPad [data-key=KeyW]').boundingBox(); await p.mouse.move(bb.x + 20, bb.y + 20); await p.mouse.down(); await p.waitForTimeout(1500); await p.mouse.up(); }
    const after = await p.evaluate(() => [FIELD_OPS.player.x, FIELD_OPS.player.z]); const moved = Math.hypot(after[0] - before[0], after[1] - before[1]); assert.ok(moved > 0.3, `moved only ${moved} m`);
    await shot(p, `${tag}-play`);
    // reach the ice deposit → sample → return to lander → win
    await p.evaluate(() => { const d = FIELD_OPS.config.destination; FIELD_OPS.player.x = d.x + 3; FIELD_OPS.player.z = d.z; }); await p.waitForTimeout(500);
    assert.equal(await p.evaluate(() => FIELD_OPS.mission.phase), 'return'); assert.match(await p.locator('#missionTitle').innerText(), /RETURN/);
    await p.evaluate(() => { FIELD_OPS.player.x = 2; FIELD_OPS.player.z = 2; }); await p.waitForTimeout(500);
    assert.ok(await p.locator('#missionEnd.win').isVisible(), 'win screen'); assert.equal(await p.locator('#endStars .on').count(), 3);
    await shot(p, `${tag}-win`);
    // replay → fail by oxygen depletion
    await p.locator('#againBtn').click(); await p.waitForTimeout(300); assert.ok(await p.locator('#briefing').isVisible());
    await p.locator('#beginBtn').click(); await p.evaluate(() => { FIELD_OPS.player.oxygen = 0.01; }); await p.waitForTimeout(600);
    assert.ok(await p.locator('#missionEnd.lose').isVisible(), 'lose screen'); assert.match(await p.locator('#endTitle').innerText(), /Oxygen/);
    await shot(p, `${tag}-lose`);
    await p.locator('#endMapBtn').click(); await p.waitForTimeout(500); assert.equal(await p.evaluate(() => FIELD_OPS.state.appState), 'map');
    assert.deepEqual(errs, [], tag + ' errors'); console.log(`✓ ${tag}: select → land → briefing → move → sample → win → replay → fail → map`); await ctx.close();
  }
  await b.close(); console.log('ALL PASSED'); })().catch(e => { console.error('FAILED', e.message); process.exit(1); });
