// End-to-end checks for marswalk.html. Run: node system/tests/smoke.spec.cjs [--shots DIR]
const { chromium } = require('playwright');
const path = require('path');
const assert = require('assert');
const file = process.env.MARSWALK_URL || ('file://' + path.resolve(__dirname, '../../marswalk.html'));
const shots = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.addInitScript(() => { try { localStorage.setItem('marswalk-guide', '1'); } catch {} });
  await page.goto(file);
  await page.waitForSelector('#boot', { state: 'detached', timeout: 30000 });
  const step = async (name, fn) => { const t = Date.now(); await fn(); console.log(`✓ ${name} (${Date.now() - t} ms)`); };

  await step('boot + legend', async () => { assert.ok(await page.locator('#legend').innerText()); });
  await step('demo traverse plans ≥3 stops', async () => {
    await page.click('#demoBtn');
    await page.waitForFunction(() => window.MARSWALK.S.plan, null, { timeout: 30000 });
    const p = await page.evaluate(() => { const p = MARSWALK.S.plan; return { legs: p.legs.length, d: p.distance, hz: p.hazardCells, order: p.order, maxCell: p.maxCell, thr: p.st.thr }; });
    assert.equal(p.legs, 4); assert.ok(p.d > 500); assert.equal(p.hz, 0); assert.ok(p.maxCell <= p.thr);
    assert.deepEqual([...p.order].sort(), [0, 0, 1, 2, 3]);
  });
  if (shots) await page.screenshot({ path: `${shots}/planner.png` });
  await step('optimised order is never worse than listed order', async () => {
    const r = await page.evaluate(() => { const C = [[0, 5, 9, 4], [5, 0, 3, 7], [9, 3, 0, 2], [4, 7, 2, 0]]; return [MARSWALK.bestOrder(C, 4, true, true).cost, MARSWALK.bestOrder(C, 4, true, false).cost]; });
    assert.ok(r[0] <= r[1]); assert.equal(r[0], 14);
  });
  await step('pace model: flat = 1, uphill slower, mild downhill faster', async () => {
    const r = await page.evaluate(() => [MARSWALK.paceFactor(0), MARSWALK.paceFactor(0.2), MARSWALK.paceFactor(-0.05)]);
    assert.equal(r[0], 1); assert.ok(r[1] < 0.6); assert.ok(r[2] > 1);
  });
  await step('obstruction triggers reroute that avoids it', async () => {
    const before = await page.evaluate(() => MARSWALK.S.plan.distance);
    await page.evaluate(() => { const p = MARSWALK.S.plan, l = p.legs[0], i = l.cells[Math.floor(l.cells.length / 2)], [x, y] = MARSWALK.S.G.xy(i); MARSWALK.S.__ob = [x, y]; document.getElementById('obstacleRadius').value = '80'; });
    await page.evaluate(() => { const [x, y] = MARSWALK.S.__ob; MARSWALK.S.obstacles.push({ x, y, r: 80, id: 1 }); return MARSWALK.planTraverse({ quiet: true }); });
    const r = await page.evaluate(() => { const S = MARSWALK.S, [ox, oy] = S.__ob; let inside = 0; for (const l of S.plan.legs) for (const i of l.cells) { const [x, y] = S.G.xy(i); if ((x - ox) ** 2 + (y - oy) ** 2 <= 80 ** 2) inside++; } return { inside, d: S.plan.distance }; });
    assert.equal(r.inside, 0); assert.ok(r.d >= before - 1e-6);
  });
  await step('hazard threshold change replans with constraint honoured', async () => {
    await page.fill('#hazardThr', '10'); await page.dispatchEvent('#hazardThr', 'change');
    await page.waitForFunction(() => MARSWALK.S.plan && MARSWALK.S.plan.st.thr === 10 || /threshold|No connected/.test(document.getElementById('planStatus').textContent), null, { timeout: 30000 });
    const r = await page.evaluate(() => MARSWALK.S.plan ? MARSWALK.S.plan.maxCell : -1);
    assert.ok(r <= 10);
    await page.fill('#hazardThr', '15'); await page.dispatchEvent('#hazardThr', 'change');
    await page.waitForFunction(() => MARSWALK.S.plan && MARSWALK.S.plan.st.thr === 15, null, { timeout: 30000 });
  });
  await step('all layers render', async () => {
    for (const id of ['elevationOn', 'slopeOn', 'thermalOn', 'crismOn', 'geologyOn']) await page.check('#' + id);
    await page.waitForTimeout(200);
    if (shots) await page.screenshot({ path: `${shots}/layers.png` });
    for (const id of ['elevationOn', 'slopeOn', 'thermalOn', 'crismOn', 'geologyOn']) await page.uncheck('#' + id);
  });
  await step('map click inspects real values', async () => {
    const box = await page.locator('#map').boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForFunction(() => /Elevation/.test(document.getElementById('inspectCard').textContent));
  });
  await step('HUD playback advances', async () => {
    await page.click('#hudBtn'); await page.selectOption('#playSpeed', '600'); await page.click('#playBtn'); await page.waitForTimeout(1200);
    const t = await page.evaluate(() => MARSWALK.S.play.t); assert.ok(t > 100);
    assert.ok((await page.locator('#hudNext').innerText()).length > 2);
    if (shots) await page.screenshot({ path: `${shots}/hud.png` });
    await page.click('#playBtn'); await page.click('#hudClose');
  });
  await step('science tab lists units crossed', async () => {
    await page.click('[data-panel=sciencePanel]'); assert.match(await page.locator('#routeScience').innerText(), /GEOLOGIC UNITS CROSSED/);
    await page.click('[data-panel=envPanel]'); assert.match(await page.locator('#medaStats').innerText(), /K/);
    await page.click('[data-panel=plannerPanel]');
  });
  await step('share link restores the plan', async () => {
    const url = page.url(); const p2 = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    p2.on('pageerror', e => errors.push('p2: ' + e.message));
    await p2.goto(url); await p2.waitForSelector('#boot', { state: 'detached', timeout: 30000 });
    await p2.waitForFunction(() => MARSWALK.S.plan, null, { timeout: 30000 });
    const n = await p2.evaluate(() => [MARSWALK.S.waypoints.length, MARSWALK.S.obstacles.length]); assert.deepEqual(n, [4, 1]); await p2.close();
  });
  await step('region switch keeps app consistent', async () => {
    await page.selectOption('#regionSelect', 'm1'); await page.waitForTimeout(500);
    assert.equal(await page.evaluate(() => MARSWALK.S.regionKey), 'm1');
    await page.selectOption('#regionSelect', 'expanded'); await page.waitForTimeout(500);
  });
  await step('mobile layout has no horizontal scroll', async () => {
    const m = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    m.on('pageerror', e => errors.push('mobile: ' + e.message));
    await m.addInitScript(() => { try { localStorage.setItem('marswalk-guide', '1'); } catch {} });
    await m.goto(file); await m.waitForSelector('#boot', { state: 'detached', timeout: 30000 });
    const ov = await m.evaluate(() => document.documentElement.scrollWidth - innerWidth); assert.ok(ov <= 1, 'overflow ' + ov);
    if (shots) await m.screenshot({ path: `${shots}/mobile.png` }); await m.close();
  });
  await step('guide and challenge dialogs open and close', async () => {
    await page.click('#challengeBtn'); assert.match(await page.locator('#challengeTable').innerText(), /Tactical safety/);
    if (shots) await page.screenshot({ path: `${shots}/challenge.png` });
    await page.click('#challengeDlg button'); await page.click('#helpBtn'); assert.ok(await page.locator('#helpDlg').isVisible()); await page.click('#helpDlg button');
  });
  assert.deepEqual(errors.filter(e => !/three|cdn\.jsdelivr|ERR_/.test(e)), []);
  console.log('ALL PASSED'); await browser.close();
})().catch(e => { console.error('FAILED', e); process.exit(1); });
