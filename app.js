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
let mode = '2d'; // '2d' or '3d' — which top section + note-slot set is live

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

// One note per axis instead of two-notes-summed-per-axis. temp is kept in
// sync with `state.temp` (temperament is shared across both modes); phiY/phiZ
// are 3D's analogue of phiX/phiXY.
const state3d = {
  notes: ['C', 'G', 'C'],
  octs: [4, 4, 5],
  phiY: Math.PI / 4,
  phiZ: Math.PI / 3,
  temp: TEMP_NAMES[0],
  activeSlot: 0,
  baseOctave: 4,
  animPhiY: false,
  animPhiZ: false,
};

const NOTE_COLS = ['#ff6644', '#ffbb44', '#44ddbb', '#4499ff'];
const SLOT_COLS_3D = NOTE_COLS.slice(0, 3);
const AXIS_COLS_3D = ['#ff9955', '#55ccff', '#66ffaa']; // X, Y, Z label colors
const AXIS_NAMES_3D = ['X', 'Y', 'Z'];

function activeState()     { return mode === '2d' ? state : state3d; }
function activeNoteCols()  { return mode === '2d' ? NOTE_COLS : SLOT_COLS_3D; }
function activeSlotCount() { return mode === '2d' ? 4 : 3; }
function activeFreqs() {
  const st = activeState();
  const n = activeSlotCount();
  return Array.from({ length: n }, (_, i) => noteFreq(st.notes[i], st.octs[i], st.temp));
}

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
  const st = activeState();
  const cols = activeNoteCols();
  const whiteW = initPiano._whiteW;
  // reset colors
  for (const k of pianoKeys) {
    const el = pianoKeyEls[`${k.note}|${k.octave}`];
    el.style.background = k.isBlack ? 'var(--pia-black)' : 'var(--pia-white)';
  }
  for (let i = 0; i < st.notes.length; i++) {
    const key = `${st.notes[i]}|${st.octs[i]}`;
    const el = pianoKeyEls[key];
    if (el) el.style.background = cols[i];
  }
  // shortcut labels reposition for base octave
  for (const kbKey in KB_MAP) {
    const [semi, octOff] = KB_MAP[kbKey];
    const note = NOTE_NAMES[semi];
    const octave = st.baseOctave + octOff;
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
    octLabelEls[oct].classList.toggle('active', Number(oct) === st.baseOctave);
  }
  // underline
  const cKey = pianoKeys.find(k => k.note === 'C' && k.octave === st.baseOctave);
  if (cKey) {
    octUnderlineEl.style.left = `${(cKey.x + 0.1) * whiteW}%`;
    octUnderlineEl.style.width = `${6.8 * whiteW}%`;
    octUnderlineEl.style.display = 'block';
  } else {
    octUnderlineEl.style.display = 'none';
  }
}

function assignNoteToActiveSlot(note, octave) {
  const st = activeState();
  const n = activeSlotCount();
  const slot = st.activeSlot;
  st.notes[slot] = note;
  st.octs[slot] = octave;
  st.activeSlot = (slot + 1) % n;
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

// ---- 3D note slots: one per axis (X/Y/Z) instead of two-per-axis ----
const slots3DEl = $('#slots3D');
const slotEls3D = [];

function initSlots3D() {
  for (let i = 0; i < 3; i++) {
    const root = document.createElement('div');
    root.className = 'slot';
    root.innerHTML = `
      <div class="s-title">${AXIS_NAMES_3D[i]} Note</div>
      <div class="s-axis" style="color:${AXIS_COLS_3D[i]}">${AXIS_NAMES_3D[i]}  AXIS</div>
      <div class="s-note"></div>
      <div class="s-freq"></div>
      <div class="s-status"></div>`;
    root.addEventListener('click', () => {
      state3d.activeSlot = i;
      redrawSlots();
    });
    slots3DEl.appendChild(root);
    slotEls3D.push({
      root,
      note: root.querySelector('.s-note'),
      freq: root.querySelector('.s-freq'),
      status: root.querySelector('.s-status'),
      title: root.querySelector('.s-title'),
    });
  }
}

function drawSlot3D(i) {
  const col = SLOT_COLS_3D[i];
  const isAct = state3d.activeSlot === i;
  const els = slotEls3D[i];
  els.root.style.borderColor = col;
  els.root.style.borderWidth = isAct ? '2.5px' : '1px';
  els.title.style.color = isAct ? col : '#445566';
  els.note.textContent = `${state3d.notes[i]}${state3d.octs[i]}`;
  els.note.style.color = col;
  els.freq.textContent = `${noteFreq(state3d.notes[i], state3d.octs[i], state3d.temp).toFixed(1)} Hz`;
  if (isAct) {
    els.status.textContent = '▲  ACTIVE';
    els.status.style.color = col;
  } else {
    els.status.textContent = `press  ${i + 1}`;
    els.status.style.color = '#2a3a4a';
  }
}

function redrawSlots() {
  if (mode === '2d') { for (let i = 0; i < 4; i++) drawSlot(i); }
  else { for (let i = 0; i < 3; i++) drawSlot3D(i); }
}

// ---------------------------------------------------------------------------
// Temperament buttons
// ---------------------------------------------------------------------------
function initTempButtons() {
  TEMP_NAMES.forEach((name, i) => {
    const btn = document.createElement('button');
    btn.className = 'temp-btn';
    btn.textContent = name;
    btn.addEventListener('click', () => {
      // Temperament is shared across both modes, so both states track it —
      // whichever isn't active right now just carries the value silently.
      state.temp = name;
      state3d.temp = name;
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
  const temp = activeState().temp;
  [...tempRowEl.children].forEach((btn, i) => {
    btn.classList.toggle('active', TEMP_NAMES[i] === temp);
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

// Renders the curve onto any ctx/size — used both for the live on-screen
// canvas and for offscreen preset-snapshot rendering.
function renderCurveToCtx(ctx, w, h, x, y, withGrid = true) {
  ctx.clearRect(0, 0, w, h);
  if (withGrid) drawGrid(ctx, w, h);

  const n = x.length;
  const toPx = (v) => ((v + 1.15) / 2.3) * w;
  const toPy = (v) => h - ((v + 1.15) / 2.3) * h;

  // group segments into alpha buckets for performance
  const BUCKETS = 24;
  ctx.lineWidth = 1.4;
  ctx.lineCap = 'butt';
  const [r, g, b] = CURVE_COL_RGB;
  for (let bIdx = 0; bIdx < BUCKETS; bIdx++) {
    const i0 = Math.floor((bIdx / BUCKETS) * (n - 1));
    const i1 = Math.floor(((bIdx + 1) / BUCKETS) * (n - 1));
    const alpha = 0.15 + (0.85 * (bIdx + 1)) / BUCKETS;
    ctx.strokeStyle = `rgba(${r},${g},${b},${alpha.toFixed(3)})`;
    ctx.beginPath();
    ctx.moveTo(toPx(x[i0]), toPy(y[i0]));
    for (let i = i0 + 1; i <= i1; i++) ctx.lineTo(toPx(x[i]), toPy(y[i]));
    ctx.stroke();
  }
}

function drawCurve(x, y) {
  renderCurveToCtx(curveCtx, CURVE_SIZE, CURVE_SIZE, x, y);
}

// Standalone PNG snapshot of a curve — used when saving/importing a preset.
function renderCurveSnapshot(freqs, phiX, phiXY, size = 480) {
  const [x, y] = lissajous4(freqs, phiX, phiXY);
  const off = document.createElement('canvas');
  off.width = size; off.height = size;
  const ctx = off.getContext('2d');
  renderCurveToCtx(ctx, size, size, x, y, /* withGrid */ false);
  // renderCurveToCtx() clearRect()s first, which would erase a fill drawn
  // before it — paint the background in behind what's already there instead,
  // so the PNG isn't transparent where there's no curve.
  ctx.globalCompositeOperation = 'destination-over';
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#0b0c1e';
  ctx.fillRect(0, 0, size, size);
  ctx.globalCompositeOperation = 'source-over';
  return off.toDataURL('image/png');
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

// ---------------------------------------------------------------------------
// 3D Lissajous — one note per axis, drawn as a true 3D curve you can drag to
// rotate, with its three 2D projections (top/front/side) shown alongside.
// ---------------------------------------------------------------------------
const N_POINTS_3D = 3000;

function lissajous3(freqs, phiY, phiZ) {
  const fMin = Math.min(...freqs);
  const r = freqs.map(f => f / fMin);
  const T = period(freqs);
  const n = N_POINTS_3D;
  const x = new Float64Array(n), y = new Float64Array(n), z = new Float64Array(n);
  const dt = (2 * Math.PI * T) / (n - 1);
  for (let i = 0; i < n; i++) {
    const t = i * dt;
    x[i] = Math.sin(r[0] * t);
    y[i] = Math.sin(r[1] * t + phiY);
    z[i] = Math.sin(r[2] * t + phiZ);
  }
  for (const arr of [x, y, z]) {
    let m = 1e-12;
    for (let i = 0; i < arr.length; i++) if (Math.abs(arr[i]) > m) m = Math.abs(arr[i]);
    for (let i = 0; i < arr.length; i++) arr[i] /= m;
  }
  return [x, y, z];
}

// Rotation state (radians), matching matplotlib's default view_init(elev=22,
// azim=-60) for a familiar starting angle. Dragging the cube canvas updates
// this; project3D re-derives screen position from it every draw.
const rot3D = { azim: -60 * Math.PI / 180, elev: 22 * Math.PI / 180 };

function project3D(x, y, z, rot = rot3D) {
  const ca = Math.cos(rot.azim), sa = Math.sin(rot.azim);
  const x1 = x * ca - y * sa;
  const y1 = x * sa + y * ca;
  const ce = Math.cos(rot.elev), se = Math.sin(rot.elev);
  const y2 = y1 * ce - z * se;
  const z2 = y1 * se + z * ce;
  return [x1, z2, y2]; // [screenX, screenY-up, depth (unused)]
}

// The 8 corners of a ±1.15 cube, indexed as a 3-bit number (bit0=x, bit1=y,
// bit2=z; 0=-1.15, 1=+1.15), and its 12 edges as pairs of corner indices —
// two corners are joined by an edge exactly when they differ in one bit.
const CUBE_CORNERS = Array.from({ length: 8 }, (_, i) => [
  (i & 1) ? 1.15 : -1.15,
  (i & 2) ? 1.15 : -1.15,
  (i & 4) ? 1.15 : -1.15,
]);
const CUBE_EDGES = [];
for (let i = 0; i < 8; i++) {
  for (const bit of [1, 2, 4]) {
    const j = i ^ bit;
    if (j > i) CUBE_EDGES.push([CUBE_CORNERS[i], CUBE_CORNERS[j]]);
  }
}

const cube3dCanvas = $('#cube3d');
const cube3dCtx = cube3dCanvas.getContext('2d');
const cube3dTitleEl = $('#cube3dTitle');
let CUBE_SIZE = 480; // logical (CSS-pixel) canvas size; kept in sync by resizeCube3D()

function cubeToScreen(px, py, size = CUBE_SIZE) {
  const S = size * 0.30;
  return [size / 2 + px * S, size / 2 - py * S];
}

function faceLabelAngle(dirVec, rot = rot3D) {
  const [dx, dyUp] = project3D(...dirVec, rot);
  return Math.atan2(-dyUp, dx);
}

function drawCubeLabel(ctx, size, text, anchor3D, dirVec, color, rot = rot3D) {
  const [px, py] = project3D(...anchor3D, rot);
  const [sx, sy] = cubeToScreen(px, py, size);
  const angle = faceLabelAngle(dirVec, rot);
  ctx.save();
  ctx.translate(sx, sy);
  ctx.rotate(angle);
  ctx.fillStyle = color;
  ctx.font = '10px -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

// Draws the cube wireframe + curve + face labels onto any ctx/size, at any
// rotation — shared by the live canvas and the offscreen preset snapshot.
function renderCube3DToCtx(ctx, size, x, y, z, rot = rot3D) {
  ctx.clearRect(0, 0, size, size);

  ctx.strokeStyle = DIM_COL;
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.8;
  for (const [a, b] of CUBE_EDGES) {
    const [ax, ay] = cubeToScreen(...project3D(...a, rot).slice(0, 2), size);
    const [bx, by] = cubeToScreen(...project3D(...b, rot).slice(0, 2), size);
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
  }
  ctx.globalAlpha = 1;

  const n = x.length;
  const sx = new Float64Array(n), sy = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const [px, py] = project3D(x[i], y[i], z[i], rot);
    const [scx, scy] = cubeToScreen(px, py, size);
    sx[i] = scx; sy[i] = scy;
  }
  const BUCKETS = 24;
  ctx.lineWidth = 1.3;
  ctx.lineCap = 'butt';
  const [r, g, b] = CURVE_COL_RGB;
  for (let bIdx = 0; bIdx < BUCKETS; bIdx++) {
    const i0 = Math.floor((bIdx / BUCKETS) * (n - 1));
    const i1 = Math.floor(((bIdx + 1) / BUCKETS) * (n - 1));
    const alpha = 0.15 + (0.85 * (bIdx + 1)) / BUCKETS;
    ctx.strokeStyle = `rgba(${r},${g},${b},${alpha.toFixed(3)})`;
    ctx.beginPath();
    ctx.moveTo(sx[i0], sy[i0]);
    for (let i = i0 + 1; i <= i1; i++) ctx.lineTo(sx[i], sy[i]);
    ctx.stroke();
  }

  // Labels sit on whichever face matplotlib-style axes would render as a
  // background wall at this rotation — computed once for the app's default
  // angle; if you rotate a lot they may drift from a truly "far" face, same
  // simplification the desktop app makes.
  drawCubeLabel(ctx, size, 'Y–Z', [-1.32, 0, 0], [0, 1, 0], '#7a8fa8', rot);
  drawCubeLabel(ctx, size, 'X–Z', [0, 1.32, 0], [1, 0, 0], '#7a8fa8', rot);
  drawCubeLabel(ctx, size, 'X–Y', [0, 0, -1.32], [0, 1, 0], '#7a8fa8', rot);
}

const projTopCtx = $('#projTop').getContext('2d');
const projFrontCtx = $('#projFront').getContext('2d');
const projSideCtx = $('#projSide').getContext('2d');
const projTopTitleEl = $('#projTopTitle');
const projFrontTitleEl = $('#projFrontTitle');
const projSideTitleEl = $('#projSideTitle');

let _last3D = null; // cached [x,y,z] so drag-rotate doesn't recompute the curve

function updateCube3DFull() {
  const freqs = [0, 1, 2].map(i => noteFreq(state3d.notes[i], state3d.octs[i], state3d.temp));
  const [x, y, z] = lissajous3(freqs, state3d.phiY, state3d.phiZ);
  _last3D = [x, y, z];

  renderCube3DToCtx(cube3dCtx, CUBE_SIZE, x, y, z);
  renderCurveToCtx(projTopCtx, 200, 200, x, z);
  renderCurveToCtx(projFrontCtx, 200, 200, x, y);
  renderCurveToCtx(projSideCtx, 220, 220, y, z);

  const [fx, fy, fz] = freqs;
  const [rxy, ixy] = describeRatio(fx, fy);
  const [rxz, ixz] = describeRatio(fx, fz);
  const [ryz, iyz] = describeRatio(fy, fz);
  projTopTitleEl.textContent   = `TOP (X–Z)   [${rxz}${ixz ? ` – ${ixz}` : ''}]`;
  projFrontTitleEl.textContent = `FRONT (X–Y)   [${rxy}${ixy ? ` – ${ixy}` : ''}]`;
  projSideTitleEl.textContent  = `SIDE (Y–Z)   [${ryz}${iyz ? ` – ${iyz}` : ''}]`;
  cube3dTitleEl.textContent = state3d.temp;

  if (audioEngine.on) audioEngine.setFreqs(freqs);
}

// Fast path for phase-slider drags: recompute the curve but skip re-reading
// note/frequency state (unchanged) — mirrors updateCurveFast().
function updateCube3DFast() {
  const freqs = [0, 1, 2].map(i => noteFreq(state3d.notes[i], state3d.octs[i], state3d.temp));
  const [x, y, z] = lissajous3(freqs, state3d.phiY, state3d.phiZ);
  _last3D = [x, y, z];
  renderCube3DToCtx(cube3dCtx, CUBE_SIZE, x, y, z);
  renderCurveToCtx(projTopCtx, 200, 200, x, z);
  renderCurveToCtx(projFrontCtx, 200, 200, x, y);
  renderCurveToCtx(projSideCtx, 220, 220, y, z);
  if (audioEngine.on) audioEngine.setFreqs(freqs);
}

// Rotation-only redraw for dragging the cube — the curve itself hasn't
// changed, so this skips recomputing lissajous3() and the (unaffected by
// rotation) projection panels.
function redrawCube3DRotationOnly() {
  if (!_last3D) return;
  const [x, y, z] = _last3D;
  renderCube3DToCtx(cube3dCtx, CUBE_SIZE, x, y, z);
}

function renderCube3DSnapshot(freqs, phiY, phiZ, size = 480) {
  const [x, y, z] = lissajous3(freqs, phiY, phiZ);
  const off = document.createElement('canvas');
  off.width = size; off.height = size;
  const ctx = off.getContext('2d');
  // Fixed default rotation for a consistent, comparable snapshot regardless
  // of however the live view happens to be rotated when you hit Save.
  const snapshotRot = { azim: -60 * Math.PI / 180, elev: 22 * Math.PI / 180 };
  renderCube3DToCtx(ctx, size, x, y, z, snapshotRot);
  // renderCube3DToCtx() clearRect()s first, which would erase a fill drawn
  // before it — paint the background in behind what's already there instead.
  ctx.globalCompositeOperation = 'destination-over';
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#0b0c1e';
  ctx.fillRect(0, 0, size, size);
  ctx.globalCompositeOperation = 'source-over';
  return off.toDataURL('image/png');
}

// ---- drag-to-rotate ----
let _cubeDragging = false, _cubeLastX = 0, _cubeLastY = 0;
cube3dCanvas.addEventListener('pointerdown', (ev) => {
  _cubeDragging = true;
  _cubeLastX = ev.clientX; _cubeLastY = ev.clientY;
  cube3dCanvas.setPointerCapture(ev.pointerId);
});
cube3dCanvas.addEventListener('pointermove', (ev) => {
  if (!_cubeDragging) return;
  const dx = ev.clientX - _cubeLastX, dy = ev.clientY - _cubeLastY;
  _cubeLastX = ev.clientX; _cubeLastY = ev.clientY;
  rot3D.azim += dx * 0.012;
  rot3D.elev = Math.max(-1.5, Math.min(1.5, rot3D.elev - dy * 0.012));
  redrawCube3DRotationOnly();
});
cube3dCanvas.addEventListener('pointerup', () => { _cubeDragging = false; });
cube3dCanvas.addEventListener('pointercancel', () => { _cubeDragging = false; });

function resizeCube3D() {
  const wrap = cube3dCanvas.parentElement;
  const size = Math.min(480, wrap.clientWidth || 480);
  const dpr = window.devicePixelRatio || 1;
  CUBE_SIZE = size;
  cube3dCanvas.style.width = `${size}px`;
  cube3dCanvas.style.height = `${size}px`;
  cube3dCanvas.width = size * dpr;
  cube3dCanvas.height = size * dpr;
  cube3dCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function fullRedraw() {
  redrawSlots();
  updatePiano();
  if (mode === '2d') updateCurveFull();
  else updateCube3DFull();
}

// ---------------------------------------------------------------------------
// Phase sliders + animate buttons
// ---------------------------------------------------------------------------
const slPx = $('#slPx'), slPxy = $('#slPxy');
const animPxBtn = $('#animPx'), animPxyBtn = $('#animPxy');
const TWO_PI = 2 * Math.PI;
const ANIM_STEP = 0.05; // radians per 40ms tick, matching original

// These two sliders are shared between modes: in 2D they drive phiX/phiXY,
// in 3D the same two controls drive phiY/phiZ (relabeled by setMode()).
slPx.addEventListener('input', () => {
  if (mode === '2d') { state.phiX = parseFloat(slPx.value); updateCurveFast(); }
  else { state3d.phiY = parseFloat(slPx.value); updateCube3DFast(); }
});
slPxy.addEventListener('input', () => {
  if (mode === '2d') { state.phiXY = parseFloat(slPxy.value); updateCurveFast(); }
  else { state3d.phiZ = parseFloat(slPxy.value); updateCube3DFast(); }
});

function toggleAnim(key2d, key3d, btn) {
  const st = activeState();
  const key = mode === '2d' ? key2d : key3d;
  st[key] = !st[key];
  btn.classList.toggle('on', st[key]);
  btn.innerHTML = st[key] ? '&#9632;' : '&#9654;';
}
animPxBtn.addEventListener('click', () => toggleAnim('animPhiX', 'animPhiY', animPxBtn));
animPxyBtn.addEventListener('click', () => toggleAnim('animPhiXY', 'animPhiZ', animPxyBtn));

setInterval(() => {
  const st = activeState();
  let changed = false;
  if (mode === '2d') {
    if (st.animPhiX)  { st.phiX  = (st.phiX  + ANIM_STEP) % TWO_PI; slPx.value  = st.phiX;  changed = true; }
    if (st.animPhiXY) { st.phiXY = (st.phiXY + ANIM_STEP) % TWO_PI; slPxy.value = st.phiXY; changed = true; }
    if (changed) updateCurveFast();
  } else {
    if (st.animPhiY) { st.phiY = (st.phiY + ANIM_STEP) % TWO_PI; slPx.value  = st.phiY; changed = true; }
    if (st.animPhiZ) { st.phiZ = (st.phiZ + ANIM_STEP) % TWO_PI; slPxy.value = st.phiZ; changed = true; }
    if (changed) updateCube3DFast();
  }
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
    this.activeCount = 4; // how many voices are currently "live" (2D=4, 3D=3) — rest sit muted
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

    this.voices = []; // voices are added lazily as _ensureVoiceCount() needs them
  }

  // Max voice count ever needed is 4 (2D mode); 3D mode uses only 3. Rather
  // than tear down/rebuild oscillators when switching modes, we build up to
  // 4 voices once and mute whichever ones aren't currently in use.
  _ensureVoiceCount(n) {
    const ctx = this.ctx;
    while (this.voices.length < n) {
      const harmonics = [];
      for (let h = 1; h <= MAX_HARMONICS; h++) {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = 440 * h;
        const g = ctx.createGain();
        const init = (TONE_HARMONICS[this.tone].find(([hh]) => hh === h) || [h, 0])[1];
        g.gain.value = 0; // starts muted; setFreqs() below un-mutes active voices
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
    this.activeCount = freqs.length;
    if (!this.voices) return;
    this._ensureVoiceCount(freqs.length);
    const now = this.ctx.currentTime;
    const harmonics = TONE_HARMONICS[this.tone];
    for (let v = 0; v < this.voices.length; v++) {
      const active = v < freqs.length;
      for (const { osc, gain, h } of this.voices[v]) {
        if (active) {
          const target = freqs[v] * h;
          if (immediate) osc.frequency.setValueAtTime(target, now);
          else osc.frequency.setTargetAtTime(target, now, 0.01);
          const found = harmonics.find(([hh]) => hh === h);
          gain.gain.setTargetAtTime(found ? found[1] : 0, now, 0.02);
        } else {
          gain.gain.setTargetAtTime(0, now, 0.02);
        }
      }
    }
  }

  setTone(tone) {
    this.tone = tone;
    if (!this.voices) return;
    const now = this.ctx.currentTime;
    const harmonics = TONE_HARMONICS[tone];
    for (let v = 0; v < this.voices.length; v++) {
      if (v >= this.activeCount) continue; // leave muted voices muted
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
    audioEngine.enable(activeFreqs());
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
  const activeTag = document.activeElement && document.activeElement.tagName;
  if (activeTag === 'INPUT' || activeTag === 'TEXTAREA') return; // let the focused field handle its own typing
  const key = ev.key.toLowerCase();
  const st = activeState();
  const n = activeSlotCount();
  const digits = mode === '2d' ? ['1', '2', '3', '4'] : ['1', '2', '3'];

  if (digits.includes(key)) {
    st.activeSlot = Number(key) - 1;
    redrawSlots();
    return;
  }
  if (ev.key === 'Tab') {
    ev.preventDefault();
    st.activeSlot = (st.activeSlot + 1) % n;
    redrawSlots();
    return;
  }
  if (key === '[') {
    st.baseOctave = Math.max(PIANO_OCT_LOW, st.baseOctave - 1);
    updatePiano();
    return;
  }
  if (key === ']') {
    st.baseOctave = Math.min(PIANO_OCT_HIGH - 1, st.baseOctave + 1);
    updatePiano();
    return;
  }
  if (key === ' ') {
    ev.preventDefault();
    audOnBtn.click();
    return;
  }
  if (key in KB_MAP) {
    ev.preventDefault();
    const [semi, octOff] = KB_MAP[key];
    const note = NOTE_NAMES[semi];
    let octave = st.baseOctave + octOff;
    octave = Math.max(PIANO_OCT_LOW, Math.min(PIANO_OCT_HIGH, octave));
    const slot = st.activeSlot;
    st.notes[slot] = note;
    st.octs[slot] = octave;
    st.activeSlot = (slot + 1) % n;
    fullRedraw();
  }
});

// ---------------------------------------------------------------------------
// MIDI input (Web MIDI API)
// ---------------------------------------------------------------------------
function handleMidiNote(midiNote) {
  const note = NOTE_NAMES[midiNote % 12];
  const octave = Math.floor(midiNote / 12) - 1;
  const st = activeState();
  const n = activeSlotCount();
  const slot = st.activeSlot;
  st.notes[slot] = note;
  st.octs[slot] = octave;
  st.activeSlot = (slot + 1) % n;
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
// Presets — save/browse/delete locally (localStorage), export/import as a
// shareable JSON file. Mirrors the Python app's preset system; the curve
// snapshot is embedded as a data: URL instead of a separate PNG file, so a
// single exported .json is fully self-contained (metadata + picture).
// ---------------------------------------------------------------------------
const PRESETS_KEY = 'lissajousPresets';

function loadPresets() {
  try {
    const raw = localStorage.getItem(PRESETS_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw);
    return Array.isArray(data.presets) ? data.presets : [];
  } catch {
    return [];
  }
}

function writePresets() {
  try {
    localStorage.setItem(PRESETS_KEY, JSON.stringify({ format: 'lissajous-presets-v1', presets }));
  } catch (e) {
    showPresetStatus(`Save failed: ${e.message}`);
  }
}

let presets = loadPresets();
let presetIdx = presets.length - 1; // -1 when empty

function modePresets() { return presets.filter(p => (p.mode || '2d') === mode); }

// Tolerates a flatter {phiX, phiXY} shape alongside the nested 'phases' one.
function presetPhases(p) { return p.phases || { phiX: p.phiX, phiXY: p.phiXY }; }

function presetLabelText() {
  const mp = modePresets();
  if (!mp.length) return '(no saved presets)';
  const p = mp[presetIdx];
  return `${presetIdx + 1}/${mp.length}   ${p.name}`;
}

const presetNameEl = $('#presetName');
const presetLabelEl = $('#presetLabel');
const presetStatusEl = $('#presetStatus');
const presetImportFileEl = $('#presetImportFile');
const presetThumbEl = $('#presetThumb');
const presetThumbLinkEl = $('#presetThumbLink');

function showPresetStatus(msg) { presetStatusEl.textContent = msg; }

function refreshPresetLabel() {
  presetLabelEl.textContent = presetLabelText();
  const mp = modePresets();
  const p = mp[presetIdx];
  if (p && p.image) {
    presetThumbEl.src = p.image;
    presetThumbEl.classList.add('shown');
    presetThumbLinkEl.href = p.image;
    presetThumbLinkEl.download = `${p.name}.png`;
  } else {
    presetThumbEl.classList.remove('shown');
    presetThumbEl.removeAttribute('src');
    presetThumbLinkEl.removeAttribute('href');
  }
}

function applyPreset(p) {
  // Temperament is shared, so applying a preset updates it on both states
  // regardless of which mode the preset itself belongs to.
  state.temp = p.temperament;
  state3d.temp = p.temperament;
  if (mode === '2d') {
    state.notes = [...p.notes];
    state.octs = [...p.octaves];
    const ph = presetPhases(p);
    state.phiX = ph.phiX;
    state.phiXY = ph.phiXY;
    slPx.value = state.phiX;
    slPxy.value = state.phiXY;
  } else {
    state3d.notes = [...p.notes];
    state3d.octs = [...p.octaves];
    const ph = p.phases || {};
    state3d.phiY = ph.phiY;
    state3d.phiZ = ph.phiZ;
    slPx.value = state3d.phiY;
    slPxy.value = state3d.phiZ;
  }
  tempDescEl.textContent = TEMP_DESCRIPTIONS[activeState().temp];
  styleTempButtons();
  fullRedraw();
}

function gotoPreset(step) {
  const mp = modePresets();
  if (!mp.length) return;
  presetIdx = (presetIdx + step + mp.length) % mp.length;
  applyPreset(mp[presetIdx]);
  refreshPresetLabel();
  showPresetStatus('');
}

function savePreset() {
  const st = activeState();
  const name = presetNameEl.value.trim() || `Preset ${modePresets().length + 1}`;
  let image, preset;

  if (mode === '2d') {
    const freqs = [0, 1, 2, 3].map(i => noteFreq(st.notes[i], st.octs[i], st.temp));
    try { image = renderCurveSnapshot(freqs, st.phiX, st.phiXY); } catch (e) { image = null; }
    preset = {
      name, mode: '2d',
      notes: [...st.notes], octaves: [...st.octs],
      phases: { phiX: st.phiX, phiXY: st.phiXY },
      temperament: st.temp,
      created: new Date().toISOString(),
    };
  } else {
    const freqs = [0, 1, 2].map(i => noteFreq(st.notes[i], st.octs[i], st.temp));
    try { image = renderCube3DSnapshot(freqs, st.phiY, st.phiZ); } catch (e) { image = null; }
    preset = {
      name, mode: '3d',
      notes: [...st.notes], octaves: [...st.octs],
      phases: { phiY: st.phiY, phiZ: st.phiZ },
      temperament: st.temp,
      created: new Date().toISOString(),
    };
  }

  if (image) preset.image = image;
  presets.push(preset);
  presetIdx = modePresets().length - 1;
  writePresets();
  presetNameEl.value = '';
  refreshPresetLabel();
  showPresetStatus(image ? '' : 'Saved (snapshot image failed)');
}

function deletePreset() {
  const mp = modePresets();
  if (!mp.length) return;
  const removed = mp[presetIdx];
  presets = presets.filter(p => p !== removed);
  presetIdx = Math.min(presetIdx, modePresets().length - 1);
  writePresets();
  refreshPresetLabel();
}

function downloadBlob(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function exportPresets() {
  if (!presets.length) {
    showPresetStatus('No presets to export');
    return;
  }
  downloadBlob('lissajous_shared.json',
    JSON.stringify({ format: 'lissajous-presets-v1', presets }, null, 2),
    'application/json');
  showPresetStatus(`Exported ${presets.length} preset(s)`);
}

function importPresetsFromFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    let incoming;
    try {
      const data = JSON.parse(reader.result);
      incoming = Array.isArray(data.presets) ? data.presets : [];
    } catch (e) {
      showPresetStatus(`Import failed: ${e.message}`);
      return;
    }
    if (!incoming.length) {
      showPresetStatus('No presets found in that file');
      return;
    }
    const existingNames = new Set(presets.map(p => p.name));
    let added = 0;
    for (const p of incoming) {
      let name = p.name || 'Imported preset';
      if (existingNames.has(name)) {
        let n = 2;
        while (existingNames.has(`${name} (${n})`)) n++;
        name = `${name} (${n})`;
      }
      presets.push({ ...p, name, mode: p.mode || '2d' });
      existingNames.add(name);
      added++;
    }
    presetIdx = modePresets().length - 1;
    writePresets();
    refreshPresetLabel();
    showPresetStatus(`Imported ${added} preset(s)`);
  };
  reader.readAsText(file);
}

$('#presetSave').addEventListener('click', savePreset);
$('#presetPrev').addEventListener('click', () => gotoPreset(-1));
$('#presetNext').addEventListener('click', () => gotoPreset(1));
$('#presetDelete').addEventListener('click', deletePreset);
$('#presetExport').addEventListener('click', exportPresets);
$('#presetImport').addEventListener('click', () => presetImportFileEl.click());
presetImportFileEl.addEventListener('change', () => {
  const file = presetImportFileEl.files[0];
  if (file) importPresetsFromFile(file);
  presetImportFileEl.value = '';
});

refreshPresetLabel();

// ---------------------------------------------------------------------------
// 2D / 3D mode toggle
// ---------------------------------------------------------------------------
const modeToggleBtn = $('#modeToggle');
const mode2DEl = $('#mode2D');
const mode3DEl = $('#mode3D');
const phiLabelAEl = $('#phiLabelA');
const phiLabelBEl = $('#phiLabelB');
const pianoHintEl = $('#pianoHint');
const pageTitleEl = $('#pageTitle');

const HINT_2D = 'Click a key &nbsp;&middot;&nbsp; A&ndash;J = C&ndash;B (home oct) &nbsp;&middot;&nbsp; K,O,L,P = next oct &nbsp;&middot;&nbsp; ' +
                '[ ] shift octave &nbsp;&middot;&nbsp; 1&ndash;4 / Tab select slot &nbsp;&middot;&nbsp; Space = sound on/off';
const HINT_3D = 'Click a key &nbsp;&middot;&nbsp; A&ndash;J = C&ndash;B (home oct) &nbsp;&middot;&nbsp; K,O,L,P = next oct &nbsp;&middot;&nbsp; ' +
                '[ ] shift octave &nbsp;&middot;&nbsp; 1&ndash;3 / Tab select axis &nbsp;&middot;&nbsp; Space = sound on/off &nbsp;&middot;&nbsp; Drag cube to rotate';

function setMode(newMode) {
  mode = newMode;
  mode2DEl.hidden = mode !== '2d';
  mode3DEl.hidden = mode !== '3d';
  modeToggleBtn.textContent = mode === '2d' ? '3D View →' : '2D View →';
  pageTitleEl.textContent = mode === '2d'
    ? '4-NOTE LISSAJOUS CURVE · KEYBOARD INTERFACE'
    : '3-NOTE LISSAJOUS CURVE · 3D';
  phiLabelAEl.textContent = mode === '2d' ? 'φ inner X' : 'φ Y';
  phiLabelBEl.textContent = mode === '2d' ? 'φ X vs Y' : 'φ Z';
  pianoHintEl.innerHTML = mode === '2d' ? HINT_2D : HINT_3D;

  const st = activeState();
  if (mode === '2d') { slPx.value = st.phiX; slPxy.value = st.phiXY; }
  else { slPx.value = st.phiY; slPxy.value = st.phiZ; }

  if (mode === '3d') resizeCube3D();
  fullRedraw();
  refreshPresetLabel();
  showPresetStatus('');
}

modeToggleBtn.addEventListener('click', () => setMode(mode === '2d' ? '3d' : '2d'));

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
resizeCube3D();
initTempButtons();
initPiano();
initSlots();
initSlots3D();
fullRedraw();
initMidi();

window.addEventListener('resize', () => {
  resizeCanvas();
  resizeCube3D();
  if (mode === '2d') updateCurveFast(); else updateCube3DFast();
});
