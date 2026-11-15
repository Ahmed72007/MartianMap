/* MARSWALK sound engine — synthesized UI sounds (no audio files).
 * Every call varies pitch, timbre and timing slightly so repeated taps never sound identical.
 * Shared by index.html, field-operations.html and (inlined at build time) marswalk.html.
 * API: SFX.step() SFX.tap() SFX.toggle(on) SFX.select() SFX.place() SFX.success() SFX.error() SFX.whoosh(up) SFX.setMuted(bool) */
(function () {
  'use strict';
  if (window.SFX) return;
  const KEY = 'marswalk-sound-muted';
  const SCALE = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21]; // major pentatonic over two octaves: always consonant
  let ctx = null, master = null, wet = null, muted = false, lastNote = -1, lastTap = 0;
  try { muted = localStorage.getItem(KEY) === '1'; } catch (e) {}
  const reduce = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const rand = (a, b) => a + Math.random() * (b - a);
  const hz = semi => 440 * Math.pow(2, semi / 12);

  function init() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return ctx; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null;
    ctx = new AC();
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -18; comp.ratio.value = 4;
    master = ctx.createGain(); master.gain.value = 0.22; master.connect(comp); comp.connect(ctx.destination);
    // small stereo "glass room": two short feedback delays for a liquid shimmer tail
    wet = ctx.createGain(); wet.gain.value = 0.22;
    [[0.071, -0.6], [0.113, 0.6]].forEach(([t, pan]) => {
      const d = ctx.createDelay(1); d.delayTime.value = t; const fb = ctx.createGain(); fb.gain.value = 0.32;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3200;
      const p = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain(); if (p.pan) p.pan.value = pan;
      wet.connect(d); d.connect(lp); lp.connect(fb); fb.connect(d); lp.connect(p); p.connect(master);
    });
    return ctx;
  }
  function pickNote(base, range) { // avoid repeating the previous note
    let n; do { n = SCALE[Math.floor(Math.random() * range)]; } while (n === lastNote && range > 1);
    lastNote = n; return base + n;
  }
  function voice(freq, { type = 'sine', at = 0, dur = 0.12, gain = 0.5, attack = 0.004, glide = 0, cutoff = 6000, send = 0.5, pan = rand(-0.25, 0.25) } = {}) {
    const t = ctx.currentTime + at, o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
    o.type = type; o.frequency.setValueAtTime(freq, t); o.detune.value = rand(-9, 9);
    if (glide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * glide), t + dur);
    f.type = 'lowpass'; f.frequency.value = cutoff; f.Q.value = rand(0.5, 2.5);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let out = g; if (ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = pan; g.connect(p); out = p; }
    o.connect(f); f.connect(g); out.connect(master); if (send) { const s = ctx.createGain(); s.gain.value = send; out.connect(s); s.connect(wet); }
    o.start(t); o.stop(t + dur + 0.05);
  }
  function noise(dur, { at = 0, gain = 0.2, from = 800, to = 4000, q = 1.2 } = {}) {
    const t = ctx.currentTime + at, len = Math.ceil(ctx.sampleRate * dur), buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = buf; f.type = 'bandpass'; f.Q.value = q; f.frequency.setValueAtTime(from, t); f.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + dur * 0.3); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(master); const s = ctx.createGain(); s.gain.value = 0.4; g.connect(s); s.connect(wet); src.start(t);
  }
  function haptic(ms) { try { if (navigator.vibrate && matchMedia('(pointer:coarse)').matches) navigator.vibrate(ms); } catch (e) {} }
  function play(fn, vib) { if (muted || !init()) return; try { fn(); } catch (e) {} if (vib) haptic(vib); }

  const SFX = {
    get muted() { return muted; },
    setMuted(m) { muted = !!m; try { localStorage.setItem(KEY, muted ? '1' : '0'); } catch (e) {} document.querySelectorAll('[data-sound-toggle]').forEach(syncToggle); if (!muted) SFX.toggle(true); },
    /** soft glassy tap — random pentatonic note, alternating timbre */
    tap() { const now = performance.now(); if (now - lastTap < 35) return; lastTap = now;
      play(() => { const f = hz(pickNote(3, 6)); voice(f, { type: Math.random() < 0.5 ? 'sine' : 'triangle', dur: rand(0.07, 0.12), gain: 0.32, cutoff: rand(2500, 5000), send: 0.35 }); voice(f * 2.01, { dur: 0.05, gain: 0.08, send: 0.2 }); }, 6); },
    /** two-note step: rising for on, falling for off */
    toggle(on) { play(() => { const b = pickNote(0, 5), a = hz(b), c = hz(b + (on ? rand(0, 1) < 0.5 ? 5 : 7 : -5)); voice(a, { dur: 0.09, gain: 0.28, type: 'triangle' }); voice(c, { at: 0.06, dur: 0.14, gain: 0.3 }); }, 8); },
    /** choice made (tab, select, layer) — bright bell with random interval */
    select() { play(() => { const b = pickNote(5, 6); voice(hz(b), { dur: 0.22, gain: 0.26, send: 0.6 }); voice(hz(b + [4, 7, 9][Math.floor(Math.random() * 3)]), { at: rand(0.03, 0.05), dur: 0.26, gain: 0.18, send: 0.7 }); }, 8); },
    /** liquid droplet — fast downward pitch glide, randomized size */
    place() { play(() => { const f = rand(900, 1500); voice(f, { dur: rand(0.12, 0.18), gain: 0.38, glide: rand(0.35, 0.5), attack: 0.002, send: 0.7 }); voice(f * 1.5, { at: 0.05, dur: 0.09, gain: 0.12, glide: 0.6, send: 0.8 }); }, 12); },
    /** success — random ascending pentatonic arpeggio */
    success() { play(() => { const base = rand(0, 1) < 0.5 ? -5 : 0, steps = [0, 2, 4, 5].map(i => SCALE[i]); if (Math.random() < 0.5) steps[1] = SCALE[3];
      steps.forEach((s, i) => voice(hz(base + s), { at: i * rand(0.06, 0.085), dur: 0.5, gain: 0.22, type: i % 2 ? 'triangle' : 'sine', send: 0.8 })); }, [10, 40, 10]); },
    /** gentle error — soft low minor-second pair */
    error() { play(() => { const b = rand(-26, -22); voice(hz(b), { dur: 0.2, gain: 0.35, type: 'square', cutoff: 700, send: 0.2 }); voice(hz(b - 1), { at: 0.11, dur: 0.24, gain: 0.3, type: 'square', cutoff: 600, send: 0.2 }); }, [30, 30, 30]); },
    /** soft regolith footstep — randomized crunch, never the same twice */
    step() { if (muted || !ctx) return; play(() => { noise(rand(0.05, 0.09), { gain: rand(0.05, 0.09), from: rand(260, 420), to: rand(120, 200), q: rand(0.6, 1.4) }); }); },
    /** airy whoosh for opening/closing panels and views */
    whoosh(up = true) { if (reduce()) return; play(() => noise(rand(0.22, 0.32), { gain: 0.16, from: up ? 500 : 3500, to: up ? 3500 : 500, q: rand(0.8, 1.6) })); },
  };
  function syncToggle(b) { b.setAttribute('aria-pressed', String(!muted)); b.title = muted ? 'Sound off — click to enable' : 'Sound on — click to mute'; b.textContent = muted ? '🔇' : '🔊'; }
  window.SFX = SFX;
  // Auto-wire: every button/tab/link/select/checkbox gets an appropriate, varied sound.
  document.addEventListener('pointerdown', e => {
    // checkboxes and selects sound on change instead, so each interaction plays exactly one sound
    const el = e.target.closest('button,a,[role=tab],summary,input[type=range]'); if (!el || el.disabled || el.dataset.sfx === 'none') return;
    if (el.dataset.sfx && SFX[el.dataset.sfx]) return; // explicit sound fires on click instead
    SFX.tap();
  }, { passive: true, capture: true });
  document.addEventListener('click', e => { const el = e.target.closest('[data-sfx]'); if (el && !el.disabled && SFX[el.dataset.sfx]) SFX[el.dataset.sfx](); }, true);
  document.addEventListener('change', e => { const el = e.target; if (el.matches('input[type=checkbox]')) SFX.toggle(el.checked); else if (el.matches('select')) SFX.select(); }, true);
  const wire = () => document.querySelectorAll('[data-sound-toggle]').forEach(b => { syncToggle(b); b.dataset.sfx = 'none'; b.addEventListener('click', () => SFX.setMuted(!muted)); });
  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', wire) : wire();
})();
