'use strict';
/* ============================================================================
   Lissajous Curve — Four Musical Notes · Keyboard Interface (web port)
   Faithful JS/Canvas/Web-Audio/Web-MIDI port of lissajous_keyboard.py
   ==========================================================================*/

// ---------------------------------------------------------------------------
// Note names & interval labels
// ---------------------------------------------------------------------------
const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];

const INTERVAL_NAMES = {
  '1/1':'Unison',    '16/15':'Minor 2nd',
  '9/8':'Major 2nd', '6/5':'Minor 3rd',
  '5/4':'Major 3rd', '4/3':'Perfect 4th',
  '45/32':'Tritone', '64/45':'Tritone',
  '3/2':'Perfect 5th','8/5':'Minor 6th',
  '5/3':'Major 6th', '16/9':'Minor 7th',
  '9/5':'Minor 7th', '15/8':'Major 7th',
  '2/1':'Octave',    '3/1':'Oct + 5th',
  '4/1':'Two Octaves',
};

// ---------------------------------------------------------------------------
// Temperament systems (anchored: A4 = 440 Hz)
// ---------------------------------------------------------------------------
const _F5 = [0, 7, 2, 9, 4, -1, 6, 1, 8, 3, 10, 5]; // semitone -> fifths above C

function _pyth(n) {
  let r = Math.pow(3 / 2, Math.abs(n));
  if (n < 0) r = 1.0 / r;
  while (r >= 2.0) r /= 2.0;
  while (r < 1.0) r *= 2.0;
  return r;
}
function _mt(n) {
  let r = Math.pow(5.0, n / 4.0);
  while (r >= 2.0) r /= 2.0;
  while (r < 1.0) r *= 2.0;
  return r;
}
const _W3 = [0, 90.225, 192.18, 294.135, 390.225, 498.045,
             588.27, 696.09, 792.18, 888.27, 996.09, 1092.18];
const _K3 = [0, 90.225, 193.157, 294.135, 386.314, 498.045,
             590.224, 696.578, 792.18, 889.735, 996.09, 1088.269];

const TEMPERAMENTS = {
  'Equal  (12-TET)':  Array.from({length:12}, (_,n)=>Math.pow(2, n/12)),
  'Just  (5-limit)':  [1, 16/15, 9/8, 6/5, 5/4, 4/3, 45/32, 3/2, 8/5, 5/3, 9/5, 15/8],
  'Pythagorean':      _F5.map(_pyth),
  '¼-Comma Meantone': _F5.map(_mt),
  'Well temperament (1691)':    _W3.map(c => Math.pow(2, c / 1200)),
  'Well temperament (c. 1779)': _K3.map(c => Math.pow(2, c / 1200)),
};
const TEMP_NAMES = Object.keys(TEMPERAMENTS);

const TEMP_DESCRIPTIONS = {
  'Equal  (12-TET)':
    'All semitones identical: ratio = 2^(1/12).  Universal modern standard — every key sounds the same.',
  'Just  (5-limit)':
    'Pure intervals built from integer ratios (5/4, 3/2, …).  Perfectly consonant in one key; beating in others.',
  'Pythagorean':
    'Stacked pure perfect 5ths (3/2).  Brilliant 5ths; major 3rds are noticeably sharp (81/64 ≈ 408 ¢).',
  '¼-Comma Meantone':
    'Narrows each 5th by ¼ syntonic comma so four 5ths = exact 5/4.  Sweet major 3rds; a "wolf" 5th on G#–Eb.',
  'Well temperament (1691)':
    'Werckmeister III: four 5ths narrow by ¼ Pythagorean comma.  All 12 keys usable; "home" keys sound purer and warmer.',
  'Well temperament (c. 1779)':
    'Kirnberger III: C–E pure (5/4); gentle gradation.  Smooth in flat keys; brighter toward sharps.',
};

function noteFreq(name, octave, temperament) {
  const ratios = TEMPERAMENTS[temperament];
  const semitone = NOTE_NAMES.indexOf(name);
  const aRatio = ratios[9];
  const c4Hz = 440.0 / aRatio;
  return c4Hz * Math.pow(2, octave - 4) * ratios[semitone];
}

// ---------------------------------------------------------------------------
// Rational approximation (mirrors Python Fraction.limit_denominator)
// ---------------------------------------------------------------------------
function limitDenominator(x, maxDen) {
  if (!isFinite(x)) return [1, 1];
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x);
  let a0 = Math.floor(x);
  let h0 = a0, k0 = 1;   // last convergent
  let h1 = 1, k1 = 0;    // previous convergent
  let frac = x - a0;
  let iter = 0;
  while (frac > 1e-10 && iter < 40) {
    iter++;
    const xInv = 1 / frac;
    const a = Math.floor(xInv);
    const h2 = a * h0 + h1, k2 = a * k0 + k1;
    if (k2 > maxDen) {
      const aMax = Math.floor((maxDen - k1) / k0);
      let best = [h0, k0];
      if (aMax >= 1) {
        const hs = aMax * h0 + h1, ks = aMax * k0 + k1;
        if (Math.abs(hs / ks - x) < Math.abs(h0 / k0 - x)) best = [hs, ks];
      }
      return [sign * best[0], best[1]];
    }
    h1 = h0; k1 = k0; h0 = h2; k0 = k2;
    frac = xInv - a;
  }
  return [sign * h0, k0];
}

function describeRatio(f1, f2) {
  const ratio = f1 / f2;
  let s, key;
  if (ratio >= 1) {
    const [n, d] = limitDenominator(ratio, 48);
    s = `${n}:${d}`; key = `${n}/${d}`;
  } else {
    const [n, d] = limitDenominator(1 / ratio, 48);
    s = `${d}:${n}`; key = `${n}/${d}`;
  }
  return [s, INTERVAL_NAMES[key] || ''];
}

// ---------------------------------------------------------------------------
// Lissajous computation
// ---------------------------------------------------------------------------
function gcd(a, b) { a = Math.abs(a); b = Math.abs(b); while (b) { [a, b] = [b, a % b]; } return a; }
function lcm(a, b) { return Math.abs(a * b) / gcd(a, b); }
function gcdArr(arr) { return arr.reduce((a, b) => gcd(a, b)); }
function lcmArr(arr) { return arr.reduce((a, b) => lcm(a, b)); }

function period(freqs, maxDenom = 24, cap = 96) {
  const fMin = Math.min(...freqs);
  const fracs = freqs.map(f => limitDenominator(f / fMin, maxDenom)); // [num,den], ratio>=1
  const inv = fracs.map(([n, d]) => [d, n]);                          // Fraction(den, num)
  const lcmN = lcmArr(inv.map(([n]) => n));
  const gcdD = gcdArr(inv.map(([, d]) => d));
  return Math.min(lcmN / gcdD, cap);
}

const N_POINTS = 4000;

function lissajous4(freqs, phiX, phiXY) {
  const fMin = Math.min(...freqs);
  const r = freqs.map(f => f / fMin);
  const T = period(freqs);
  const n = N_POINTS;
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  const dt = (2 * Math.PI * T) / (n - 1);
  let xMax = 1e-12, yMax = 1e-12;
  for (let i = 0; i < n; i++) {
    const t = i * dt;
    const xv = Math.sin(r[0] * t) + Math.sin(r[1] * t + phiX);
    const yv = Math.sin(r[2] * t + phiXY) + Math.sin(r[3] * t + phiXY);
    x[i] = xv; y[i] = yv;
    if (Math.abs(xv) > xMax) xMax = Math.abs(xv);
    if (Math.abs(yv) > yMax) yMax = Math.abs(yv);
  }
  for (let i = 0; i < n; i++) { x[i] /= xMax; y[i] /= yMax; }
  return [x, y];
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const state = {
  notes: ['A', 'E', 'D', 'A'],
  octs: [4, 5, 5, 5],
  phiX: 0.0,
  phiXY: Math.PI / 4,
  temp: TEMP_NAMES[0],
  activeSlot: 0,
  baseOctave: 4,
  animPhiX: false,
  animPhiXY: false,
};

const NOTE_COLS = ['#ff6644', '#ffbb44', '#44ddbb', '#4499ff'];

// ---------------------------------------------------------------------------
// Computer-keyboard mapping (standard DAW virtual-piano layout)
// ---------------------------------------------------------------------------
const KB_MAP = {
  a: [0, 0], w: [1, 0], s: [2, 0], e: [3, 0],
  d: [4, 0], f: [5, 0], t: [6, 0], g: [7, 0],
  y: [8, 0], h: [9, 0], u: [10, 0], j: [11, 0],
  k: [0, 1], o: [1, 1], l: [2, 1], p: [3, 1],
};

// ---------------------------------------------------------------------------
// Piano geometry
// ---------------------------------------------------------------------------
const PIANO_OCT_LOW = 3, PIANO_OCT_HIGH = 6;
const N_WHITE = (PIANO_OCT_HIGH - PIANO_OCT_LOW + 1) * 7; // 28
const _WHITE_SEMI = [0, 2, 4, 5, 7, 9, 11];
const _BLACK_SEMI = [1, 3, 6, 8, 10];
const _BLACK_X_OFF = { 1: 0.65, 3: 1.65, 6: 3.65, 8: 4.65, 10: 5.65 };
const BK_W = 0.65;

function buildPianoKeys() {
  const keys = [];
  let wIdx = 0;
  for (let oct = PIANO_OCT_LOW; oct <= PIANO_OCT_HIGH; oct++) {
    const octStart = wIdx;
    for (const semi of _WHITE_SEMI) {
      keys.push({ note: NOTE_NAMES[semi], octave: oct, semi, x: wIdx, w: 1.0, isBlack: false });
      wIdx++;
    }
    for (const semi of _BLACK_SEMI) {
      keys.push({ note: NOTE_NAMES[semi], octave: oct, semi, x: octStart + _BLACK_X_OFF[semi], w: BK_W, isBlack: true });
    }
  }
  return keys;
}

const pianoKeys = buildPianoKeys();

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------
const $ = (sel) => document.querySelector(sel);
const pianoEl = $('#piano');
const slotsLeftEl = $('#slotsLeft');
const slotsRightEl = $('#slotsRight');
const curveCanvas = $('#curve');
const curveCtx = curveCanvas.getContext('2d');
const curveTitleEl = $('#curveTitle');
const xLabelEl = $('#xLabel');
const yLabelEl = $('#yLabel');
const tempRowEl = $('#tempRow');
const tempDescEl = $('#tempDesc');
const midiStatusEl = $('#midiStatus');

// ---------------------------------------------------------------------------
// Piano DOM build
// ---------------------------------------------------------------------------
const pianoKeyEls = {}; // "note|octave" -> element
const shortcutEls = {}; // kb key -> element
const octLabelEls = {}; // octave -> element
let octUnderlineEl;

function initPiano() {
  const whiteW = 100 / N_WHITE; // percent
  // white keys first
  for (const k of pianoKeys) {
    if (k.isBlack) continue;
    const el = document.createElement('div');
    el.className = 'wkey';
    el.style.left = `${k.x * whiteW}%`;
    el.style.width = `${k.w * whiteW}%`;
    el.dataset.note = k.note; el.dataset.octave = k.octave;
    el.addEventListener('pointerdown', () => assignNoteToActiveSlot(k.note, k.octave));
    pianoEl.appendChild(el);
    pianoKeyEls[`${k.note}|${k.octave}`] = el;
  }
  for (const k of pianoKeys) {
    if (!k.isBlack) continue;
    const el = document.createElement('div');
    el.className = 'bkey';
    el.style.left = `${k.x * whiteW}%`;
    el.style.width = `${k.w * whiteW}%`;
    el.dataset.note = k.note; el.dataset.octave = k.octave;
    el.addEventListener('pointerdown', (ev) => { ev.stopPropagation(); assignNoteToActiveSlot(k.note, k.octave); });
    pianoEl.appendChild(el);
    pianoKeyEls[`${k.note}|${k.octave}`] = el;
  }
  // shortcut labels
  for (const kbKey in KB_MAP) {
    const el = document.createElement('div');
    el.className = 'key-shortcut';
    el.textContent = kbKey.toUpperCase();
    el.style.display = 'none';
    pianoEl.appendChild(el);
    shortcutEls[kbKey] = el;
  }
  // octave labels (under each C key)
  for (const k of pianoKeys) {
    if (k.note !== 'C') continue;
    const el = document.createElement('div');
    el.className = 'oct-label';
    el.textContent = `C${k.octave}`;
    el.style.left = `${(k.x + k.w / 2) * whiteW}%`;
    pianoEl.appendChild(el);
    octLabelEls[k.octave] = el;
  }
  // active-octave underline
  octUnderlineEl = document.createElement('div');
  octUnderlineEl.className = 'oct-underline';
  pianoEl.appendChild(octUnderlineEl);

  // store percent-per-white-key for underline/shortcut positioning
  initPiano._whiteW = whiteW;
}

function updatePiano() {
  const whiteW = initPiano._whiteW;
  // reset colors
  for (const k of pianoKeys) {
    const el = pianoKeyEls[`${k.note}|${k.octave}`];
    el.style.background = k.isBlack ? 'var(--pia-black)' : 'var(--pia-white)';
  }
  for (let i = 0; i < 4; i++) {
    const key = `${state.notes[i]}|${state.octs[i]}`;
    const el = pianoKeyEls[key];
    if (el) el.style.background = NOTE_COLS[i];
  }
  // shortcut labels reposition for base octave
  for (const kbKey in KB_MAP) {
    const [semi, octOff] = KB_MAP[kbKey];
    const note = NOTE_NAMES[semi];
    const octave = state.baseOctave + octOff;
    const k = pianoKeys.find(pk => pk.note === note && pk.octave === octave);
    const el = shortcutEls[kbKey];
    if (k) {
      const cx = (k.x + k.w / 2) * whiteW;
      const cy = k.isBlack ? '30%' : '85%';
      el.style.left = `${cx}%`;
      el.style.top = cy;
      el.style.color = k.isBlack ? '#cccccc' : '#334455';
      el.style.fontSize = k.isBlack ? '8.5px' : '9.5px';
      el.style.display = 'block';
    } else {
      el.style.display = 'none';
    }
  }
  // octave label colors
  for (const oct in octLabelEls) {
    octLabelEls[oct].classList.toggle('active', Number(oct) === state.baseOctave);
  }
  // underline
  const cKey = pianoKeys.find(k => k.note === 'C' && k.octave === state.baseOctave);
  if (cKey) {
    octUnderlineEl.style.left = `${(cKey.x + 0.1) * whiteW}%`;
    octUnderlineEl.style.width = `${6.8 * whiteW}%`;
    octUnderlineEl.style.display = 'block';
  } else {
    octUnderlineEl.style.display = 'none';
  }
}

function assignNoteToActiveSlot(note, octave) {
  const slot = state.activeSlot;
  state.notes[slot] = note;
  state.octs[slot] = octave;
  state.activeSlot = (slot + 1) % 4;
  fullRedraw();
}

// ---------------------------------------------------------------------------
// Note slots
// ---------------------------------------------------------------------------
const slotEls = []; // {root, note, freq, status, title}

function initSlots() {
  for (let i = 0; i < 4; i++) {
    const root = document.createElement('div');
    root.className = 'slot';
    const axisLbl = i < 2 ? 'X  AXIS' : 'Y  AXIS';
    const axisCol = i < 2 ? 'var(--x-col)' : 'var(--y-col)';
    root.innerHTML = `
      <div class="s-title">Note ${i + 1}</div>
      <div class="s-axis" style="color:${axisCol}">${axisLbl}</div>
      <div class="s-note"></div>
      <div class="s-freq"></div>
      <div class="s-status"></div>`;
    root.addEventListener('click', () => {
      state.activeSlot = i;
      redrawSlots();
    });
    (i % 2 === 0 ? slotsLeftEl : slotsRightEl).appendChild(root);
    slotEls.push({
      root,
      note: root.querySelector('.s-note'),
      freq: root.querySelector('.s-freq'),
      status: root.querySelector('.s-status'),
      title: root.querySelector('.s-title'),
    });
  }
}

function drawSlot(i) {
  const col = NOTE_COLS[i];
  const isAct = state.activeSlot === i;
  const els = slotEls[i];
  els.root.style.borderColor = col;
  els.root.style.borderWidth = isAct ? '2.5px' : '1px';
  els.title.style.color = isAct ? col : '#445566';
  els.note.textContent = `${state.notes[i]}${state.octs[i]}`;
  els.note.style.color = col;
  els.freq.textContent = `${noteFreq(state.notes[i], state.octs[i], state.temp).toFixed(1)} Hz`;
  if (isAct) {
    els.status.textContent = '▲  ACTIVE';
    els.status.style.color = col;
  } else {
    els.status.textContent = `press  ${i + 1}`;
    els.status.style.color = '#2a3a4a';
  }
}
function redrawSlots() { for (let i = 0; i < 4; i++) drawSlot(i); }

// ---------------------------------------------------------------------------
// Temperament buttons
// ---------------------------------------------------------------------------
function initTempButtons() {
  TEMP_NAMES.forEach((name, i) => {
    const btn = document.createElement('button');
    btn.className = 'temp-btn';
    btn.textContent = name;
    btn.addEventListener('click', () => {
      state.temp = name;
      tempDescEl.textContent = TEMP_DESCRIPTIONS[name];
      styleTempButtons();
      fullRedraw();
    });
    tempRowEl.appendChild(btn);
  });
  tempDescEl.textContent = TEMP_DESCRIPTIONS[state.temp];
  styleTempButtons();
}
function styleTempButtons() {
  [...tempRowEl.children].forEach((btn, i) => {
    btn.classList.toggle('active', TEMP_NAMES[i] === state.temp);
  });
}

// ---------------------------------------------------------------------------
// Curve drawing
// ---------------------------------------------------------------------------
const CURVE_COL_RGB = [0, 212, 255];
const DIM_COL = '#2a3a4a';

function drawGrid(ctx, w, h) {
  ctx.strokeStyle = DIM_COL;
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.6;
  const marks = [-1, -0.5, 0, 0.5, 1];
  for (const v of marks) {
    const px = ((v + 1.15) / 2.3) * w;
    ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, h); ctx.stroke();
    const py = h - ((v + 1.15) / 2.3) * h;
    ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(w, py); ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

let CURVE_SIZE = 560; // logical (CSS-pixel) canvas size; kept in sync by resizeCanvas()

function drawCurve(x, y) {
  const w = CURVE_SIZE, h = CURVE_SIZE;
  curveCtx.clearRect(0, 0, w, h);
  drawGrid(curveCtx, w, h);

  const n = x.length;
  const toPx = (v) => ((v + 1.15) / 2.3) * w;
  const toPy = (v) => h - ((v + 1.15) / 2.3) * h;

  // group segments into alpha buckets for performance
  const BUCKETS = 24;
  curveCtx.lineWidth = 1.4;
  curveCtx.lineCap = 'butt';
  const [r, g, b] = CURVE_COL_RGB;
  for (let bIdx = 0; bIdx < BUCKETS; bIdx++) {
    const i0 = Math.floor((bIdx / BUCKETS) * (n - 1));
    const i1 = Math.floor(((bIdx + 1) / BUCKETS) * (n - 1));
    const alpha = 0.15 + (0.85 * (bIdx + 1)) / BUCKETS;
    curveCtx.strokeStyle = `rgba(${r},${g},${b},${alpha.toFixed(3)})`;
    curveCtx.beginPath();
    curveCtx.moveTo(toPx(x[i0]), toPy(y[i0]));
    for (let i = i0 + 1; i <= i1; i++) curveCtx.lineTo(toPx(x[i]), toPy(y[i]));
    curveCtx.stroke();
  }
}

function updateCurveFull() {
  const freqs = [0, 1, 2, 3].map(i => noteFreq(state.notes[i], state.octs[i], state.temp));
  const [x, y] = lissajous4(freqs, state.phiX, state.phiXY);
  drawCurve(x, y);

  const [f1, f2, f3, f4] = freqs;
  const [rx, ix] = describeRatio(f1, f2);
  const [ry, iy] = describeRatio(f3, f4);
  const ixS = ix ? ` – ${ix}` : '';
  const iyS = iy ? ` – ${iy}` : '';
  xLabelEl.textContent = `${state.notes[0]}${state.octs[0]} (${f1.toFixed(1)} Hz) + ${state.notes[1]}${state.octs[1]} (${f2.toFixed(1)} Hz)   [${rx}${ixS}]`;
  yLabelEl.textContent = `${state.notes[2]}${state.octs[2]} (${f3.toFixed(1)} Hz) + ${state.notes[3]}${state.octs[3]} (${f4.toFixed(1)} Hz)   [${ry}${iyS}]`;
  curveTitleEl.textContent = state.temp;

  if (audioEngine.on) audioEngine.setFreqs(freqs);
  return freqs;
}

function updateCurveFast() {
  const freqs = [0, 1, 2, 3].map(i => noteFreq(state.notes[i], state.octs[i], state.temp));
  const [x, y] = lissajous4(freqs, state.phiX, state.phiXY);
  drawCurve(x, y);
}

function fullRedraw() {
  redrawSlots();
  updatePiano();
  updateCurveFull();
}

// ---------------------------------------------------------------------------
// Phase sliders + animate buttons
// ---------------------------------------------------------------------------
const slPx = $('#slPx'), slPxy = $('#slPxy');
const animPxBtn = $('#animPx'), animPxyBtn = $('#animPxy');
const TWO_PI = 2 * Math.PI;
const ANIM_STEP = 0.05; // radians per 40ms tick, matching original

slPx.addEventListener('input', () => { state.phiX = parseFloat(slPx.value); updateCurveFast(); });
slPxy.addEventListener('input', () => { state.phiXY = parseFloat(slPxy.value); updateCurveFast(); });

function toggleAnim(key, btn) {
  state[key] = !state[key];
  btn.classList.toggle('on', state[key]);
  btn.innerHTML = state[key] ? '&#9632;' : '&#9654;';
}
animPxBtn.addEventListener('click', () => toggleAnim('animPhiX', animPxBtn));
animPxyBtn.addEventListener('click', () => toggleAnim('animPhiXY', animPxyBtn));

setInterval(() => {
  let changed = false;
  if (state.animPhiX) {
    state.phiX = (state.phiX + ANIM_STEP) % TWO_PI;
    slPx.value = state.phiX;
    changed = true;
  }
  if (state.animPhiXY) {
    state.phiXY = (state.phiXY + ANIM_STEP) % TWO_PI;
    slPxy.value = state.phiXY;
    changed = true;
  }
  if (changed) updateCurveFast();
}, 40);

// ---------------------------------------------------------------------------
// Audio engine (Web Audio API additive synthesis, mirrors _AudioEngine)
// ---------------------------------------------------------------------------
const TONE_HARMONICS = {
  sine:   [[1, 1.000]],
  epiano: [[1, 0.600], [2, 0.280], [3, 0.080], [4, 0.020]],
  piano:  [[1, 0.380], [2, 0.220], [3, 0.140], [4, 0.090],
           [5, 0.055], [6, 0.035], [7, 0.020], [8, 0.012]],
};
const MAX_HARMONICS = 8;

class AudioEngine {
  constructor() {
    this.ctx = null;
    this.on = false;
    this.tone = 'sine';
    this.vol = 0.25;
    this.freqs = [440, 440, 440, 440];
    this.voices = null; // built lazily on first enable (needs user gesture)
  }

  _ensureBuilt() {
    if (this.voices) return;
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.ctx = ctx;

    this.volGain = ctx.createGain();
    this.volGain.gain.value = this.vol / 4;

    this.shaper = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) {
      const xv = (i / 1023) * 2 - 1;
      curve[i] = Math.tanh(xv * 3);
    }
    this.shaper.curve = curve;
    this.shaper.oversample = '2x';

    this.onGain = ctx.createGain();
    this.onGain.gain.value = 0; // silent until enabled

    this.volGain.connect(this.shaper);
    this.shaper.connect(this.onGain);
    this.onGain.connect(ctx.destination);

    this.voices = [];
    for (let v = 0; v < 4; v++) {
      const harmonics = [];
      for (let h = 1; h <= MAX_HARMONICS; h++) {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = this.freqs[v] * h;
        const g = ctx.createGain();
        const init = (TONE_HARMONICS[this.tone].find(([hh]) => hh === h) || [h, 0])[1];
        g.gain.value = init;
        osc.connect(g);
        g.connect(this.volGain);
        osc.start();
        harmonics.push({ osc, gain: g, h });
      }
      this.voices.push(harmonics);
    }
  }

  enable(freqs) {
    this._ensureBuilt();
    if (this.ctx.state === 'suspended') this.ctx.resume();
    this.setFreqs(freqs, true);
    this.on = true;
    this.onGain.gain.cancelScheduledValues(this.ctx.currentTime);
    this.onGain.gain.setTargetAtTime(1, this.ctx.currentTime, 0.01);
  }

  disable() {
    this.on = false;
    if (!this.ctx) return;
    this.onGain.gain.cancelScheduledValues(this.ctx.currentTime);
    this.onGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.01);
  }

  setFreqs(freqs, immediate = false) {
    this.freqs = freqs.slice();
    if (!this.voices) return;
    const now = this.ctx.currentTime;
    for (let v = 0; v < 4; v++) {
      for (const { osc, h } of this.voices[v]) {
        const target = freqs[v] * h;
        if (immediate) osc.frequency.setValueAtTime(target, now);
        else osc.frequency.setTargetAtTime(target, now, 0.01);
      }
    }
  }

  setTone(tone) {
    this.tone = tone;
    if (!this.voices) return;
    const now = this.ctx.currentTime;
    const harmonics = TONE_HARMONICS[tone];
    for (let v = 0; v < 4; v++) {
      for (const { gain, h } of this.voices[v]) {
        const found = harmonics.find(([hh]) => hh === h);
        const target = found ? found[1] : 0;
        gain.gain.setTargetAtTime(target, now, 0.02);
      }
    }
  }

  setVolume(v) {
    this.vol = v;
    if (!this.voices) return;
    this.volGain.gain.setTargetAtTime(v / 4, this.ctx.currentTime, 0.02);
  }
}

const audioEngine = new AudioEngine();

// ---------------------------------------------------------------------------
// Audio UI
// ---------------------------------------------------------------------------
const audOnBtn = $('#audOn');
const audToneBtns = { sine: $('#audSine'), epiano: $('#audEp'), piano: $('#audPno') };
const slVol = $('#slVol');

audOnBtn.addEventListener('click', () => {
  if (audioEngine.on) {
    audioEngine.disable();
    audOnBtn.classList.remove('on');
    audOnBtn.innerHTML = '&#9834; off';
  } else {
    const freqs = [0, 1, 2, 3].map(i => noteFreq(state.notes[i], state.octs[i], state.temp));
    audioEngine.enable(freqs);
    audOnBtn.classList.add('on');
    audOnBtn.innerHTML = '&#9834; on';
  }
});

for (const key in audToneBtns) {
  audToneBtns[key].addEventListener('click', () => {
    audioEngine.setTone(key);
    for (const k in audToneBtns) audToneBtns[k].classList.toggle('on', k === key);
  });
}
slVol.addEventListener('input', () => audioEngine.setVolume(parseFloat(slVol.value)));

// ---------------------------------------------------------------------------
// Keyboard input
// ---------------------------------------------------------------------------
window.addEventListener('keydown', (ev) => {
  if (ev.ctrlKey || ev.altKey || ev.metaKey) return;
  const key = ev.key.toLowerCase();

  if (['1', '2', '3', '4'].includes(key)) {
    state.activeSlot = Number(key) - 1;
    redrawSlots();
    return;
  }
  if (ev.key === 'Tab') {
    ev.preventDefault();
    state.activeSlot = (state.activeSlot + 1) % 4;
    redrawSlots();
    return;
  }
  if (key === '[') {
    state.baseOctave = Math.max(PIANO_OCT_LOW, state.baseOctave - 1);
    updatePiano();
    return;
  }
  if (key === ']') {
    state.baseOctave = Math.min(PIANO_OCT_HIGH - 1, state.baseOctave + 1);
    updatePiano();
    return;
  }
  if (key in KB_MAP) {
    ev.preventDefault();
    const [semi, octOff] = KB_MAP[key];
    const note = NOTE_NAMES[semi];
    let octave = state.baseOctave + octOff;
    octave = Math.max(PIANO_OCT_LOW, Math.min(PIANO_OCT_HIGH, octave));
    const slot = state.activeSlot;
    state.notes[slot] = note;
    state.octs[slot] = octave;
    state.activeSlot = (slot + 1) % 4;
    fullRedraw();
  }
});

// ---------------------------------------------------------------------------
// MIDI input (Web MIDI API)
// ---------------------------------------------------------------------------
function handleMidiNote(midiNote) {
  const note = NOTE_NAMES[midiNote % 12];
  const octave = Math.floor(midiNote / 12) - 1;
  const slot = state.activeSlot;
  state.notes[slot] = note;
  state.octs[slot] = octave;
  state.activeSlot = (slot + 1) % 4;
  fullRedraw();
}

function initMidi() {
  if (!navigator.requestMIDIAccess) {
    midiStatusEl.textContent = 'MIDI unavailable in this browser (try Chrome / Edge)';
    return;
  }
  navigator.requestMIDIAccess().then((access) => {
    const inputs = [...access.inputs.values()];
    if (inputs.length === 0) {
      midiStatusEl.textContent = 'MIDI · no device found';
      return;
    }
    midiStatusEl.textContent = `MIDI · ${inputs[0].name}`;
    midiStatusEl.style.color = 'var(--accent)';
    for (const input of inputs) {
      input.onmidimessage = (msg) => {
        const [status, note, velocity] = msg.data;
        const type = status & 0xf0;
        if (type === 0x90 && velocity > 0) handleMidiNote(note);
      };
    }
    access.onstatechange = () => { /* device list changed; simple app, ignore */ };
  }).catch(() => {
    midiStatusEl.textContent = 'MIDI · permission denied';
  });
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
function resizeCanvas() {
  const wrap = curveCanvas.parentElement;
  const size = Math.min(560, wrap.clientWidth || 560);
  const dpr = window.devicePixelRatio || 1;
  CURVE_SIZE = size;
  curveCanvas.style.width = `${size}px`;
  curveCanvas.style.height = `${size}px`;
  curveCanvas.width = size * dpr;
  curveCanvas.height = size * dpr;
  curveCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

resizeCanvas();
initTempButtons();
initPiano();
initSlots();
fullRedraw();
initMidi();

window.addEventListener('resize', () => { resizeCanvas(); updateCurveFast(); });
