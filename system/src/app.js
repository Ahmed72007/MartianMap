'use strict';
/* MARSWALK Field Systems — offline traverse planner for Jezero Crater.
 * Source: system/src/app.js · built into marswalk.html by system/build.py.
 * All measured values come from the embedded NASA/USGS-derived products. */
(() => {
const $ = id => document.getElementById(id);
const R = 3396190, RAD = Math.PI / 180;
const DIRS = [[-1,0],[-1,1],[0,1],[1,1],[1,0],[1,-1],[0,-1],[-1,-1]];
const OBJ_COLOR = { time: '#b7a6f0', terrain: '#f4ad79', distance: '#8cdbcb' };
const OBJ_LABEL = { time: 'estimated walking time', terrain: 'terrain-penalised distance', distance: 'shortest distance' };
const MAX_STOPS = 8;
const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';

let DATA;
const S = {
  regionKey: 'expanded', region: null, G: null, layers: {}, view: { cx: 0, cy: 0, zoom: 1 },
  mode: 'inspect', drag: null, pointers: new Map(), pinch: null,
  waypoints: [], obstacles: [], plan: null, prevPlan: null, inspect: null,
  hazardLayer: null, hazardKey: '', unitCache: new Map(), drawQueued: false, busy: false,
  play: { t: 0, playing: false, last: 0 }, v3: null, active3d: false, hud: false, wpSeq: 0,
};

/* ---------- utilities ---------- */
const fmt = (n, d = 1) => Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const frame = () => new Promise(r => requestAnimationFrame(() => r()));
const fmtLL = ll => `${ll[0].toFixed(5)}°E, ${ll[1].toFixed(5)}°N`;
const fmtMin = m => { if (!Number.isFinite(m)) return '—'; const s = m < 0 ? '−' : ''; m = Math.abs(m); const h = Math.floor(m / 60), mm = Math.round(m % 60); return h ? `${s}${h} h ${String(mm === 60 ? 0 : mm).padStart(2,'0')} min` : `${s}${Math.round(m)} min`; };
const clock = sec => { const m = Math.floor(sec / 60), h = Math.floor(m / 60); return `${String(h).padStart(2,'0')}:${String(m % 60).padStart(2,'0')}`; };
function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2600); }
function decodeB64(b64) { const raw = atob(b64), out = new Uint8Array(raw.length); for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i); return out; }
function floats(b64) { const b = decodeB64(b64); if (new Uint8Array(new Uint16Array([1]).buffer)[0] === 1) return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4); const v = new DataView(b.buffer), o = new Float32Array(b.length / 4); for (let i = 0; i < o.length; i++) o[i] = v.getFloat32(i * 4, true); return o; }
function loadImage(b64) { return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Embedded image failed to decode')); i.src = 'data:image/png;base64,' + b64; }); }
function haversine(a, b) { const p1 = a[1]*RAD, p2 = b[1]*RAD, dp = p2-p1, dl = (b[0]-a[0])*RAD, h = Math.sin(dp/2)**2 + Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2; return 2*R*Math.asin(Math.sqrt(clamp(h,0,1))); }
function bearing(a, b) { const p1 = a[1]*RAD, p2 = b[1]*RAD, dl = (b[0]-a[0])*RAD; return (Math.atan2(Math.sin(dl)*Math.cos(p2), Math.cos(p1)*Math.sin(p2) - Math.sin(p1)*Math.cos(p2)*Math.cos(dl)) / RAD + 360) % 360; }
function ramp(stops, t) { t = clamp(t, 0, 0.999999); const f = t * (stops.length - 1), j = Math.floor(f), q = f - j, a = stops[j], b = stops[j + 1]; return a.map((v, k) => Math.round(v + (b[k] - v) * q)); }
const ELEV_RAMP = [[54,80,93],[67,126,119],[162,161,109],[220,181,121],[197,110,83]];
const SLOPE_RAMP = [[62,143,148],[178,179,120],[232,163,79],[220,104,61],[157,62,75]];
const GEO_COLORS = ['#d99d72','#7da69a','#c98168','#9b91b9','#d3bf7b','#69999a','#b77f96','#b39a72','#85a774','#cf8d55'];

/* ---------- grid / projection ---------- */
function buildGrid(r) {
  const m = r.manifest, [a, , c, , e, f] = m.affine, w = m.width, h = m.height;
  const k = R * Math.cos(m.crs.standard_parallel_deg * RAD);
  const G = { m, w, h, a, c, e, f, k, n: w * h,
    elev: floats(r.elevation), slope: floats(r.slope), valid: decodeB64(r.valid), slopeValid: decodeB64(r.slopeValid),
    crism: floats(r.crism), crismValid: decodeB64(r.crismValid), thermal: floats(r.thermal) };
  G.lon = col => (c + (col + .5) * a) / k / RAD;
  G.lat = row => (f + (row + .5) * e) / R / RAD;
  G.ll = i => [G.lon(i % w), G.lat((i / w) | 0)];
  G.xy = i => [c + ((i % w) + .5) * a, f + (((i / w) | 0) + .5) * e];
  G.edge = new Float64Array(h * 8);
  for (let row = 0; row < h; row++) DIRS.forEach(([dr, dc], j) => {
    const nr = clamp(row + dr, 0, h - 1);
    G.edge[row * 8 + j] = haversine([G.lon(0), G.lat(row)], [G.lon(dc), G.lat(nr)]);
  });
  G.base = new Uint8Array(G.n);
  for (let i = 0; i < G.n; i++) G.base[i] = G.valid[i] && G.slopeValid[i] && Number.isFinite(G.elev[i]) && Number.isFinite(G.slope[i]) ? 1 : 0;
  return G;
}
const project = (lon, lat) => [S.G.k * lon * RAD, R * lat * RAD];
const unproject = (x, y) => [x / S.G.k / RAD, y / R / RAD];
function cellAt(x, y) { const G = S.G, col = Math.floor((x - G.c) / G.a), row = Math.floor((y - G.f) / G.e); return row >= 0 && col >= 0 && row < G.h && col < G.w ? row * G.w + col : -1; }

/* ---------- route model ---------- */
// Tobler (1993) hiking function normalised so that flat ground = 1.
const paceFactor = g => Math.exp(-3.5 * (Math.abs(g + 0.05) - 0.05));
function settings() {
  const num = (id, lo, hi, name) => { const v = Number($(id).value); if (!Number.isFinite(v) || v < lo || v > hi) throw new Error(`${name} must be between ${lo} and ${hi}.`); return v; };
  return {
    objective: $('objective').value,
    weight: num('weight', 0, 100000, 'Terrain weight'),
    speed: num('flatSpeed', 0.5, 6, 'Flat walking speed'),
    stopMin: num('stopMinutes', 0, 600, 'Minutes per stop'),
    reserve: num('reserve', 0, 600, 'Reserve minutes'),
    limit: num('evaLimit', 10, 1440, 'EVA time limit'),
    thr: num('hazardThr', 1, 45, 'Slope threshold'),
    avoid: $('avoidHazard').checked, optimize: $('optimize').checked, ret: $('returnStart').checked,
  };
}
function obstacleMask() {
  const G = S.G, out = new Uint8Array(G.n);
  for (const o of S.obstacles) {
    const r0 = Math.floor((o.y + o.r - G.f) / G.e), r1 = Math.floor((o.y - o.r - G.f) / G.e);
    const c0 = Math.floor((o.x - o.r - G.c) / G.a), c1 = Math.floor((o.x + o.r - G.c) / G.a);
    for (let r = Math.max(0, r0); r <= Math.min(G.h - 1, r1); r++) for (let c = Math.max(0, c0); c <= Math.min(G.w - 1, c1); c++) {
      const i = r * G.w + c, [x, y] = G.xy(i); if ((x - o.x) ** 2 + (y - o.y) ** 2 <= o.r ** 2) out[i] = 1;
    }
  }
  return out;
}
function buildMask(st) {
  const G = S.G, ob = obstacleMask(), m = new Uint8Array(G.n);
  for (let i = 0; i < G.n; i++) m[i] = G.base[i] && !ob[i] && !(st.avoid && G.slope[i] > st.thr) ? 1 : 0;
  return { mask: m, ob };
}
class Heap {
  constructor(cap = 1 << 16) { this.k = new Float64Array(cap); this.v = new Int32Array(cap); this.n = 0; }
  push(key, val) {
    if (this.n === this.k.length) { const k = new Float64Array(this.n * 2), v = new Int32Array(this.n * 2); k.set(this.k); v.set(this.v); this.k = k; this.v = v; }
    let i = this.n++; const K = this.k, V = this.v;
    while (i) { const p = (i - 1) >> 1; if (K[p] <= key) break; K[i] = K[p]; V[i] = V[p]; i = p; }
    K[i] = key; V[i] = val;
  }
  pop() {
    const K = this.k, V = this.v, topV = V[0]; this.key = K[0]; const n = --this.n;
    if (n > 0) { const key = K[n], val = V[n]; let i = 0;
      while (true) { let l = 2 * i + 1; if (l >= n) break; const r = l + 1; if (r < n && K[r] < K[l]) l = r; if (K[l] >= key) break; K[i] = K[l]; V[i] = V[l]; i = l; }
      K[i] = key; V[i] = val; }
    return topV;
  }
}
/** One-to-many Dijkstra on the 20 m grid. Edge cost in metres (distance/terrain) or seconds (time). */
function search(G, mask, src, targets, st) {
  const { w, h, elev, edge } = G, dist = new Float64Array(G.n).fill(Infinity), prev = new Int32Array(G.n).fill(-1), done = new Uint8Array(G.n);
  const remaining = new Set(targets.filter(t => t !== src)), heap = new Heap(), v = st.speed / 3.6, obj = st.objective, wt = st.weight;
  dist[src] = 0; heap.push(0, src);
  while (heap.n) {
    const i = heap.pop(), d = heap.key; if (done[i]) continue; done[i] = 1;
    if (remaining.delete(i) && !remaining.size) break;
    const r = (i / w) | 0, c = i - r * w, z = elev[i];
    for (let j = 0; j < 8; j++) {
      const dr = DIRS[j][0], dc = DIRS[j][1], nr = r + dr, nc = c + dc;
      if (nr < 0 || nc < 0 || nr >= h || nc >= w) continue;
      const ni = nr * w + nc; if (!mask[ni] || done[ni]) continue;
      if (dr && dc && (!mask[nr * w + c] || !mask[r * w + nc])) continue; // no corner cutting
      const dd = edge[r * 8 + j], dz = elev[ni] - z;
      const cost = obj === 'distance' ? dd : obj === 'terrain' ? dd * (1 + wt * (dz / dd) ** 2) : dd / (v * paceFactor(dz / dd));
      const nd = d + cost; if (nd < dist[ni]) { dist[ni] = nd; prev[ni] = i; heap.push(nd, ni); }
    }
  }
  return { dist, prev };
}
function extract(prev, src, dst) { const out = []; let c = dst; while (c !== -1) { out.push(c); if (c === src) break; c = prev[c]; } if (out[out.length - 1] !== src) return null; return out.reverse(); }
function legMetrics(G, cells, st) {
  const v = st.speed / 3.6, prof = []; let d = 0, t = 0, asc = 0, desc = 0, maxSeg = 0, maxCell = 0, hz = 0, near = 0;
  for (let k = 0; k < cells.length; k++) {
    const i = cells[k], s = G.slope[i];
    if (k) { const a = cells[k - 1], ar = (a / G.w) | 0, dr = ((i / G.w) | 0) - ar, dc = (i % G.w) - (a % G.w), j = DIRS.findIndex(q => q[0] === dr && q[1] === dc), dd = G.edge[ar * 8 + j], dz = G.elev[i] - G.elev[a];
      d += dd; t += dd / (v * paceFactor(dz / dd)); asc += Math.max(0, dz); desc += Math.max(0, -dz); maxSeg = Math.max(maxSeg, Math.abs(Math.atan2(dz, dd)) / RAD); }
    maxCell = Math.max(maxCell, s); if (s > st.thr) hz++; else if (s > st.thr * 0.8) near++;
    prof.push({ i, d, t, z: G.elev[i], s });
  }
  return { cells, prof, distance: d, timeS: t, ascent: asc, descent: desc, maxSeg, maxCell, hazardCells: hz, nearCells: near };
}
function bestOrder(C, n, ret, optimize) {
  const stops = Array.from({ length: n - 1 }, (_, i) => i + 1);
  const cost = seq => { let s = 0, p = 0; for (const q of seq) { s += C[p][q]; p = q; } return s + (ret ? C[p][0] : 0); };
  if (!optimize || stops.length < 2) return { seq: stops, cost: cost(stops) };
  let best = null, bestC = Infinity;
  const perm = (arr, l) => { if (l === arr.length) { const c = cost(arr); if (c < bestC) { bestC = c; best = arr.slice(); } return; }
    for (let i = l; i < arr.length; i++) { [arr[l], arr[i]] = [arr[i], arr[l]]; perm(arr, l + 1); [arr[l], arr[i]] = [arr[i], arr[l]]; } };
  perm(stops.slice(), 0);
  return { seq: best, cost: bestC };
}
function wpCell(wp) { const [x, y] = project(...wp.ll); return cellAt(x, y); }

async function planTraverse({ quiet = false } = {}) {
  if (S.busy) return;
  const status = $('planStatus');
  const fail = msg => { status.className = 'status-bar error'; status.textContent = msg; S.plan = null; renderPlan(); queueDraw(); return false; };
  let st; try { st = settings(); } catch (e) { return fail(e.message); }
  const wps = S.waypoints;
  if (!wps.length || wps[0].kind !== 'start') return fail('Set a start point first (Set start, then click the map).');
  if (wps.length < 2) return fail('Add at least one science stop.');
  const G = S.G, { mask, ob } = buildMask(st), idx = [];
  for (const wp of wps) {
    const i = wpCell(wp);
    if (i < 0) return fail(`${wp.label} is outside the numeric terrain coverage.`);
    if (!G.base[i]) return fail(`${wp.label} sits on DEM nodata — move it to a valid cell.`);
    if (ob[i]) return fail(`${wp.label} is inside a reported obstruction.`);
    if (!mask[i]) return fail(`${wp.label} is on a ${fmt(G.slope[i])}° cell, above the ${st.thr}° threshold. Move it, raise the threshold, or allow flagged cells.`);
    idx.push(i);
  }
  S.busy = true; $('planBtn').disabled = true; status.className = 'status-bar busy';
  try {
    const t0 = performance.now(), results = [];
    for (let k = 0; k < idx.length; k++) { status.textContent = `Searching 20 m grid from ${wps[k].label} (${k + 1}/${idx.length})…`; await frame(); results.push(search(G, mask, idx[k], idx, st)); }
    const C = idx.map((_, a) => idx.map((b) => results[a].dist[b]));
    const { seq, cost } = bestOrder(C, idx.length, st.ret, st.optimize);
    if (!Number.isFinite(cost)) {
      const bad = []; for (let a = 0; a < idx.length; a++) for (let b = 0; b < idx.length; b++) if (a !== b && !Number.isFinite(C[a][b])) bad.push(`${wps[a].label}→${wps[b].label}`);
      return fail(`No connected path for ${bad.slice(0, 3).join(', ')}${bad.length > 3 ? '…' : ''}. Flagged slopes or obstructions isolate a waypoint.`);
    }
    const order = [0, ...seq, ...(st.ret ? [0] : [])], legs = [];
    for (let k = 1; k < order.length; k++) { const a = order[k - 1], b = order[k]; legs.push({ from: a, to: b, ...legMetrics(G, extract(results[a].prev, idx[a], idx[b]), st) }); }
    const walkS = legs.reduce((s, l) => s + l.timeS, 0), stopsN = order.filter((q, k) => k > 0 && q !== 0).length;
    const plan = { st, order, legs, idx, ms: performance.now() - t0,
      signature: wps.map(w => w.id).join('|') + `|${st.objective}|${st.ret}`, obstacles: S.obstacles.length,
      distance: legs.reduce((s, l) => s + l.distance, 0), ascent: legs.reduce((s, l) => s + l.ascent, 0),
      walkMin: walkS / 60, stopMin: stopsN * st.stopMin, maxCell: Math.max(...legs.map(l => l.maxCell)), maxSeg: Math.max(...legs.map(l => l.maxSeg)),
      hazardCells: legs.reduce((s, l) => s + l.hazardCells, 0), nearCells: legs.reduce((s, l) => s + l.nearCells, 0) };
    plan.requiredMin = plan.walkMin + plan.stopMin + st.reserve; plan.margin = st.limit - plan.requiredMin;
    buildTimeline(plan);
    S.prevPlan = S.plan && S.plan.signature === plan.signature ? S.plan : null;
    S.plan = plan; S.play.t = 0; S.play.playing = false;
    status.className = 'status-bar ok';
    status.textContent = `Traverse ready · ${legs.length} legs · searched in ${fmt(plan.ms / 1000, 2)} s in this browser`;
    renderPlan(); renderRouteScience(); writeHash(); queueDraw(); if (S.v3) S.v3.setRoute();
    if (!quiet) toast(plan.margin >= 0 ? `Traverse fits the ${st.limit}-min limit with ${fmtMin(plan.margin)} spare` : `Traverse exceeds the EVA limit by ${fmtMin(-plan.margin)}`);
    return true;
  } catch (e) { return fail(e.message || String(e)); }
  finally { S.busy = false; $('planBtn').disabled = false; }
}
function buildTimeline(plan) {
  // flatten traverse into a time-indexed track: walking cells + dwell at stops
  const track = []; let t = 0, d = 0;
  plan.legs.forEach((leg, li) => {
    for (let k = (li ? 1 : 0); k < leg.prof.length; k++) { const p = leg.prof[k]; track.push({ t: t + p.t, d: d + p.d, i: p.i, leg: li, walking: true }); }
    t += leg.timeS; d += leg.distance;
    if (leg.to !== 0) { const i = leg.cells[leg.cells.length - 1]; track.push({ t, d, i, leg: li, stop: leg.to, walking: false }); t += plan.st.stopMin * 60; }
  });
  plan.track = track; plan.totalS = t; plan.totalD = d;
}

/* ---------- region activation ---------- */
async function activateRegion(key, { keepView = false } = {}) {
  S.regionKey = key; const r = DATA.regions[key]; S.region = r; S.G = buildGrid(r);
  S.layers = { imagery: S.layers.imagery,
    thermal: await loadImage(r.thermalPng), crism: await loadImage(r.crismPng),
    elevation: pixelLayer(S.G.elev, S.G.base, S.G.m.statistics.elevation_range_m, ELEV_RAMP),
    slope: pixelLayer(S.G.slope, S.G.base, [0, 30], SLOPE_RAMP),
    geology: r.geology.features.map(f => ({ f, path: geoPath(f.geometry), color: GEO_COLORS[(f.properties.style_index || 0) % 10], bbox: f.properties.source_bounds_map_m })),
  };
  S.hazardKey = ''; S.unitCache.clear(); S.plan = null; S.prevPlan = null; S.inspect = null;
  // keep waypoints/obstacles that still fall inside valid terrain
  const before = S.waypoints.length; S.waypoints = S.waypoints.filter(w => { const i = wpCell(w); return i >= 0 && S.G.base[i]; });
  if (S.waypoints.length && S.waypoints[0].kind !== 'start') S.waypoints = [];
  if (before && S.waypoints.length < before) toast(`${before - S.waypoints.length} waypoint(s) outside this coverage were removed`);
  S.obstacles = S.obstacles.filter(o => cellAt(o.x, o.y) >= 0);
  const m = S.G.m;
  $('coverageHint').textContent = `${m.width} × ${m.height} native 20 m cells · ${m.statistics.valid_elevation_cells.toLocaleString()} valid DEM cells · elevation ${fmt(m.statistics.elevation_range_m[0], 0)} to ${fmt(m.statistics.elevation_range_m[1], 0)} m`;
  $('stopSelect').innerHTML = '<option value="">+ Add SIM 3464 point…</option>' + r.stops.features.map(f => `<option value="${esc(f.id)}">${esc(f.properties.map_label)} · ${esc(f.properties.display_name)}</option>`).join('');
  renderWaypoints(); renderPlan(); renderRouteScience(); renderScienceContext(); renderSources(); renderHazardStats(); renderObstacles();
  $('inspectCard').innerHTML = '<div class="muted">Click the map to read the actual raster values at a 20 m cell.</div>';
  $('planStatus').className = 'status-bar'; $('planStatus').textContent = S.waypoints.length >= 2 ? 'Region changed · plan the traverse again.' : 'Add a start and at least one stop.';
  if (S.v3) S.v3.rebuild();
  if (!keepView) fit(); else queueDraw();
}
function pixelLayer(values, valid, range, stops) {
  const G = S.G, cv = document.createElement('canvas'); cv.width = G.w; cv.height = G.h;
  const ctx = cv.getContext('2d'), im = ctx.createImageData(G.w, G.h), [lo, hi] = range;
  for (let i = 0; i < values.length; i++) { if (!valid[i]) continue; const c = ramp(stops, (values[i] - lo) / (hi - lo)), p = i * 4; im.data[p] = c[0]; im.data[p+1] = c[1]; im.data[p+2] = c[2]; im.data[p+3] = 255; }
  ctx.putImageData(im, 0, 0); return cv;
}
function hazardLayer() {
  let st; try { st = settings(); } catch { return S.hazardLayer; }
  const key = `${S.regionKey}|${st.thr}`; if (key === S.hazardKey) return S.hazardLayer;
  const G = S.G, cv = document.createElement('canvas'); cv.width = G.w; cv.height = G.h;
  const ctx = cv.getContext('2d'), im = ctx.createImageData(G.w, G.h);
  for (let i = 0; i < G.n; i++) { const p = i * 4;
    if (!G.base[i]) { const r = (i / G.w) | 0, c = i % G.w; if ((r + c) % 4 < 2) { im.data[p] = 120; im.data[p+1] = 120; im.data[p+2] = 130; im.data[p+3] = 200; } }
    else if (G.slope[i] > st.thr) { im.data[p] = 229; im.data[p+1] = 56; im.data[p+2] = 61; im.data[p+3] = 230; }
    else if (G.slope[i] > st.thr * 0.8) { im.data[p] = 240; im.data[p+1] = 190; im.data[p+2] = 90; im.data[p+3] = 120; } }
  ctx.putImageData(im, 0, 0); S.hazardLayer = cv; S.hazardKey = key; return cv;
}
function geoPath(g) { const p = new Path2D(), polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
  for (const poly of polys) for (const ring of poly) { ring.forEach((q, i) => i ? p.lineTo(q[0], q[1]) : p.moveTo(q[0], q[1])); p.closePath(); } return p; }
function pointInRing(p, ring) { let inside = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const a = ring[i], b = ring[j]; if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside; } return inside; }
function unitAt(x, y) {
  for (const L of S.layers.geology) { const b = L.bbox; if (b && (x < b[0] || x > b[2] || y < b[1] || y > b[3])) continue;
    const g = L.f.geometry, polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
    for (const poly of polys) if (pointInRing([x, y], poly[0]) && poly.slice(1).every(h => !pointInRing([x, y], h))) return L.f; }
  return null;
}
function unitAtCell(i) { if (S.unitCache.has(i)) return S.unitCache.get(i); const u = unitAt(...S.G.xy(i)); S.unitCache.set(i, u); return u; }
function thermalAt(x, y) { const tm = S.region.thermalManifest, b = tm.bounds_map_m, c = Math.floor((x - b[0]) / (b[2] - b[0]) * tm.width), r = Math.floor((b[3] - y) / (b[3] - b[1]) * tm.height);
  if (c < 0 || r < 0 || c >= tm.width || r >= tm.height) return null; const v = S.G.thermal[r * tm.width + c]; return Number.isFinite(v) && v > 0 ? v : null; }

/* ---------- map rendering ---------- */
const canvas = () => $('map');
function size() { const b = canvas().getBoundingClientRect(); return { w: b.width, h: b.height }; }
function fitScale() { const { w, h } = size(), b = DATA.imagery.bounds; return Math.min((w - 40) / (b[2] - b[0]), (h - 40) / (b[3] - b[1])); }
const scale = () => fitScale() * S.view.zoom;
function fit() { const b = S.G.m.bounds_m, ib = DATA.imagery.bounds; S.view = { cx: (b[0] + b[2]) / 2, cy: (b[1] + b[3]) / 2, zoom: Math.min((ib[2]-ib[0]) / (b[2]-b[0]), (ib[3]-ib[1]) / (b[3]-b[1])) * 0.98 }; queueDraw(); }
const sx = x => size().w / 2 + (x - S.view.cx) * scale();
const sy = y => size().h / 2 - (y - S.view.cy) * scale();
function toMap(clientX, clientY) { const r = canvas().getBoundingClientRect(), s = scale(); return [S.view.cx + (clientX - r.left - r.width / 2) / s, S.view.cy - (clientY - r.top - r.height / 2) / s]; }
function queueDraw() { if (S.drawQueued) return; S.drawQueued = true; requestAnimationFrame(() => { S.drawQueued = false; draw(); }); }
function drawImg(ctx, img, b, alpha, smooth) { ctx.globalAlpha = alpha; ctx.imageSmoothingEnabled = smooth; ctx.drawImage(img, sx(b[0]), sy(b[3]), sx(b[2]) - sx(b[0]), sy(b[1]) - sy(b[3])); ctx.globalAlpha = 1; }
function draw() {
  const c = canvas(), rect = c.getBoundingClientRect(); if (!rect.width || !S.G) return;
  const dpr = Math.min(devicePixelRatio || 1, 2), W = Math.round(rect.width * dpr), H = Math.round(rect.height * dpr);
  if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
  const ctx = c.getContext('2d'), s = scale(), b = S.G.m.bounds_m, op = Number($('opacity').value) / 100;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.fillStyle = '#0b1110'; ctx.fillRect(0, 0, rect.width, rect.height);
  if ($('imageryOn').checked) drawImg(ctx, S.layers.imagery, DATA.imagery.bounds, 1, true);
  if ($('elevationOn').checked) drawImg(ctx, S.layers.elevation, b, op, false);
  if ($('slopeOn').checked) drawImg(ctx, S.layers.slope, b, op, false);
  if ($('thermalOn').checked) drawImg(ctx, S.layers.thermal, S.region.thermalManifest.bounds_map_m, op, false);
  if ($('crismOn').checked) drawImg(ctx, S.layers.crism, b, op, false);
  if ($('geologyOn').checked) {
    ctx.save(); ctx.setTransform(dpr * s, 0, 0, -dpr * s, dpr * (rect.width / 2 - S.view.cx * s), dpr * (rect.height / 2 + S.view.cy * s));
    ctx.globalAlpha = op * 0.75; ctx.lineWidth = 1 / s; ctx.strokeStyle = '#1e1e1a';
    for (const L of S.layers.geology) { ctx.fillStyle = L.color; ctx.fill(L.path, 'evenodd'); }
    ctx.globalAlpha = 0.9; for (const L of S.layers.geology) ctx.stroke(L.path); ctx.restore();
  }
  if ($('hazardOn').checked && hazardLayer()) drawImg(ctx, hazardLayer(), b, Math.max(op, .55), false);
  // coverage boundary
  ctx.strokeStyle = '#eff2dc'; ctx.lineWidth = 1.2; ctx.setLineDash([7, 5]); ctx.strokeRect(sx(b[0]), sy(b[3]), sx(b[2]) - sx(b[0]), sy(b[1]) - sy(b[3])); ctx.setLineDash([]);
  // obstacles
  for (const o of S.obstacles) { ctx.beginPath(); ctx.arc(sx(o.x), sy(o.y), Math.max(4, o.r * s), 0, Math.PI * 2); ctx.fillStyle = 'rgba(229,72,77,.28)'; ctx.fill(); ctx.strokeStyle = '#ff6b6b'; ctx.lineWidth = 2; ctx.setLineDash([4, 3]); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = '#ffd2ca'; ctx.font = 'bold 12px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('✕', sx(o.x), sy(o.y)); }
  // SIM points
  if ($('stopsOn').checked) for (const f of S.region.stops.features) { const [x, y] = f.geometry.coordinates, px = sx(x), py = sy(y);
    ctx.beginPath(); ctx.arc(px, py, 160 * s, 0, Math.PI * 2); ctx.strokeStyle = 'rgba(245,208,131,.35)'; ctx.lineWidth = 1; ctx.setLineDash([2, 3]); ctx.stroke(); ctx.setLineDash([]);
    ctx.beginPath(); ctx.arc(px, py, 4.5, 0, Math.PI * 2); ctx.fillStyle = '#f5d083'; ctx.fill(); ctx.strokeStyle = '#28251d'; ctx.lineWidth = 1.4; ctx.stroke();
    if (s > 0.06 && !S.waypoints.some(w => w.id === f.id)) { ctx.font = '600 10px system-ui'; ctx.fillStyle = '#fff3d6'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.strokeStyle = '#000a'; ctx.lineWidth = 3; ctx.strokeText(f.properties.map_label, px + 7, py); ctx.fillText(f.properties.map_label, px + 7, py); } }
  // previous plan ghost + plan
  if (S.prevPlan && S.plan && S.prevPlan.obstacles !== S.plan.obstacles) drawLegs(ctx, S.prevPlan, 'rgba(255,255,255,.35)', [5, 5], 2);
  if (S.plan) { drawLegs(ctx, S.plan, '#0b1110', [], 6); drawLegs(ctx, S.plan, OBJ_COLOR[S.plan.st.objective], [], 3); drawChevrons(ctx, S.plan); }
  // waypoints
  const order = S.plan ? S.plan.order : null;
  S.waypoints.forEach((wp, k) => { const [x, y] = project(...wp.ll), px = sx(x), py = sy(y);
    const label = wp.kind === 'start' ? 'S' : order ? String(order.indexOf(k)) : String(k);
    ctx.beginPath(); ctx.arc(px, py, 10, 0, Math.PI * 2); ctx.fillStyle = wp.kind === 'start' ? '#a6e3c3' : '#f2ad79'; ctx.fill(); ctx.strokeStyle = '#0d1a16'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = '#0d1a16'; ctx.font = 'bold 11px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(label, px, py + .5); });
  // playback astronaut
  const pos = S.plan && (S.hud || S.play.t > 0) ? trackAt(S.play.t) : null;
  if (pos) { const [x, y] = S.G.xy(pos.i), px = sx(x), py = sy(y); ctx.beginPath(); ctx.arc(px, py, 14, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,255,255,.18)'; ctx.fill();
    ctx.beginPath(); ctx.arc(px, py, 6, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = '#7c5cff'; ctx.lineWidth = 2.5; ctx.stroke(); }
  // inspect marker
  if (S.inspect) { const px = sx(S.inspect[0]), py = sy(S.inspect[1]); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(px - 9, py); ctx.lineTo(px - 3, py); ctx.moveTo(px + 3, py); ctx.lineTo(px + 9, py); ctx.moveTo(px, py - 9); ctx.lineTo(px, py - 3); ctx.moveTo(px, py + 3); ctx.lineTo(px, py + 9); ctx.stroke(); }
  drawScaleBar(ctx, rect, s); drawNorth(ctx, rect);
}
function drawLegs(ctx, plan, color, dash, width) {
  ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.setLineDash(dash);
  for (const leg of plan.legs) { ctx.beginPath(); leg.cells.forEach((i, k) => { const [x, y] = S.G.xy(i); k ? ctx.lineTo(sx(x), sy(y)) : ctx.moveTo(sx(x), sy(y)); }); ctx.stroke(); }
  ctx.setLineDash([]);
}
function drawChevrons(ctx, plan) {
  ctx.fillStyle = '#0d1a16';
  for (const leg of plan.legs) { const step = Math.max(8, Math.round(25 / Math.max(.05, scale() * 20)));
    for (let k = step; k < leg.cells.length - 1; k += step) { const [x0, y0] = S.G.xy(leg.cells[k - 1]), [x1, y1] = S.G.xy(leg.cells[k + 1]), a = Math.atan2(sy(y1) - sy(y0), sx(x1) - sx(x0)), px = sx(S.G.xy(leg.cells[k])[0]), py = sy(S.G.xy(leg.cells[k])[1]);
      ctx.save(); ctx.translate(px, py); ctx.rotate(a); ctx.beginPath(); ctx.moveTo(3.5, 0); ctx.lineTo(-2.5, -3); ctx.lineTo(-2.5, 3); ctx.closePath(); ctx.fill(); ctx.restore(); } }
}
function drawScaleBar(ctx, rect, s) {
  const target = 110 / s, pow = 10 ** Math.floor(Math.log10(target)), nice = [1, 2, 5, 10].map(k => k * pow).filter(v => v <= target).pop() || pow, px = nice * s;
  const x = rect.width - px - 18, y = rect.height - 18; ctx.fillStyle = '#0f1716cc'; ctx.fillRect(x - 8, y - 22, px + 16, 30);
  ctx.strokeStyle = '#eef'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x, y - 4); ctx.lineTo(x, y); ctx.lineTo(x + px, y); ctx.lineTo(x + px, y - 4); ctx.stroke();
  ctx.fillStyle = '#eef'; ctx.font = '11px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'; ctx.fillText(nice >= 1000 ? `${nice / 1000} km` : `${nice} m`, x + px / 2, y - 8);
}
function drawNorth(ctx, rect) { const x = rect.width - 74, y = 30; ctx.fillStyle = '#0f1716cc'; ctx.beginPath(); ctx.arc(x, y, 14, 0, 7); ctx.fill(); ctx.fillStyle = '#eef'; ctx.beginPath(); ctx.moveTo(x, y - 10); ctx.lineTo(x + 5, y + 4); ctx.lineTo(x, y + 1); ctx.lineTo(x - 5, y + 4); ctx.fill(); ctx.font = 'bold 8px system-ui'; ctx.textAlign = 'center'; ctx.fillText('N', x, y + 12); }

/* ---------- legend ---------- */
function renderLegend() {
  const items = [], st = (() => { try { return settings(); } catch { return { thr: 15 }; } })();
  const rampHTML = (stops, labels) => `<div class="ramp" style="background:linear-gradient(90deg,${stops.map(c => `rgb(${c})`).join(',')})"></div><div class="ramp-labels">${labels.map(l => `<span>${l}</span>`).join('')}</div>`;
  const er = S.G.m.statistics.elevation_range_m, tr = S.region.thermalManifest.range, cr = S.region.crismManifest.display_stretch;
  if ($('hazardOn').checked) items.push(`<div class="legend-item"><b>SLOPE HAZARD FLAG</b><div class="ramp-labels" style="justify-content:flex-start;gap:10px"><span><i class="sw" style="background:#e5383d"></i>&gt; ${st.thr}°</span><span><i class="sw" style="background:#f0be5a99"></i>${fmt(st.thr * .8)}–${st.thr}°</span><span><i class="sw" style="background:repeating-linear-gradient(90deg,#787882 0 3px,transparent 3px 6px)"></i>no data</span></div></div>`);
  if ($('elevationOn').checked) items.push(`<div class="legend-item"><b>CTX DEM ELEVATION · m (MARS DATUM)</b>${rampHTML(ELEV_RAMP, [fmt(er[0], 0), fmt((er[0] + er[1]) / 2, 0), fmt(er[1], 0)])}</div>`);
  if ($('slopeOn').checked) items.push(`<div class="legend-item"><b>DERIVED SLOPE · DEGREES</b>${rampHTML(SLOPE_RAMP, ['0', '7.5', '15', '22.5', '≥30'])}</div>`);
  if ($('thermalOn').checked) items.push(`<div class="legend-item"><b>THERMAL INERTIA · J m⁻² K⁻¹ s⁻½</b>${rampHTML(S.region.thermalManifest.legend.colors, S.region.thermalManifest.legend.labels)}<span>Native 100 m · range ${fmt(tr[0], 0)}–${fmt(tr[1], 0)} · not temperature</span></div>`);
  if ($('crismOn').checked) items.push(`<div class="legend-item"><b>CRISM D2300 · DIMENSIONLESS</b>${rampHTML([[76,111,168],[217,214,199],[196,87,47]], [cr[0], 0, cr[1]])}<span>Blank = outside footprint. Not mineral abundance.</span></div>`);
  if ($('geologyOn').checked) items.push(`<div class="legend-item"><b>USGS SIM 3464 GEOLOGIC UNITS</b><span>Click the map for the unit name · 100–200 m registration uncertainty</span></div>`);
  if (!items.length || (items.length === 1 && $('hazardOn').checked && $('imageryOn').checked)) items.push(`<div class="legend-item"><b>NASA MARS TREK · CTX IMAGERY</b><span>Optical mosaic; dashed box = 20 m numeric terrain coverage.</span></div>`);
  $('legendBody').innerHTML = items.join('');
}

/* ---------- inspector ---------- */
function inspect(x, y) {
  S.inspect = [x, y]; queueDraw();
  const i = cellAt(x, y), card = $('inspectCard'), ll = unproject(x, y);
  const hit = nearestStop(x, y);
  const stopHTML = hit ? `<div class="data-copy"><b>${esc(hit.properties.map_label)} · USGS SIM 3464 mapped small crater</b><div class="muted">Candidate stop · source registration uncertainty 100–200 m · not a ranked or safety-qualified site.</div><button data-add-stop="${esc(hit.id)}" style="margin-top:6px">Add ${esc(hit.properties.map_label)} as stop</button></div>` : '';
  if (i < 0) { card.innerHTML = stopHTML + `<div class="unavailable">${fmtLL(ll)} · outside numeric terrain coverage (imagery only).</div>`; bindAdd(card); return; }
  const G = S.G, cll = G.ll(i);
  if (!G.base[i]) { card.innerHTML = stopHTML + `<div class="unavailable">${fmtLL(cll)} · DEM nodata — no terrain values or safety claim possible.</div>`; bindAdd(card); return; }
  let st; try { st = settings(); } catch { st = { thr: 15 }; }
  const s = G.slope[i], cls = s > st.thr ? 'off' : s > st.thr * .8 ? 'warn' : '';
  const rows = [`<b>${fmtLL(cll)}</b><div class="muted">Row ${(i / G.w) | 0}, column ${i % G.w} · 20 m cell centre</div>`,
    `Elevation <b>${fmt(G.elev[i], 1)} m</b> · CTX DEM`,
    `Derived slope <b>${fmt(s, 1)}°</b> <span class="status-label ${cls}">${s > st.thr ? 'ABOVE THRESHOLD' : s > st.thr * .8 ? 'NEAR THRESHOLD' : 'BELOW THRESHOLD'}</span>`,
    G.crismValid[i] ? `CRISM D2300 <b>${fmt(G.crism[i], 4)}</b>${G.crism[i] >= S.region.crismManifest.p95 ? ' <span class="status-label warn">≥ SCENE P95</span>' : ''}<div class="muted">Observed spectral parameter — not a mineral identification.</div>` : 'CRISM D2300 <span class="muted">outside footprint / nodata</span>'];
  const th = thermalAt(x, y); if (th) rows.push(`Thermal inertia <b>${fmt(th, 0)} J m⁻² K⁻¹ s⁻½</b><div class="muted">Native 100 m · not temperature</div>`);
  const u = unitAt(x, y); if (u) rows.push(`Geologic unit <b>${esc(u.properties.map_unit)}</b> · ${esc(u.properties.unit_name || '')}<div class="muted">USGS SIM 3464 interpretation</div>`);
  const ob = S.obstacles.some(o => (x - o.x) ** 2 + (y - o.y) ** 2 <= o.r ** 2);
  if (ob) rows.push('<span class="status-label off">INSIDE REPORTED OBSTRUCTION</span>');
  card.innerHTML = stopHTML + rows.map(r => `<div class="data-copy">${r}</div>`).join('') + `<div class="form-actions"><button data-act="start">Set as start</button><button data-act="stop">Add as stop</button></div>`;
  card.querySelector('[data-act=start]').onclick = () => addWaypoint('start', cll);
  card.querySelector('[data-act=stop]').onclick = () => addWaypoint('stop', cll);
  bindAdd(card);
}
function bindAdd(el) { el.querySelectorAll('[data-add-stop]').forEach(b => b.onclick = () => addSimStop(b.dataset.addStop)); }
function nearestStop(x, y) { const s = scale(); let best = null, bd = Math.max(40, 14 / s); for (const f of S.region.stops.features) { const [fx, fy] = f.geometry.coordinates, d = Math.hypot(fx - x, fy - y); if (d < bd) { bd = d; best = f; } } return $('stopsOn').checked ? best : null; }

/* ---------- waypoints ---------- */
function snapLL(ll) { const [x, y] = project(...ll), i = cellAt(x, y); return i < 0 ? null : { i, ll: S.G.ll(i) }; }
function addWaypoint(kind, ll, meta = {}) {
  const sn = snapLL(ll); if (!sn) { toast('That point is outside the numeric terrain coverage'); return false; }
  if (!S.G.base[sn.i]) { toast('DEM has no data there — choose a valid cell'); return false; }
  if (kind === 'start') { const wp = { id: 'S' + (++S.wpSeq), kind, ll: sn.ll, label: 'Start', source: meta.source || 'user' };
    if (S.waypoints[0]?.kind === 'start') S.waypoints[0] = wp; else S.waypoints.unshift(wp); }
  else { if (S.waypoints.filter(w => w.kind === 'stop').length >= MAX_STOPS) { toast(`Up to ${MAX_STOPS} stops (exact order search)`); return false; }
    S.waypoints.push({ id: meta.id || 'W' + (++S.wpSeq), kind, ll: sn.ll, label: meta.label || `Stop ${S.waypoints.filter(w => w.kind === 'stop').length + 1}`, source: meta.source || 'user' }); }
  afterWaypointsChanged(); return true;
}
function addSimStop(id) { const f = S.region.stops.features.find(x => String(x.id) === String(id)); if (!f) return;
  if (S.waypoints.some(w => w.id === f.id)) { toast(`${f.properties.map_label} is already a stop`); return; }
  addWaypoint('stop', unproject(...f.geometry.coordinates), { id: f.id, label: f.properties.map_label, source: 'USGS SIM 3464' }); }
function afterWaypointsChanged() {
  renderWaypoints(); writeHash();
  if (S.plan) { S.plan = null; S.prevPlan = null; renderPlan(); }
  const ready = S.waypoints[0]?.kind === 'start' && S.waypoints.length >= 2;
  $('planStatus').className = 'status-bar'; $('planStatus').textContent = ready ? 'Ready — press Plan traverse.' : S.waypoints[0]?.kind === 'start' ? 'Add at least one stop.' : 'Set a start point.';
  queueDraw(); if (S.v3) S.v3.setRoute();
}
function renderWaypoints() {
  const list = $('wpList');
  if (!S.waypoints.length) { list.innerHTML = '<li class="empty">No waypoints yet — use <b>Set start</b> and <b>Add stop</b> on the map, or load the demo.</li>'; return; }
  const order = S.plan?.order;
  list.innerHTML = S.waypoints.map((w, k) => `<li><span class="wp-badge ${w.kind}">${w.kind === 'start' ? 'S' : order ? order.indexOf(k) : k}</span><div><b>${esc(w.label)}</b><small>${fmtLL(w.ll)} · ${esc(w.source)}</small></div><div class="wp-actions">${w.kind === 'stop' ? `<button data-up="${k}" aria-label="Move ${esc(w.label)} up" ${k <= 1 ? 'disabled' : ''}>↑</button>` : ''}<button data-zoom="${k}" aria-label="Show ${esc(w.label)} on map">◎</button><button data-del="${k}" aria-label="Remove ${esc(w.label)}">✕</button></div></li>`).join('');
  list.querySelectorAll('[data-del]').forEach(b => b.onclick = () => { S.waypoints.splice(+b.dataset.del, 1); afterWaypointsChanged(); });
  list.querySelectorAll('[data-up]').forEach(b => b.onclick = () => { const k = +b.dataset.up; [S.waypoints[k - 1], S.waypoints[k]] = [S.waypoints[k], S.waypoints[k - 1]]; afterWaypointsChanged(); });
  list.querySelectorAll('[data-zoom]').forEach(b => b.onclick = () => { const [x, y] = project(...S.waypoints[+b.dataset.zoom].ll); S.view.cx = x; S.view.cy = y; S.view.zoom = Math.max(S.view.zoom, 3); queueDraw(); });
}
function loadDemo() {
  const G = S.G, cp = G.m.control_points.find(p => p.row === p.col) || G.m.control_points[0];
  const st = (() => { try { return settings(); } catch { return { thr: 15 }; } })();
  S.waypoints = []; S.plan = null;
  addWaypoint('start', cp.lonlat, { source: 'verification control point' });
  const start = S.waypoints[0].ll;
  const cands = S.region.stops.features.map(f => ({ f, ll: unproject(...f.geometry.coordinates) })).map(o => ({ ...o, i: snapLL(o.ll)?.i ?? -1 }))
    .filter(o => o.i >= 0 && G.base[o.i] && G.slope[o.i] <= st.thr).sort((a, b) => haversine(start, a.ll) - haversine(start, b.ll)).slice(0, 3);
  cands.forEach(o => addSimStop(o.f.id));
  toast('Demo: centre control point + 3 nearest SIM 3464 points (not a scientific prioritisation)');
  planTraverse({ quiet: true });
}

/* ---------- obstacles ---------- */
function addObstacle(x, y) {
  if (cellAt(x, y) < 0) { toast('Obstructions can only be placed inside terrain coverage'); return; }
  S.obstacles.push({ x, y, r: Number($('obstacleRadius').value), id: Date.now() });
  renderObstacles(); queueDraw();
  if (S.plan) replan('Obstruction reported'); else toast('Obstruction recorded — routes will avoid it');
}
async function replan(reason) { const before = S.plan; const ok = await planTraverse({ quiet: true });
  if (ok && before) { const dd = S.plan.distance - before.distance, dt = S.plan.walkMin - before.walkMin; toast(`${reason} · re-routed: ${dd >= 0 ? '+' : ''}${fmt(dd, 0)} m, ${dt >= 0 ? '+' : ''}${fmt(dt, 1)} min walking`); } }
function renderObstacles() {
  $('obstacleList').innerHTML = S.obstacles.map((o, k) => `<div class="obstacle"><span>✕ Obstruction ${k + 1} · ${o.r} m · ${fmtLL(unproject(o.x, o.y))}</span><button data-ob="${k}" aria-label="Clear obstruction ${k + 1}">Clear</button></div>`).join('');
  $('obstacleList').querySelectorAll('[data-ob]').forEach(b => b.onclick = () => { S.obstacles.splice(+b.dataset.ob, 1); renderObstacles(); queueDraw(); writeHash(); if (S.plan) replan('Obstruction cleared'); });
  writeHash();
}
function renderHazardStats() {
  let st; try { st = settings(); } catch { return; }
  const G = S.G; let over = 0, near = 0, valid = 0; for (let i = 0; i < G.n; i++) if (G.base[i]) { valid++; if (G.slope[i] > st.thr) over++; else if (G.slope[i] > st.thr * .8) near++; }
  $('hazardStats').innerHTML = `<b>${fmt(100 * over / valid, 1)}%</b> of valid cells exceed ${st.thr}° · ${fmt(100 * near / valid, 1)}% within 20% of it · ${S.obstacles.length} reported obstruction(s)`;
}

/* ---------- results ---------- */
function renderPlan() {
  renderWaypoints();
  const p = S.plan, host = $('planSummary');
  if (!p) { host.innerHTML = '<p class="muted">No traverse planned yet.</p>'; $('profileHost').innerHTML = ''; $('legTable').innerHTML = ''; renderHudStatic(); return; }
  const st = p.st, over = p.margin < 0, total = Math.max(st.limit, p.requiredMin);
  const pct = m => `${100 * m / total}%`;
  let x = 0; const segs = []; p.legs.forEach((l, k) => { const wm = l.timeS / 60; segs.push(`<i class="walk" style="left:${pct(x)};width:${pct(wm)}"></i>`); x += wm; if (l.to !== 0) { segs.push(`<i class="stop" style="left:${pct(x)};width:${pct(st.stopMin)}"></i>`); x += st.stopMin; } });
  segs.push(`<i class="reserve" style="left:${pct(x)};width:${pct(st.reserve)}"></i>`, `<i class="limit" style="left:calc(${pct(st.limit)} - 1px)"></i>`);
  const delta = S.prevPlan && S.prevPlan !== p ? `<p class="delta">Δ vs previous plan: ${p.distance - S.prevPlan.distance >= 0 ? '+' : ''}${fmt(p.distance - S.prevPlan.distance, 0)} m · ${p.walkMin - S.prevPlan.walkMin >= 0 ? '+' : ''}${fmt(p.walkMin - S.prevPlan.walkMin, 1)} min walking (dashed white = previous route)</p>` : '';
  host.innerHTML = `<div class="summary-grid">
    <div class="metric"><b>${fmt(p.distance / 1000, 2)} km</b><small>total walk</small></div>
    <div class="metric"><b>${fmtMin(p.walkMin)}</b><small>est. walking</small></div>
    <div class="metric ${over ? 'bad' : 'good'}"><b>${over ? '−' : '+'}${fmtMin(Math.abs(p.margin)).replace('−','')}</b><small>${over ? 'over EVA limit' : 'margin to limit'}</small></div>
    <div class="metric"><b>${fmt(p.ascent, 0)} m</b><small>total ascent</small></div>
    <div class="metric ${p.maxCell > st.thr ? 'bad' : ''}"><b>${fmt(p.maxCell, 1)}°</b><small>max cell slope</small></div>
    <div class="metric ${p.hazardCells ? 'bad' : 'good'}"><b>${p.hazardCells}</b><small>cells &gt; ${st.thr}°</small></div></div>
    <div class="budget"><div class="timeline">${segs.join('')}</div><div class="budget-legend"><span><i style="background:rgba(140,219,203,.7)"></i>walking</span><span><i style="background:#f5d083"></i>stops ${st.stopMin} min each</span><span><i style="background:#56605e"></i>reserve ${st.reserve} min</span><span><i style="background:#ff7d6e"></i>EVA limit ${fmtMin(st.limit)}</span></div></div>
    <p class="hint">Required ${fmtMin(p.requiredMin)} of ${fmtMin(st.limit)} · objective: ${OBJ_LABEL[st.objective]}${st.optimize ? ' · order optimised' : ' · listed order'}${st.avoid ? ` · cells > ${st.thr}° impassable` : ` · flagged cells allowed`}${S.obstacles.length ? ` · ${S.obstacles.length} obstruction(s) avoided` : ''}.</p>${delta}`;
  $('profileHost').innerHTML = profileSVG(p);
  const name = k => esc(S.waypoints[k]?.label ?? '?');
  $('legTable').innerHTML = `<table class="legs"><thead><tr><th>Leg</th><th>Dist m</th><th>Walk</th><th>Ascent</th><th>Max °</th><th>Bearing</th></tr></thead><tbody>${p.legs.map((l, k) => { const a = S.G.ll(l.cells[0]), b = S.G.ll(l.cells[l.cells.length - 1]);
    return `<tr><td>${k + 1}. ${name(l.from)} → ${name(l.to)}</td><td>${fmt(l.distance, 0)}</td><td>${fmtMin(l.timeS / 60)}</td><td>${fmt(l.ascent, 0)}</td><td>${fmt(l.maxCell, 1)}</td><td>${fmt(bearing(a, b), 0)}°</td></tr>`; }).join('')}</tbody></table>`;
  renderHudStatic();
}
function profileSVG(p) {
  const W = 560, H = 150, L = 40, T = 10, B = 26, pts = [], hz = [], marks = []; let off = 0;
  p.legs.forEach(l => { l.prof.forEach(q => pts.push({ d: off + q.d, z: q.z, s: q.s })); off += l.distance; marks.push({ d: off, to: l.to }); });
  const maxD = Math.max(1, off), zs = pts.map(q => q.z), lo = Math.min(...zs), hi = Math.max(...zs), span = Math.max(1, hi - lo);
  const X = d => L + d / maxD * (W - L - 8), Y = z => T + (hi - z) / span * (H - T - B), thr = p.st.thr;
  pts.forEach(q => { if (q.s > thr) hz.push(`<line x1="${X(q.d)}" x2="${X(q.d)}" y1="${T}" y2="${H - B}" stroke="#e5484d" stroke-opacity=".35"/>`); else if (q.s > thr * .8) hz.push(`<line x1="${X(q.d)}" x2="${X(q.d)}" y1="${H - B - 6}" y2="${H - B}" stroke="#e5cc8d" stroke-opacity=".7"/>`); });
  const line = pts.map(q => `${X(q.d).toFixed(1)},${Y(q.z).toFixed(1)}`).join(' ');
  const area = `${L},${H - B} ${line} ${X(maxD)},${H - B}`;
  const mk = marks.map(m => `<line x1="${X(m.d)}" x2="${X(m.d)}" y1="${T}" y2="${H - B}" stroke="#f5d083" stroke-dasharray="2 3"/><text x="${X(m.d) - 3}" y="${T + 9}" fill="#f5d083" font-size="9" text-anchor="end">${m.to === 0 ? 'S' : p.order.indexOf(m.to)}</text>`).join('');
  const cursor = S.play.t > 0 ? (() => { const q = trackAt(S.play.t); return q ? `<line x1="${X(q.d)}" x2="${X(q.d)}" y1="${T}" y2="${H - B}" stroke="#fff" stroke-width="1.5"/>` : ''; })() : '';
  return `<svg class="profile" id="profileSvg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Elevation profile along the full traverse; red bands mark cells above ${thr} degrees">
   <polygon points="${area}" fill="${OBJ_COLOR[p.st.objective]}" fill-opacity=".12"/>${hz.join('')}<polyline points="${line}" fill="none" stroke="${OBJ_COLOR[p.st.objective]}" stroke-width="2"/>${mk}${cursor}
   <line x1="${L}" y1="${H - B}" x2="${W}" y2="${H - B}" stroke="#53625e"/><text x="4" y="${T + 8}" fill="#aab8b2" font-size="9">${fmt(hi, 0)} m</text><text x="4" y="${H - B}" fill="#aab8b2" font-size="9">${fmt(lo, 0)} m</text>
   <text x="${L}" y="${H - 8}" fill="#aab8b2" font-size="9">0 km</text><text x="${W - 8}" y="${H - 8}" fill="#aab8b2" font-size="9" text-anchor="end">${fmt(maxD / 1000, 2)} km · relief ${fmt(span, 0)} m</text></svg>
   <div class="budget-legend"><span><i style="background:#e5484d"></i>cell &gt; ${thr}°</span><span><i style="background:#e5cc8d"></i>within 20% of threshold</span><span><i style="background:#f5d083"></i>waypoint</span></div>`;
}
function renderRouteScience() {
  const host = $('routeScience'), p = S.plan;
  if (!p) { host.innerHTML = '<p class="muted">Plan a traverse to list the geologic units and spectral observations it crosses.</p>'; return; }
  const units = new Map(), G = S.G, p95 = S.region.crismManifest.p95, runs = []; let inCrism = 0, total = 0, run = null, off = 0, thMin = Infinity, thMax = -Infinity;
  p.legs.forEach(l => { l.prof.forEach((q, k) => { if (k === 0 && total) return; total++;
    const u = unitAtCell(q.i), key = u ? `${u.properties.map_unit}|${u.properties.unit_name || ''}` : 'Unmapped|outside SIM 3464 polygons'; units.set(key, (units.get(key) || 0) + 1);
    const th = thermalAt(...G.xy(q.i)); if (th) { thMin = Math.min(thMin, th); thMax = Math.max(thMax, th); }
    if (G.crismValid[q.i]) inCrism++;
    if (G.crismValid[q.i] && G.crism[q.i] >= p95) { if (!run) { run = { i: q.i, d: off + q.d, n: 0, max: 0 }; runs.push(run); } run.n++; run.max = Math.max(run.max, G.crism[q.i]); } else run = null; }); off += l.distance; });
  const unitRows = [...units.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => { const [u, name] = k.split('|'); return `<div class="unit-row"><span><b>${esc(u)}</b> ${esc(name)}</span><span>${fmt(100 * n / total, 0)}%</span></div><div class="bar-mini"><i style="width:${100 * n / total}%"></i></div>`; }).join('');
  const runRows = runs.slice(0, 8).map((r, k) => `<div class="candidate"><span><b>R${k + 1}</b> at ${fmt(r.d / 1000, 2)} km · ${r.n} cell(s) · peak D2300 ${fmt(r.max, 4)}</span><button data-run="${r.i}">Add as stop</button></div>`).join('');
  host.innerHTML = `<div class="card"><span class="status-label">GEOLOGIC UNITS CROSSED · SIM 3464</span><div style="margin-top:6px">${unitRows}</div><p class="source">Share of route cells by published map unit · 100–200 m registration uncertainty.</p></div>
    <div class="card"><span class="status-label warn">SPECTRAL REVIEW POINTS · CRISM D2300 ≥ SCENE P95</span><p class="data-copy">${fmt(100 * inCrism / total, 0)}% of route cells fall inside valid CRISM coverage. ${runs.length ? `${runs.length} stretch(es) cross cells at or above this scene's 95th percentile (${fmt(p95, 4)}).` : 'No route cells reach the scene 95th percentile.'}</p>${runRows}<p class="source">Statistical flag for team review when deciding unscheduled sampling stops — an observed 2.3 µm spectral parameter, not a mineral identification, abundance or resource.</p></div>
    ${Number.isFinite(thMin) ? `<div class="card"><span class="status-label">THERMAL INERTIA ALONG ROUTE</span><p class="data-copy">${fmt(thMin, 0)}–${fmt(thMax, 0)} J m⁻² K⁻¹ s⁻½ (THEMIS-derived, 100 m). Lower values usually indicate finer, less consolidated surface material; higher values rockier or indurated surfaces.</p></div>` : ''}`;
  host.querySelectorAll('[data-run]').forEach(b => b.onclick = () => { if (addWaypoint('stop', G.ll(+b.dataset.run), { label: 'Spectral review', source: 'CRISM D2300 ≥ p95 (route)' })) toast('Review point added — plan again to include it'); });
}
function screenCandidates() {
  const out = $('candidateResults'), start = S.waypoints[0]?.kind === 'start' ? S.waypoints[0].ll : null;
  if (!start) { out.textContent = 'Set a start point first.'; return; }
  const range = Number($('maxRange').value), maxSlope = Number($('maxBufferSlope').value);
  if (!(range > 0 && maxSlope >= 0 && maxSlope <= 90)) { out.textContent = 'Enter a positive range and a slope between 0 and 90°.'; return; }
  const G = S.G, b = G.m.bounds_m, found = [];
  for (const f of S.region.stops.features) {
    const [x, y] = f.geometry.coordinates, ll = unproject(x, y), d = haversine(start, ll); if (d > range * 1000) continue;
    if (x - 220 < b[0] || x + 220 > b[2] || y - 220 < b[1] || y + 220 > b[3]) continue;
    let max = 0, ok = true, n = 0; const cc = Math.floor((x - G.c) / G.a), rr = Math.floor((y - G.f) / G.e);
    for (let r = rr - 11; r <= rr + 11; r++) for (let c = cc - 11; c <= cc + 11; c++) { if (r < 0 || c < 0 || r >= G.h || c >= G.w) { ok = false; continue; } const i = r * G.w + c, [cx, cy] = G.xy(i); if (Math.hypot(cx - x, cy - y) > 200) continue; n++; if (!G.base[i]) { ok = false; continue; } max = Math.max(max, G.slope[i]); }
    if (ok && n && max <= maxSlope) found.push({ f, d, max, n });
  }
  found.sort((a, b) => a.d - b.d || a.max - b.max);
  out.innerHTML = found.length ? found.map((v, k) => `<div class="candidate"><span><b>${k + 1}. ${esc(v.f.properties.map_label)}</b> · ${fmt(v.d / 1000, 2)} km · buffer max ${fmt(v.max, 1)}° · ${v.n} cells</span><button data-add-stop="${esc(v.f.id)}">Add stop</button></div>`).join('') + '<p class="hint">Sorted by distance from start. Criteria filter only — not route access, science priority or safety.</p>' : 'No mapped points meet these criteria with complete 200 m DEM coverage.';
  bindAdd(out);
}
function renderScienceContext() {
  const r = S.region, gm = r.geologyManifest, cm = r.crismManifest, tm = r.thermalManifest, sm = r.stopManifest;
  $('scienceContext').innerHTML = `<div class="card"><span class="status-label">SIM 3464 · GEOLOGY</span><p class="data-copy">${gm.region_intersecting_feature_count ?? gm.pilot_intersecting_feature_count} published unit polygons intersect this region. Qualitative interpretation at ${esc(gm.map_scale)}.</p><p class="source">100–200 m registration uncertainty · ${esc(gm.source_license)}</p></div>
  <div class="card"><span class="status-label">CRISM · D2300 PARAMETER</span><p class="data-copy">${fmt(cm.valid_fraction * 100, 1)}% of grid cells have valid values. Observation ${esc(cm.observation_time_utc[0])} UTC (${esc(cm.product_id)}). Median ${fmt(cm.median, 4)}, p95 ${fmt(cm.p95, 4)}.</p><p class="source">Dimensionless spectral index — not mineral, deposit, water or safety classification.</p></div>
  <div class="card"><span class="status-label">THEMIS · THERMAL INERTIA</span><p class="data-copy">${tm.width} × ${tm.height} native 100 m pixels, ${fmt(tm.range[0], 0)}–${fmt(tm.range[1], 0)} ${esc(tm.unit)}.</p><p class="source">${esc(tm.source_title)} · ${esc(tm.published)}</p></div>
  <div class="card"><span class="status-label">SIM 3464 · SMALL-CRATER POINTS</span><p class="data-copy">${sm.intersecting_feature_count} mapped points in this region, usable as candidate stops.</p></div>`;
}
function renderSources() {
  const r = S.region, m = r.manifest, short = s => s ? `${s.slice(0, 12)}…${s.slice(-8)}` : 'not recorded';
  const rows = [['Region manifest', r.manifestHash], ['Elevation grid', m.outputs['elevation.f32']?.sha256], ['Slope grid', m.outputs['slope.f32']?.sha256], ['SIM 3464 archive', r.geologyManifest.source_archive_sha256], ['CRISM image', r.crismManifest.source_image_sha256], ['THEMIS TIFF', r.thermalManifest.source_sha256], ['Stop collection', r.stopManifest.feature_collection_sha256], ['MEDA ATS CSV', DATA.environment.meda.temperature_product.data_sha256], ['MEDA pressure CSV', DATA.environment.meda.pressure_product.data_sha256]];
  $('hashPanel').innerHTML = rows.map(([l, h]) => `<p>${esc(l)} SHA-256<br><code title="${esc(h)}">${esc(short(h))}</code></p>`).join('') + `<p>CTX imagery: ${DATA.imagery.manifest.tile_count} hash-recorded Mars Trek tiles.</p>`;
}
function renderEnvironment() {
  const e = DATA.environment, med = e.meda;
  $('medaPanel').innerHTML = `<span class="status-label">OBSERVED · PERSEVERANCE MEDA · SOL ${med.sol}</span><p class="data-copy">${esc(med.temperature_product.start_utc)} → ${esc(med.temperature_product.stop_utc)} UTC. Historical rover-local samples, not a regional or current weather map.</p>`;
  $('sensorSelect').innerHTML = med.temperature.map(s => `<option value="${esc(s.field)}">${esc(s.field.replace('ATS_LOCAL_TEMP', 'Air temperature sensor '))}</option>`).join('');
  $('dustContext').textContent = `${e.dust.date_label}. ${e.dust.summary} ${e.dust.limit}`;
  $('radContext').textContent = `${e.radiation.kind}. ${e.radiation.limit} ${e.radiation.reference}`;
  drawMeda();
}
function drawMeda() {
  const med = DATA.environment.meda, s = med.temperature.find(x => x.field === $('sensorSelect').value) || med.temperature[0];
  const c = $('medaChart'), ctx = c.getContext('2d'), W = c.width, H = c.height, lo = Math.floor(s.minimum / 5) * 5, hi = Math.ceil(s.maximum / 5) * 5, L = 70, T = 14, Bt = H - 34, Rt = W - 12;
  ctx.fillStyle = '#0e1514'; ctx.fillRect(0, 0, W, H); ctx.font = '11px system-ui'; ctx.textBaseline = 'middle';
  for (let v = lo; v <= hi; v += 10) { const y = T + (hi - v) / (hi - lo) * (Bt - T); ctx.strokeStyle = '#1f2b29'; ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(Rt, y); ctx.stroke(); ctx.fillStyle = '#aab8b2'; ctx.textAlign = 'right'; ctx.fillText(`${v} K / ${Math.round(v - 273.15)}°C`, L - 6, y); }
  ctx.textAlign = 'center'; for (let h = 0; h <= 24; h += 4) { const x = L + (Rt - L) * h / 24; ctx.fillStyle = '#aab8b2'; ctx.fillText(String(h).padStart(2, '0') + ':00', x, H - 20); }
  ctx.fillText('Local mean solar time', (L + Rt) / 2, H - 6);
  ctx.strokeStyle = '#85dfc8'; ctx.lineWidth = 2; ctx.beginPath(); let prev = null;
  for (const b of s.bins) { if (!b.count || b.mean === null) { prev = null; continue; } const x = L + (Rt - L) * (b.lmst_start_seconds + 150) / 86400, y = T + (hi - b.mean) / (hi - lo) * (Bt - T); if (prev && b.lmst_start_seconds - prev <= 600) ctx.lineTo(x, y); else ctx.moveTo(x, y); prev = b.lmst_start_seconds; }
  ctx.stroke();
  $('medaStats').innerHTML = `${esc(s.description)} · <b>${fmt(s.minimum, 1)} to ${fmt(s.maximum, 1)} K</b> (${fmt(s.minimum - 273.15, 0)} to ${fmt(s.maximum - 273.15, 0)} °C) · ${s.accepted.toLocaleString()} accepted samples. Line = five-minute means; gaps are not interpolated.<br>Pressure ${fmt(med.pressure.minimum, 1)}–${fmt(med.pressure.maximum, 1)} Pa (derived product, no per-row quality flags).`;
}

/* ---------- playback / HUD ---------- */
function trackAt(t) {
  const tr = S.plan?.track; if (!tr?.length) return null; t = clamp(t, 0, S.plan.totalS);
  let lo = 0, hi = tr.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (tr[m].t <= t) lo = m; else hi = m - 1; }
  return tr[lo];
}
function nextWaypointFrom(pos) {
  const p = S.plan, leg = p.legs[pos.leg]; if (!pos.walking) { const nl = p.legs[pos.leg + 1]; return nl ? { leg: nl, k: pos.leg + 1 } : null; }
  return { leg, k: pos.leg };
}
function renderHudStatic() {
  const p = S.plan, tl = $('hudTimeline');
  $('playBtn').disabled = !p; $('scrub').disabled = !p;
  if (!p) { tl.innerHTML = ''; updateHud(); return; }
  const total = Math.max(p.st.limit * 60, p.totalS + p.st.reserve * 60), pct = s => `${100 * s / total}%`; let x = 0; const segs = [];
  p.legs.forEach(l => { segs.push(`<i class="walk" style="left:${pct(x)};width:${pct(l.timeS)}"></i>`); x += l.timeS; if (l.to !== 0) { segs.push(`<i class="stop" style="left:${pct(x)};width:${pct(p.st.stopMin * 60)}"></i>`); x += p.st.stopMin * 60; } });
  segs.push(`<i class="limit" style="left:${pct(p.st.limit * 60)}"></i><i class="now" id="hudNow" style="left:0"></i>`); tl.innerHTML = segs.join(''); tl.dataset.total = total; updateHud();
}
function updateHud() {
  const p = S.plan;
  if (!p) { $('hudNext').textContent = 'NO PLAN'; $('hudNextSub').textContent = 'Plan a traverse first'; $('hudClock').textContent = '00:00'; $('hudClockSub').textContent = ''; $('hudState').textContent = 'STANDBY'; ['hudSlope', 'hudAhead', 'hudElev'].forEach(id => $(id).textContent = '—'); $('hudAlert').className = 'hud-alert'; return; }
  const pos = trackAt(S.play.t), G = S.G, here = G.ll(pos.i), st = p.st, nw = nextWaypointFrom(pos);
  const now = $('hudNow'); if (now) now.style.left = `${100 * S.play.t / Number($('hudTimeline').dataset.total)}%`;
  $('scrub').value = Math.round(1000 * S.play.t / p.totalS);
  $('hudClock').textContent = clock(S.play.t); const left = st.limit * 60 - S.play.t;
  $('hudClockSub').textContent = `${fmtMin(left / 60)} to limit · return reserve ${st.reserve} min`;
  if (nw) { const target = nw.leg.cells[nw.leg.cells.length - 1], tll = G.ll(target), dist = haversine(here, tll), brg = bearing(here, tll);
    const name = nw.leg.to === 0 ? 'HABITAT (START)' : `STOP ${p.order.indexOf(nw.leg.to)} · ${S.waypoints[nw.leg.to]?.label || ''}`;
    $('hudNext').textContent = name; $('hudNextSub').textContent = `${fmt(dist, 0)} m · bearing ${fmt(brg, 0)}°`; $('hudArrow').setAttribute('transform', `rotate(${brg} 50 50)`); }
  else { $('hudNext').textContent = 'TRAVERSE COMPLETE'; $('hudNextSub').textContent = `${fmt(p.distance / 1000, 2)} km walked`; }
  const s = G.slope[pos.i]; $('hudSlope').textContent = `SLOPE ${fmt(s, 1)}°`; $('hudSlope').className = 'chip' + (s > st.thr ? ' bad' : s > st.thr * .8 ? ' caution' : '');
  $('hudElev').textContent = `ELEV ${fmt(G.elev[pos.i], 0)} m`;
  // look ahead 200 m along track
  const tr = p.track; let k = tr.indexOf(pos), ahead = null; for (let j = k + 1; j < tr.length && tr[j].d - pos.d <= 200; j++) { const sj = G.slope[tr[j].i]; if (!ahead || sj > ahead.s) ahead = { s: sj, d: tr[j].d - pos.d }; }
  $('hudAhead').textContent = ahead ? `MAX AHEAD ${fmt(ahead.s, 1)}° in ${fmt(ahead.d, 0)} m` : 'AHEAD —'; $('hudAhead').className = 'chip' + (ahead && ahead.s > st.thr ? ' bad' : ahead && ahead.s > st.thr * .8 ? ' caution' : '');
  $('hudState').textContent = pos.walking ? 'WALKING' : 'SCIENCE STOP';
  const alert = $('hudAlert');
  if (left < st.reserve * 60 && S.play.t > 0) { alert.textContent = '⚠ RESERVE BREACHED · RETURN TO HABITAT'; alert.className = 'hud-alert show'; }
  else if (ahead && ahead.s > st.thr * .8) { alert.textContent = `CAUTION · ${fmt(ahead.s, 0)}° GRADIENT AHEAD`; alert.className = 'hud-alert show caution'; }
  else alert.className = 'hud-alert';
}
function tick(ts) {
  if (!S.play.playing) return;
  const dt = S.play.last ? (ts - S.play.last) / 1000 : 0; S.play.last = ts;
  S.play.t = Math.min(S.plan.totalS, S.play.t + dt * Number($('playSpeed').value));
  updateHud(); queueDraw(); if (S.v3) S.v3.follow();
  if (S.play.t >= S.plan.totalS) { setPlaying(false); toast('Traverse playback complete'); return; }
  requestAnimationFrame(tick);
}
function setPlaying(on) { if (!S.plan) return; if (on && S.play.t >= S.plan.totalS) S.play.t = 0; S.play.playing = on; S.play.last = 0; $('playBtn').textContent = on ? '❚❚ Pause' : '▶ Play traverse'; if (on) requestAnimationFrame(tick); }
function setHud(on) {
  S.hud = on; $('hud').classList.toggle('hidden', !on); $('hudBtn').classList.toggle('active', on); $('hudBtn').textContent = on ? 'Planner view' : 'Visor HUD';
  $('mapArea').classList.toggle('hud-on', on);
  if (on && !S.plan) toast('Plan a traverse to drive the HUD');
  if (on && S.plan && S.v3) S.v3.setCam('walk');
  if (!on) setPlaying(false);
  updateHud(); queueDraw();
}

/* ---------- 3D view (three.js loaded on demand) ---------- */
async function show3d(on) {
  S.active3d = on; $('tab2d').classList.toggle('active', !on); $('tab3d').classList.toggle('active', on);
  $('tab2d').setAttribute('aria-selected', String(!on)); $('tab3d').setAttribute('aria-selected', String(on));
  $('view3d').classList.toggle('hidden', !on); $('note3d').classList.toggle('hidden', !on); document.querySelector('.map-tools').classList.toggle('hidden', on); $('map').classList.toggle('hidden', on);
  document.querySelector('.mode-group').style.visibility = on ? 'hidden' : '';
  if (!on) { S.v3?.stop(); queueDraw(); return; }
  if (!S.v3) {
    $('view3d').innerHTML = '<p style="padding:20px;color:#1b120e">Loading 3D engine…</p>';
    try { const THREE = await import(THREE_URL); S.v3 = makeView3d(THREE); }
    catch (e) { $('view3d').innerHTML = '<p style="padding:20px;color:#1b120e;max-width:440px">The 3D view needs a one-time download of three.js from cdn.jsdelivr.net, which is unavailable. The 2D planner, HUD and all data remain fully functional offline.</p>'; return; }
  }
  S.v3.start();
}
function makeView3d(THREE) {
  const host = $('view3d'); host.innerHTML = '';
  const renderer = new THREE.WebGLRenderer({ antialias: true }); renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); host.appendChild(renderer.domElement);
  const scene = new THREE.Scene(), sky = new THREE.Color(0xc89d7e); scene.background = sky; scene.fog = new THREE.Fog(sky, 2500, 9000);
  const camera = new THREE.PerspectiveCamera(60, 1, 1, 30000);
  scene.add(new THREE.HemisphereLight(0xfff0e2, 0x5a3424, 1.6)); const sun = new THREE.DirectionalLight(0xffe0c0, 1.6); sun.position.set(-3000, 2500, 1500); scene.add(sun);
  let terrain, routeLine, markers = new THREE.Group(), walker; scene.add(markers);
  const st = { yaw: 0.5, pitch: 0.95, dist: 9000, target: new THREE.Vector3(), mode: 'orbit', raf: 0, exag: 1.5 };
  const G = () => S.G, zMid = () => (G().m.statistics.elevation_range_m[0] + G().m.statistics.elevation_range_m[1]) / 2;
  const toV = (i, lift = 0) => { const g = G(), [x, y] = g.xy(i), b = g.m.bounds_m; return new THREE.Vector3(x - (b[0] + b[2]) / 2, (g.elev[i] - zMid()) * st.exag + lift, -(y - (b[1] + b[3]) / 2)); };
  function rebuild() {
    if (terrain) { scene.remove(terrain); terrain.geometry.dispose(); terrain.material.map?.dispose(); terrain.material.dispose(); }
    const g = G(), b = g.m.bounds_m, geo = new THREE.PlaneGeometry(b[2] - b[0], b[3] - b[1], g.w - 1, g.h - 1); geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position; let fill = zMid();
    for (let i = 0; i < pos.count; i++) { const z = g.base[i] ? g.elev[i] : fill; pos.setY(i, (z - zMid()) * st.exag); }
    geo.computeVertexNormals();
    // crop the CTX mosaic to the DEM bounds for the texture
    const ib = DATA.imagery.bounds, img = S.layers.imagery, cv = document.createElement('canvas'); cv.width = cv.height = 2048; const cx = cv.getContext('2d');
    const sxp = img.width / (ib[2] - ib[0]), syp = img.height / (ib[3] - ib[1]);
    cx.drawImage(img, (b[0] - ib[0]) * sxp, (ib[3] - b[3]) * syp, (b[2] - b[0]) * sxp, (b[3] - b[1]) * syp, 0, 0, 2048, 2048);
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
    terrain = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, roughness: 1, metalness: 0 })); scene.add(terrain); setRoute();
  }
  function setRoute() {
    if (routeLine) { scene.remove(routeLine); routeLine.geometry.dispose(); routeLine = null; }
    markers.clear();
    S.waypoints.forEach((w, k) => { const i = wpCell(w); if (i < 0) return; const v = toV(i, 0), h = 140; const m = new THREE.Mesh(new THREE.CylinderGeometry(7, 7, h, 8), new THREE.MeshBasicMaterial({ color: w.kind === 'start' ? 0xa6e3c3 : 0xf2ad79 })); m.position.copy(v).add(new THREE.Vector3(0, h / 2, 0)); markers.add(m);
      const top = new THREE.Mesh(new THREE.SphereGeometry(22, 14, 10), m.material); top.position.copy(v).add(new THREE.Vector3(0, h + 14, 0)); markers.add(top); });
    for (const o of S.obstacles) { const i = cellAt(o.x, o.y); if (i < 0) continue; const ring = new THREE.Mesh(new THREE.TorusGeometry(o.r, 3, 6, 40), new THREE.MeshBasicMaterial({ color: 0xff5050 })); ring.rotation.x = Math.PI / 2; ring.position.copy(toV(i, 4)); markers.add(ring); }
    if (S.plan) { const pts = []; S.plan.legs.forEach(l => l.cells.forEach(i => pts.push(toV(i, 3)))); routeLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: OBJ_COLOR[S.plan.st.objective], linewidth: 2 })); scene.add(routeLine); }
    walker = new THREE.Mesh(new THREE.SphereGeometry(7, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffffff })); walker.visible = false; markers.add(walker);
  }
  function resize() { const r = host.getBoundingClientRect(); if (!r.width) return; renderer.setSize(r.width, r.height, false); camera.aspect = r.width / r.height; camera.updateProjectionMatrix(); }
  function follow() {
    if (!S.plan || st.mode !== 'walk') return; const tr = S.plan.track, pos = trackAt(S.play.t); if (!pos) return;
    const k = tr.indexOf(pos); let look = tr[Math.min(tr.length - 1, k + 6)]; if (look.i === pos.i) for (let j = k; j < tr.length; j++) if (tr[j].i !== pos.i) { look = tr[j]; break; }
    const eye = toV(pos.i, 1.8 * st.exag + 1.8), tgt = toV(look.i, 1.8 * st.exag + 1.8); if (look.i === pos.i) tgt.add(new THREE.Vector3(0, 0, -50));
    camera.position.lerp(eye, S.play.playing ? 0.35 : 1); const dir = tgt.sub(eye).normalize(); camera.lookAt(camera.position.clone().add(dir.multiplyScalar(100)));
    walker.visible = false;
  }
  function orbit() { const p = st.target.clone().add(new THREE.Vector3(Math.sin(st.yaw) * Math.cos(st.pitch), Math.sin(st.pitch), Math.cos(st.yaw) * Math.cos(st.pitch)).multiplyScalar(st.dist)); camera.position.copy(p); camera.lookAt(st.target);
    if (S.plan && S.play.t > 0) { const pos = trackAt(S.play.t); walker.position.copy(toV(pos.i, 10)); walker.visible = true; } }
  function loop() { st.raf = requestAnimationFrame(loop); resize(); scene.fog.near = st.mode === 'orbit' ? st.dist * 1.2 : 1500; scene.fog.far = st.mode === 'orbit' ? st.dist * 3 : 7000; if (st.mode === 'orbit') orbit(); else follow(); renderer.render(scene, camera); }
  // controls
  let drag = null; const el = renderer.domElement;
  el.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY }; el.setPointerCapture(e.pointerId); });
  el.addEventListener('pointermove', e => { if (!drag) return; const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag = { x: e.clientX, y: e.clientY };
    if (st.mode === 'orbit') { st.yaw -= dx * 0.005; st.pitch = clamp(st.pitch + dy * 0.005, 0.08, 1.45); } });
  el.addEventListener('pointerup', () => drag = null);
  el.addEventListener('wheel', e => { e.preventDefault(); st.dist = clamp(st.dist * (e.deltaY > 0 ? 1.1 : 0.9), 300, 16000); }, { passive: false });
  function setCam(mode) { st.mode = mode; $('cam3dOrbit').classList.toggle('active', mode === 'orbit'); $('cam3dWalk').classList.toggle('active', mode === 'walk');
    if (mode === 'walk' && !S.plan) { toast('Plan a traverse to walk it'); setCam('orbit'); return; } if (mode === 'walk') follow(); }
  rebuild();
  return { start() { cancelAnimationFrame(st.raf); loop(); }, stop() { cancelAnimationFrame(st.raf); }, rebuild, setRoute, follow, setCam,
    setExag(v) { st.exag = v; rebuild(); } };
}

/* ---------- URL state & export ---------- */
function writeHash() {
  if (!S.G) return; const q = new URLSearchParams(); q.set('r', S.regionKey);
  if (S.waypoints.length) q.set('w', S.waypoints.map(w => `${w.kind === 'start' ? 's' : 'p'}:${w.ll[0].toFixed(6)},${w.ll[1].toFixed(6)}:${encodeURIComponent(w.label)}${w.source === 'USGS SIM 3464' ? ':' + encodeURIComponent(w.id) : ''}`).join(';'));
  if (S.obstacles.length) q.set('o', S.obstacles.map(o => `${o.x.toFixed(1)},${o.y.toFixed(1)},${o.r}`).join(';'));
  ['objective', 'hazardThr', 'flatSpeed', 'evaLimit'].forEach(id => q.set(id, $(id).value));
  history.replaceState(null, '', '#' + q.toString());
}
function readHash() {
  const q = new URLSearchParams(location.hash.slice(1)); if (!q.size) return null;
  ['objective', 'hazardThr', 'flatSpeed', 'evaLimit'].forEach(id => { if (q.has(id)) $(id).value = q.get(id); });
  return q;
}
function applyHashWaypoints(q) {
  if (q.has('o')) S.obstacles = q.get('o').split(';').map(s => s.split(',').map(Number)).filter(a => a.every(Number.isFinite)).map(([x, y, r], k) => ({ x, y, r, id: k }));
  if (q.has('w')) for (const part of q.get('w').split(';')) { const [k, c, label, id] = part.split(':'), ll = (c || '').split(',').map(Number); if (ll.length !== 2 || !ll.every(Number.isFinite)) continue;
    if (k === 's') addWaypoint('start', ll); else addWaypoint('stop', ll, { label: decodeURIComponent(label || 'Stop'), id: id ? decodeURIComponent(id) : undefined, source: id ? 'USGS SIM 3464' : 'user' }); }
  renderObstacles();
}
function download(name, obj, type) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(obj, null, 2)], { type })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); }
function exportJson() {
  const p = S.plan; if (!p) { $('exportStatus').textContent = 'Plan a traverse first.'; return; }
  download('marswalk-traverse.json', { product: 'MARSWALK Field Systems', generated_utc: new Date().toISOString(), region: S.G.m.region_id || S.regionKey, region_manifest_sha256: S.region.manifestHash,
    assumptions: p.st, waypoints: S.waypoints.map(w => ({ label: w.label, kind: w.kind, lonlat: w.ll, source: w.source })), visit_order: p.order.map(k => S.waypoints[k].label),
    obstructions: S.obstacles.map(o => ({ lonlat: unproject(o.x, o.y), radius_m: o.r })),
    totals: { distance_m: p.distance, walking_min: p.walkMin, stop_min: p.stopMin, reserve_min: p.st.reserve, required_min: p.requiredMin, margin_min: p.margin, ascent_m: p.ascent, max_cell_slope_deg: p.maxCell, cells_above_threshold: p.hazardCells },
    legs: p.legs.map(l => ({ from: S.waypoints[l.from].label, to: S.waypoints[l.to].label, distance_m: l.distance, walking_min: l.timeS / 60, ascent_m: l.ascent, descent_m: l.descent, max_cell_slope_deg: l.maxCell, max_segment_slope_deg: l.maxSeg, path_lonlat: l.cells.map(i => S.G.ll(i)) })),
    interpretation: 'Planning demonstration derived from orbital data and user assumptions. Not a route-safety, EVA, landing, habitat, weather, radiation or resource determination.' }, 'application/json');
  $('exportStatus').textContent = 'Saved marswalk-traverse.json';
}
function exportGeo() {
  const p = S.plan; if (!p) { $('exportStatus').textContent = 'Plan a traverse first.'; return; }
  download('marswalk-traverse.geojson', { type: 'FeatureCollection', crs_note: 'Mars 2000 sphere, planetocentric latitude, positive-east longitude (degrees). Not Earth WGS84.',
    features: [...p.legs.map((l, k) => ({ type: 'Feature', properties: { leg: k + 1, from: S.waypoints[l.from].label, to: S.waypoints[l.to].label, distance_m: +l.distance.toFixed(1), walking_min: +(l.timeS / 60).toFixed(1) }, geometry: { type: 'LineString', coordinates: l.cells.map(i => S.G.ll(i)) } })),
      ...S.waypoints.map(w => ({ type: 'Feature', properties: { label: w.label, kind: w.kind, source: w.source }, geometry: { type: 'Point', coordinates: w.ll } }))] }, 'application/geo+json');
  $('exportStatus').textContent = 'Saved marswalk-traverse.geojson';
}
async function share() { writeHash(); try { await navigator.clipboard.writeText(location.href); $('exportStatus').textContent = 'Share link copied — it restores waypoints, obstructions and assumptions.'; } catch { $('exportStatus').textContent = 'Copy this address from the browser bar to share the plan.'; } }

/* ---------- challenge matrix ---------- */
function renderChallenge() {
  const rows = [
    ['Multi-layer data integration', 'yes', 'CTX imagery, CTX DEM elevation + slope, THEMIS thermal inertia, CRISM D2300 spectral parameter and USGS SIM 3464 geology on one Mars-projected grid, all independently toggled and sampled together in the inspector.'],
    ['Tactical safety & hazard avoidance', 'yes', 'Cells above an adjustable slope threshold (default 15°, the challenge benchmark) are flagged and impassable; DEM nodata is never treated as safe; near-threshold cells shown in amber.'],
    ['Scientific waypoint planning', 'yes', 'Start + up to 8 stops; exact search over every visiting order minimises total suited walking time (or distance/terrain cost) for routes linking ≥ 3 science targets.'],
    ['Interface adaptability (HUD)', 'yes', 'Visor HUD with bearing, distance, EVA clock, slope look-ahead and reserve alarms over the 2D map or 3D astronaut view; responsive tablet layout; exportable JSON/GeoJSON.'],
    ['Real-time hazard mitigation', 'yes', 'Mark an obstruction anywhere and the full traverse is recomputed locally (no Earth link) with the distance/time penalty shown and the old route ghosted.'],
    ['Spacesuit mobility', 'part', 'Slope-dependent pace (Tobler function scaled to a user-set suited flat speed) and slope limits; not a validated suit biomechanics or metabolic model.'],
    ['Science sampling correlation', 'part', 'Lists geologic units crossed and route stretches where observed CRISM D2300 ≥ scene p95, each addable as a stop. Spectral flags are not mineral identifications.'],
    ['Point-of-view imagery', 'part', '3D astronaut-eye render from the orbital DEM + CTX imagery along the route. Rover photographs are linked, but not yet position-matched to waypoints.'],
    ['Environment / radiation tracking', 'part', 'Historical Perseverance MEDA temperatures (sol 15), dated MARCI dust report and Gale RAD reference. No live forecast or Jezero radiation map exists, so none is shown.'],
    ['Ground-truth validation', 'no', 'Rover traverse logs are not yet imported to validate route viability.'],
  ];
  const lab = { yes: 'IMPLEMENTED', part: 'PARTIAL', no: 'NOT YET' };
  $('challengeTable').innerHTML = `<table class="cov"><thead><tr><th>Objective</th><th>Status</th><th>How MARSWALK addresses it</th></tr></thead><tbody>${rows.map(r => `<tr><td><b>${r[0]}</b></td><td><span class="pill ${r[1]}">${lab[r[1]]}</span></td><td>${r[2]}</td></tr>`).join('')}</tbody></table>`;
}

/* ---------- interaction ---------- */
const MODE_HINT = { inspect: '', start: 'Click inside the dashed boundary to set the start (habitat / lander)', stop: 'Click to add a science stop · crater points snap automatically', obstacle: 'Click where an obstruction blocks the way — the route recalculates' };
function setMode(m) { S.mode = m; document.querySelectorAll('.mode').forEach(b => b.classList.toggle('active', b.dataset.mode === m)); canvas().classList.toggle('picking', m !== 'inspect');
  const h = $('modeHint'); h.textContent = MODE_HINT[m]; h.classList.toggle('show', !!MODE_HINT[m]); }
function actAt(x, y) {
  if (S.mode === 'start') { if (addWaypoint('start', unproject(x, y))) { setMode('inspect'); toast('Start set'); } }
  else if (S.mode === 'stop') { const f = nearestStop(x, y); if (f) addSimStop(f.id); else addWaypoint('stop', unproject(x, y)); }
  else if (S.mode === 'obstacle') addObstacle(x, y);
  else inspect(x, y);
}
function setup() {
  ['imageryOn', 'hazardOn', 'elevationOn', 'slopeOn', 'thermalOn', 'crismOn', 'geologyOn', 'stopsOn'].forEach(id => $(id).addEventListener('change', () => { renderLegend(); queueDraw(); }));
  $('opacity').addEventListener('input', queueDraw);
  $('regionSelect').onchange = e => { activateRegion(e.target.value).then(writeHash); };
  document.querySelectorAll('.mode').forEach(b => b.onclick = () => setMode(S.mode === b.dataset.mode ? 'inspect' : b.dataset.mode));
  $('planBtn').onclick = () => planTraverse();
  $('demoBtn').onclick = loadDemo;
  $('stopSelect').onchange = e => { if (e.target.value) addSimStop(e.target.value); e.target.value = ''; };
  const coord = () => { const ll = [Number($('coordLon').value), Number($('coordLat').value)]; if (!ll.every(Number.isFinite)) { toast('Enter both longitude and latitude'); return null; } return ll; };
  $('coordStart').onclick = () => { const ll = coord(); if (ll) addWaypoint('start', ll); };
  $('coordStop').onclick = () => { const ll = coord(); if (ll) addWaypoint('stop', ll); };
  $('objective').onchange = () => { $('weightField').style.opacity = $('objective').value === 'terrain' ? 1 : .45; if (S.plan) planTraverse({ quiet: true }); writeHash(); };
  $('objective').onchange.call();
  ['hazardThr', 'avoidHazard'].forEach(id => $(id).addEventListener('change', () => { S.hazardKey = ''; renderHazardStats(); renderLegend(); queueDraw(); if (S.plan) planTraverse({ quiet: true }); writeHash(); }));
  ['flatSpeed', 'stopMinutes', 'reserve', 'evaLimit', 'weight', 'optimize', 'returnStart'].forEach(id => $(id).addEventListener('change', () => { if (S.plan) planTraverse({ quiet: true }); writeHash(); }));
  $('exportJson').onclick = exportJson; $('exportGeo').onclick = exportGeo; $('shareBtn').onclick = share;
  $('screenStops').onclick = screenCandidates; $('sensorSelect').onchange = drawMeda;
  document.querySelectorAll('.ptab').forEach(b => b.onclick = () => { document.querySelectorAll('.ptab').forEach(x => { x.classList.toggle('active', x === b); x.setAttribute('aria-selected', String(x === b)); }); document.querySelectorAll('.panel').forEach(p => p.classList.toggle('hidden', p.id !== b.dataset.panel)); });
  $('zoomIn').onclick = () => zoomBy(1.3); $('zoomOut').onclick = () => zoomBy(1 / 1.3); $('fitMap').onclick = fit;
  $('tab2d').onclick = () => show3d(false); $('tab3d').onclick = () => show3d(true);
  $('cam3dOrbit').onclick = () => S.v3?.setCam('orbit'); $('cam3dWalk').onclick = () => S.v3?.setCam('walk');
  $('exag').oninput = e => { $('exagVal').textContent = `${e.target.value}×`; S.v3?.setExag(Number(e.target.value)); };
  $('hudBtn').onclick = () => setHud(!S.hud); $('hudClose').onclick = () => setHud(false);
  $('playBtn').onclick = () => setPlaying(!S.play.playing);
  $('scrub').oninput = e => { if (!S.plan) return; S.play.t = S.plan.totalS * e.target.value / 1000; updateHud(); queueDraw(); S.v3?.follow(); };
  $('fullBtn').onclick = () => { const el = $('mapShell'); document.fullscreenElement ? document.exitFullscreen() : el.requestFullscreen?.().catch(() => toast('Fullscreen unavailable')); };
  $('legendToggle').onclick = () => { const c = $('legend').classList.toggle('collapsed'); $('legendToggle').setAttribute('aria-expanded', String(!c)); $('legendToggle').textContent = c ? 'Legend ▸' : 'Legend ▾'; };
  if (matchMedia('(max-width: 600px)').matches) $('legendToggle').onclick();
  $('helpBtn').onclick = () => $('helpDlg').showModal(); $('challengeBtn').onclick = () => $('challengeDlg').showModal();
  // map pointer handling (pan, pinch, click)
  const c = canvas();
  c.addEventListener('pointerdown', e => { c.setPointerCapture(e.pointerId); S.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (S.pointers.size === 2) { const [a, b] = [...S.pointers.values()]; S.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), zoom: S.view.zoom }; S.drag = null; }
    else S.drag = { x: e.clientX, y: e.clientY, cx: S.view.cx, cy: S.view.cy, moved: false }; c.classList.add('dragging'); });
  c.addEventListener('pointermove', e => {
    const [x, y] = toMap(e.clientX, e.clientY), ll = unproject(x, y), i = cellAt(x, y);
    $('cursorReadout').textContent = `${fmtLL(ll)} · ${i >= 0 && S.G.base[i] ? `${fmt(S.G.elev[i], 0)} m · ${fmt(S.G.slope[i], 1)}°` : 'imagery only'}`;
    if (!S.pointers.has(e.pointerId)) return; S.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (S.pinch && S.pointers.size === 2) { const [a, b] = [...S.pointers.values()]; S.view.zoom = clamp(S.pinch.zoom * Math.hypot(a.x - b.x, a.y - b.y) / S.pinch.d, .6, 60); queueDraw(); return; }
    if (S.drag) { const dx = e.clientX - S.drag.x, dy = e.clientY - S.drag.y; if (Math.abs(dx) + Math.abs(dy) > 4) S.drag.moved = true; if (S.drag.moved) { const s = scale(); S.view.cx = S.drag.cx - dx / s; S.view.cy = S.drag.cy + dy / s; queueDraw(); } }
  });
  const up = e => { const d = S.drag; S.pointers.delete(e.pointerId); if (S.pointers.size < 2) S.pinch = null; c.classList.remove('dragging');
    if (d && !d.moved && e.type === 'pointerup') actAt(...toMap(e.clientX, e.clientY)); S.drag = null; };
  c.addEventListener('pointerup', up); c.addEventListener('pointercancel', up);
  c.addEventListener('wheel', e => { e.preventDefault(); zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX, e.clientY); }, { passive: false });
  c.addEventListener('keydown', e => { const s = scale(), step = 80 / s;
    const k = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[e.key];
    if (k) { S.view.cx += k[0]; S.view.cy += k[1]; queueDraw(); e.preventDefault(); }
    else if (e.key === 'Enter' || e.key === ' ') { actAt(S.view.cx, S.view.cy); e.preventDefault(); } });
  document.addEventListener('keydown', e => { if (e.target.matches('input,select,textarea') || e.ctrlKey || e.metaKey || e.altKey || document.querySelector('dialog[open]')) return;
    const m = { i: 'inspect', s: 'start', w: 'stop', o: 'obstacle' }[e.key.toLowerCase()];
    if (m) setMode(m); else if (e.key === '+' || e.key === '=') zoomBy(1.3); else if (e.key === '-') zoomBy(1 / 1.3); else if (e.key.toLowerCase() === 'f') fit(); else if (e.key.toLowerCase() === 'h') setHud(!S.hud); else if (e.key === 'Escape') { setMode('inspect'); if (S.hud) setHud(false); } });
  new ResizeObserver(() => queueDraw()).observe($('mapArea'));
}
function zoomBy(f, cx, cy) { const r = canvas().getBoundingClientRect(); cx ??= r.left + r.width / 2; cy ??= r.top + r.height / 2; const before = toMap(cx, cy); S.view.zoom = clamp(S.view.zoom * f, .6, 60); const after = toMap(cx, cy); S.view.cx += before[0] - after[0]; S.view.cy += before[1] - after[1]; queueDraw(); }

/* ---------- boot ---------- */
async function boot() {
  try {
    await frame(); DATA = JSON.parse($('mars-data').textContent);
    $('bootText').textContent = 'Building 20 m terrain grids…'; await frame();
    S.layers.imagery = await loadImage(DATA.imagery.png);
    const q = readHash(); if (q?.get('r') && DATA.regions[q.get('r')]) { S.regionKey = q.get('r'); $('regionSelect').value = S.regionKey; }
    setup(); renderEnvironment(); renderChallenge();
    await activateRegion(S.regionKey); renderLegend();
    if (q) { applyHashWaypoints(q); if (S.waypoints.length >= 2) await planTraverse({ quiet: true }); }
    $('boot').classList.add('done'); setTimeout(() => $('boot').remove(), 500);
    let seen = false; try { seen = localStorage.getItem('marswalk-guide') === '1'; localStorage.setItem('marswalk-guide', '1'); } catch {}
    if (!seen && !q) $('helpDlg').showModal();
    queueDraw();
  } catch (e) { console.error(e); $('bootText').textContent = `Failed to start: ${e.message}`; document.querySelector('.boot-bar').remove(); }
}
window.MARSWALK = { S, planTraverse, addWaypoint, addSimStop, addObstacle: (lon, lat) => addObstacle(...project(lon, lat)), loadDemo, settings, paceFactor, bestOrder, trackAt, setHud, show3d, project };
boot();
})();
