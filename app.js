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

// freqGroups is [xFreqs, yFreqs] — arbitrary-length (including empty) arrays,
// not necessarily the same length as each other (momentary mode can end up
// with an uneven split). Each axis's first note sits at phase 0 and every
// other note on that axis shares the one phase knob for that axis (phiX for
// X, phiXY for Y) — except a lone X note uses phiX directly, since there's
// no "other" note to offset it against. At 2-and-2 this reduces exactly to
// the original 4-note math.
function lissajous2D(freqGroups, phiX, phiXY) {
  const [xFreqs, yFreqs] = freqGroups;
  const all = [...xFreqs, ...yFreqs];
  const n = N_POINTS;
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  if (all.length === 0) return [x, y]; // nothing held — flat/empty curve
  const fMin = Math.min(...all);
  const rX = xFreqs.map(f => f / fMin);
  const rY = yFreqs.map(f => f / fMin);
  const T = period(all);
  const dt = (2 * Math.PI * T) / (n - 1);
  let xMax = 1e-12, yMax = 1e-12;
  for (let i = 0; i < n; i++) {
    const t = i * dt;
    let xv = 0, yv = 0;
    for (let j = 0; j < rX.length; j++) xv += Math.sin(rX[j] * t + ((j === 0 && rX.length > 1) ? 0 : phiX));
    for (let j = 0; j < rY.length; j++) yv += Math.sin(rY[j] * t + phiXY);
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

// notes/octs arrays are always fixed at 6 slots (the largest any mode ever
// needs); noteCount says how many of them are actually in play. Slots beyond
// noteCount just sit unused, keeping whatever value they last had, so
// switching note-count back and forth doesn't lose anything.
const state = {
  notes: ['A', 'E', 'D', 'A', 'G', 'C'],
  octs: [4, 5, 5, 5, 4, 5],
  noteCount: 4, // 2, 4, or 6 — notes summed per axis is noteCount/2
  phiX: 0.0,
  phiXY: Math.PI / 4,
  temp: TEMP_NAMES[0],
  activeSlot: 0,
  baseOctave: 4,
  animPhiX: false,
  animPhiXY: false,
};

// temp is kept in sync with `state.temp` (temperament is shared across both
// modes); phiY/phiZ are 3D's analogue of phiX/phiXY.
const state3d = {
  notes: ['C', 'G', 'C', 'E', 'D', 'A'],
  octs: [4, 4, 5, 4, 5, 4],
  noteCount: 3, // 3 or 6 — notes summed per axis is noteCount/3
  phiY: Math.PI / 4,
  phiZ: Math.PI / 3,
  temp: TEMP_NAMES[0],
  activeSlot: 0,
  baseOctave: 4,
  animPhiY: false,
  animPhiZ: false,
  autoRotate: false,
};

const NOTE_COLS = ['#ff6644', '#ffbb44', '#44ddbb', '#4499ff', '#cc77ff', '#ff5599'];
const AXIS_COLS_3D = ['#ff9955', '#55ccff', '#66ffaa']; // X, Y, Z label colors
const AXIS_NAMES_3D = ['X', 'Y', 'Z'];
function axisLetterHtml(letter) {
  return `<span style="color:${AXIS_COLS_3D[AXIS_NAMES_3D.indexOf(letter)]}">${letter}</span>`;
}

function activeState()     { return mode === '2d' ? state : state3d; }
// 3-note 3D keeps its axis-themed palette; everything else (2D at any count,
// 6-note 3D) uses the general 6-color note palette, sliced to length.
function activeNoteCols()  { return (mode === '3d' && state3d.noteCount === 3) ? AXIS_COLS_3D : NOTE_COLS; }
function activeSlotCount() { return activeState().noteCount; }
function activeFreqs() {
  if (inputMode === 'momentary') return currentNoteGroups().flat().map(n => n.freq);
  const st = activeState();
  const n = activeSlotCount();
  return Array.from({ length: n }, (_, i) => noteFreq(st.notes[i], st.octs[i], st.temp));
}

// ---------------------------------------------------------------------------
// Latch vs momentary input
//
// Latch (the original behavior): a key assigns a note to the next slot and
// it stays there until reassigned — a fixed noteCount, fixed axis split.
//
// Momentary: a key/MIDI note/piano click is only "on" while held. There's no
// fixed note count or axis split — heldNotes is just the set currently down,
// in press order, and it's redistributed across the current mode's axes
// (2 for 2D, 3 for 3D) round-robin: held note i goes to axis i % numAxes.
// Releasing one re-numbers the survivors in place, which naturally rebalances
// the axes to within one note of each other without any extra bookkeeping.
// ---------------------------------------------------------------------------
let inputMode = 'latch'; // 'latch' | 'momentary'
let heldNotes = []; // [{voiceKey, source, note, octave}], oldest first

function currentAxisCount() { return mode === '2d' ? 2 : 3; }

// Returns one array of {note, octave, freq} per axis (2 for 2D, 3 for 3D) —
// the single source of truth both the curve math and the on-screen labels
// draw from, whichever input mode is active.
function currentNoteGroups() {
  const numAxes = currentAxisCount();
  const temp = activeState().temp;
  if (inputMode === 'momentary') {
    const groups = Array.from({ length: numAxes }, () => []);
    heldNotes.forEach((hn, i) => {
      groups[i % numAxes].push({ note: hn.note, octave: hn.octave, freq: noteFreq(hn.note, hn.octave, temp) });
    });
    return groups;
  }
  const st = activeState();
  const n = st.noteCount, k = n / numAxes;
  const groups = [];
  for (let a = 0; a < numAxes; a++) {
    const g = [];
    for (let j = 0; j < k; j++) {
      const i = a * k + j;
      g.push({ note: st.notes[i], octave: st.octs[i], freq: noteFreq(st.notes[i], st.octs[i], st.temp) });
    }
    groups.push(g);
  }
  return groups;
}

function addHeldNote(voiceKey, note, octave, source) {
  if (heldNotes.some(hn => hn.voiceKey === voiceKey)) return; // already down (e.g. key-repeat)
  heldNotes.push({ voiceKey, source, note, octave });
  fullRedraw();
}

function removeHeldNote(voiceKey) {
  const before = heldNotes.length;
  heldNotes = heldNotes.filter(hn => hn.voiceKey !== voiceKey);
  if (heldNotes.length !== before) fullRedraw();
}

// Safety net for missed keyup events (e.g. alt-tabbing away while a key is
// held) — only clears computer-keyboard-sourced notes; MIDI/piano are left
// alone since a physical controller keeps sending its own note-offs.
function releaseAllKeyboardHeldNotes() {
  if (!heldNotes.some(hn => hn.source === 'kbd')) return;
  heldNotes = heldNotes.filter(hn => hn.source !== 'kbd');
  fullRedraw();
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

// In momentary mode a piano key behaves like a real key: held down (pointer
// capture keeps the release event coming even if the pointer drifts off the
// key) while the pointer is down, released on pointerup/cancel. In latch
// mode a click just assigns it to the active slot, as always.
function wirePianoKey(el, k, stopPropagationOnDown) {
  const voiceKey = `piano-${k.note}-${k.octave}`;
  el.addEventListener('pointerdown', (ev) => {
    if (stopPropagationOnDown) ev.stopPropagation();
    if (inputMode === 'momentary') {
      el.setPointerCapture(ev.pointerId);
      addHeldNote(voiceKey, k.note, k.octave, 'piano');
    } else {
      assignNoteToActiveSlot(k.note, k.octave);
    }
  });
  el.addEventListener('pointerup', () => { if (inputMode === 'momentary') removeHeldNote(voiceKey); });
  el.addEventListener('pointercancel', () => { if (inputMode === 'momentary') removeHeldNote(voiceKey); });
}

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
    wirePianoKey(el, k, false);
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
    wirePianoKey(el, k, true);
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
  const whiteW = initPiano._whiteW;
  // reset colors
  for (const k of pianoKeys) {
    const el = pianoKeyEls[`${k.note}|${k.octave}`];
    el.style.background = k.isBlack ? 'var(--pia-black)' : 'var(--pia-white)';
  }
  if (inputMode === 'momentary') {
    // No fixed note/color assignment here — just color whichever keys are
    // currently held, by whichever axis they'd currently land on.
    const numAxes = currentAxisCount();
    const axisCols = mode === '2d' ? ['var(--x-col)', 'var(--y-col)'] : AXIS_COLS_3D;
    heldNotes.forEach((hn, i) => {
      const el = pianoKeyEls[`${hn.note}|${hn.octave}`];
      if (el) el.style.background = axisCols[i % numAxes];
    });
  } else {
    const cols = activeNoteCols();
    for (let i = 0; i < st.noteCount; i++) {
      const key = `${st.notes[i]}|${st.octs[i]}`;
      const el = pianoKeyEls[key];
      if (el) el.style.background = cols[i];
    }
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

// Built once for the max (6 notes); drawSlot() shows/hides and relabels them
// as the note-count radio changes. Placement alternates left/right by global
// index, same as always — with the default 4-note count this still pairs
// each column's two cards as one X note + one Y note.
const MAX_SLOTS_2D = 6;

function initSlots() {
  for (let i = 0; i < MAX_SLOTS_2D; i++) {
    const root = document.createElement('div');
    root.className = 'slot';
    root.innerHTML = `
      <div class="s-title"></div>
      <div class="s-axis"></div>
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
      axis: root.querySelector('.s-axis'),
    });
  }
}

function drawSlot(i) {
  const els = slotEls[i];
  if (i >= state.noteCount) { els.root.hidden = true; return; }
  els.root.hidden = false;

  const k = state.noteCount / 2;
  const isX = i < k;
  els.axis.textContent = isX ? 'X  AXIS' : 'Y  AXIS';
  els.axis.style.color = isX ? 'var(--x-col)' : 'var(--y-col)';
  els.title.textContent = `Note ${i + 1}`;

  const col = NOTE_COLS[i];
  const isAct = state.activeSlot === i;
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

// ---- 3D note slots: one per axis, or two side by side per axis in 6-note
// mode (X1/X2, Y1/Y2, Z1/Z2) so the column widens instead of getting tall ----
const slots3DEl = $('#slots3D');
const slotEls3D = []; // fixed addressing: slotEls3D[axis*2 + within], within ∈ {0,1}
const MAX_SLOTS_3D = 6;

// Built once for the max (6 notes = 2 per axis), grouped into one row div per
// axis. drawSlot3D() shows/hides the "within=1" card and relabels/repositions
// data as the note-count radio changes — the DOM position (which axis-row,
// which side) never moves; only which *data* index (axis*k + within, for the
// current k) it displays does.
function initSlots3D() {
  for (let axis = 0; axis < 3; axis++) {
    const row = document.createElement('div');
    row.className = 'axis-row-3d';
    slots3DEl.appendChild(row);
    for (let within = 0; within < 2; within++) {
      const root = document.createElement('div');
      root.className = 'slot';
      root.innerHTML = `
        <div class="s-title"></div>
        <div class="s-axis"></div>
        <div class="s-note"></div>
        <div class="s-freq"></div>
        <div class="s-status"></div>`;
      root.addEventListener('click', () => {
        const k = state3d.noteCount / 3;
        if (within >= k) return; // not active at the current note count
        state3d.activeSlot = axis * k + within;
        redrawSlots();
      });
      row.appendChild(root);
      slotEls3D.push({
        root,
        note: root.querySelector('.s-note'),
        freq: root.querySelector('.s-freq'),
        status: root.querySelector('.s-status'),
        title: root.querySelector('.s-title'),
        axis: root.querySelector('.s-axis'),
      });
    }
  }
}

function drawSlot3D(fi) {
  const els = slotEls3D[fi];
  const axis = Math.floor(fi / 2), within = fi % 2;
  const k = state3d.noteCount / 3;
  if (within >= k) { els.root.hidden = true; return; }
  els.root.hidden = false;

  const dataIdx = axis * k + within;
  const axisName = AXIS_NAMES_3D[axis];
  els.title.textContent = k > 1 ? `${axisName}${within + 1} Note` : `${axisName} Note`;
  els.axis.textContent = `${axisName}  AXIS`;
  els.axis.style.color = AXIS_COLS_3D[axis];

  const col = activeNoteCols()[dataIdx];
  const isAct = state3d.activeSlot === dataIdx;
  els.root.style.borderColor = col;
  els.root.style.borderWidth = isAct ? '2.5px' : '1px';
  els.title.style.color = isAct ? col : '#445566';
  els.note.textContent = `${state3d.notes[dataIdx]}${state3d.octs[dataIdx]}`;
  els.note.style.color = col;
  els.freq.textContent = `${noteFreq(state3d.notes[dataIdx], state3d.octs[dataIdx], state3d.temp).toFixed(1)} Hz`;
  if (isAct) {
    els.status.textContent = '▲  ACTIVE';
    els.status.style.color = col;
  } else {
    els.status.textContent = `press  ${dataIdx + 1}`;
    els.status.style.color = '#2a3a4a';
  }
}

function redrawSlots() {
  if (mode === '2d') { for (let i = 0; i < MAX_SLOTS_2D; i++) drawSlot(i); }
  else { for (let i = 0; i < MAX_SLOTS_3D; i++) drawSlot3D(i); }
}

// ---------------------------------------------------------------------------
// Note-count radios — 2/4/6 in 2D (notes summed per axis = count/2), 3/6 in
// 3D (per axis = count/3). One shared row of up to 3 radios; which options
// show and which is checked depends on the current mode.
// ---------------------------------------------------------------------------
const NOTE_COUNTS_2D = [2, 4, 6];
const NOTE_COUNTS_3D = [3, 6];
const noteCountRow = $('#noteCountRow');
const ncRadios = [$('#ncRadio0'), $('#ncRadio1'), $('#ncRadio2')];
const ncTexts = [$('#ncText0'), $('#ncText1'), $('#ncText2')];

function updateNoteCountUI() {
  const options = mode === '2d' ? NOTE_COUNTS_2D : NOTE_COUNTS_3D;
  const current = activeState().noteCount;
  ncRadios.forEach((radio, i) => {
    const opt = options[i];
    const optLabel = radio.closest('.notecount-opt');
    if (opt === undefined) { optLabel.hidden = true; return; }
    optLabel.hidden = false;
    radio.value = opt;
    radio.checked = opt === current;
    ncTexts[i].textContent = `${opt} notes`;
  });
}

function setNoteCount(n) {
  const st = activeState();
  st.noteCount = n;
  st.activeSlot = Math.min(st.activeSlot, n - 1);
  updateNoteCountUI();
  updatePianoHint();
  if (mode === '3d') resizeCube3D(); // slot column widens for the 2-per-axis (6-note) layout
  fullRedraw();
}

ncRadios.forEach(radio => {
  radio.addEventListener('change', () => {
    if (radio.checked) setNoteCount(Number(radio.value));
  });
});

// ---------------------------------------------------------------------------
// Latch / momentary toggle
// ---------------------------------------------------------------------------
const modeLatchRadio = $('#modeLatchRadio');
const modeMomentaryRadio = $('#modeMomentaryRadio');

// STL export needs a preset-like "this is the chord" concept the same way
// presets do, so it's hidden in momentary mode too (on top of only ever
// showing in 3D) — called from both the mode toggle and this one.
function updateExportStlVisibility() {
  exportStlBtn.hidden = mode !== '3d' || inputMode === 'momentary';
}

function updateInputModeUI() {
  const isMomentary = inputMode === 'momentary';
  modeLatchRadio.checked = !isMomentary;
  modeMomentaryRadio.checked = isMomentary;
  // The colored slot boxes assume a fixed note count, which momentary mode
  // doesn't have — hide them (the piano key coloring is enough on its own).
  // Note count and presets are latch-only concepts too, so hide those
  // controls rather than leave ones that do nothing active.
  slotsLeftEl.hidden = isMomentary;
  slotsRightEl.hidden = isMomentary;
  slots3DEl.hidden = isMomentary;
  noteCountRow.hidden = isMomentary;
  document.querySelectorAll('.preset-only').forEach(el => { el.hidden = isMomentary; });
  updateExportStlVisibility();
}

function setInputMode(newInputMode) {
  inputMode = newInputMode;
  if (inputMode === 'latch') heldNotes = []; // don't carry stuck momentary notes into latch mode
  updateInputModeUI();
  updatePianoHint();
  if (mode === '3d') resizeCube3D(); // slots3D's width budget changes when it's hidden/shown
  fullRedraw();
}

modeLatchRadio.addEventListener('change', () => { if (modeLatchRadio.checked) setInputMode('latch'); });
modeMomentaryRadio.addEventListener('change', () => { if (modeMomentaryRadio.checked) setInputMode('momentary'); });

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

let _last2D = null; // cached [x,y] so the visualizer overlay can redraw independently

function drawCurve(x, y) {
  renderCurveToCtx(curveCtx, CURVE_SIZE, CURVE_SIZE, x, y);
  _last2D = [x, y];
  syncViz();
}

// Standalone PNG snapshot of a curve — used when saving/importing a preset.
function renderCurveSnapshot(freqGroups, phiX, phiXY, size = 480) {
  const [x, y] = lissajous2D(freqGroups, phiX, phiXY);
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

// Describes one axis's summed notes: "A4 (440.0 Hz) + E5 (660.0 Hz)   [3:2 –
// Perfect 5th]". The bracketed ratio only makes sense for exactly two notes,
// so it's omitted for 1 or 3 notes per axis.
function axisLabelText(names, octs, freqs) {
  const parts = freqs.map((f, i) => `${names[i]}${octs[i]} (${f.toFixed(1)} Hz)`);
  let s = parts.join(' + ');
  if (freqs.length === 2) {
    const [r, iv] = describeRatio(freqs[0], freqs[1]);
    s += `   [${r}${iv ? ` – ${iv}` : ''}]`;
  }
  return s;
}

function updateCurveFull() {
  const [xGroup, yGroup] = currentNoteGroups();
  const xFreqs = xGroup.map(nn => nn.freq), yFreqs = yGroup.map(nn => nn.freq);
  const [x, y] = lissajous2D([xFreqs, yFreqs], state.phiX, state.phiXY);
  drawCurve(x, y);

  xLabelEl.textContent = axisLabelText(xGroup.map(nn => nn.note), xGroup.map(nn => nn.octave), xFreqs);
  yLabelEl.textContent = axisLabelText(yGroup.map(nn => nn.note), yGroup.map(nn => nn.octave), yFreqs);

  const freqs = [...xFreqs, ...yFreqs];
  if (audioEngine.on) audioEngine.setFreqs(freqs);
  return freqs;
}

function updateCurveFast() {
  const [xGroup, yGroup] = currentNoteGroups();
  const xFreqs = xGroup.map(nn => nn.freq), yFreqs = yGroup.map(nn => nn.freq);
  const [x, y] = lissajous2D([xFreqs, yFreqs], state.phiX, state.phiXY);
  drawCurve(x, y);
}

// ---------------------------------------------------------------------------
// 3D Lissajous — one note per axis, drawn as a true 3D curve you can drag to
// rotate, with its three 2D projections (top/front/side) shown alongside.
// ---------------------------------------------------------------------------
const N_POINTS_3D = 3000;

// freqGroups is [xFreqs, yFreqs, zFreqs] — arbitrary-length (including empty)
// arrays. X's note(s) always sit at phase 0 (the reference axis, as before);
// every note on Y shares phiY, every note on Z shares phiZ. At 1-and-1-and-1
// this reduces exactly to the original one-note-per-axis math.
function lissajous3(freqGroups, phiY, phiZ) {
  const [xFreqs, yFreqs, zFreqs] = freqGroups;
  const all = [...xFreqs, ...yFreqs, ...zFreqs];
  const n = N_POINTS_3D;
  const x = new Float64Array(n), y = new Float64Array(n), z = new Float64Array(n);
  if (all.length === 0) return [x, y, z]; // nothing held — flat/empty curve
  const fMin = Math.min(...all);
  const rX = xFreqs.map(f => f / fMin);
  const rY = yFreqs.map(f => f / fMin);
  const rZ = zFreqs.map(f => f / fMin);
  const T = period(all);
  const dt = (2 * Math.PI * T) / (n - 1);
  for (let i = 0; i < n; i++) {
    const t = i * dt;
    let xv = 0, yv = 0, zv = 0;
    for (let j = 0; j < rX.length; j++) xv += Math.sin(rX[j] * t);
    for (let j = 0; j < rY.length; j++) yv += Math.sin(rY[j] * t + phiY);
    for (let j = 0; j < rZ.length; j++) zv += Math.sin(rZ[j] * t + phiZ);
    x[i] = xv; y[i] = yv; z[i] = zv;
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
// rotation — shared by the live canvas, the offscreen preset snapshot, and
// (with the wireframe/labels switched off) the bare-curve visualizer.
function renderCube3DToCtx(ctx, size, x, y, z, rot = rot3D, opts = {}) {
  const { wireframe = true, labels = true } = opts;
  ctx.clearRect(0, 0, size, size);

  if (wireframe) {
    ctx.strokeStyle = DIM_COL;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.8;
    for (const [a, b] of CUBE_EDGES) {
      const [ax, ay] = cubeToScreen(...project3D(...a, rot).slice(0, 2), size);
      const [bx, by] = cubeToScreen(...project3D(...b, rot).slice(0, 2), size);
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

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

  if (labels) {
    // Labels sit on whichever face matplotlib-style axes would render as a
    // background wall at this rotation — computed once for the app's default
    // angle; if you rotate a lot they may drift from a truly "far" face, same
    // simplification the desktop app makes.
    drawCubeLabel(ctx, size, 'Y–Z', [-1.32, 0, 0], [0, 1, 0], '#7a8fa8', rot);
    drawCubeLabel(ctx, size, 'X–Z', [0, 1.32, 0], [1, 0, 0], '#7a8fa8', rot);
    drawCubeLabel(ctx, size, 'X–Y', [0, 0, -1.32], [0, 1, 0], '#7a8fa8', rot);
  }
}

const projTopCanvas = $('#projTop');
const projFrontCanvas = $('#projFront');
const projSideCanvas = $('#projSide');
const projTopCtx = projTopCanvas.getContext('2d');
const projFrontCtx = projFrontCanvas.getContext('2d');
const projSideCtx = projSideCanvas.getContext('2d');
const projTopTitleEl = $('#projTopTitle');
const projFrontTitleEl = $('#projFrontTitle');
const projSideTitleEl = $('#projSideTitle');
let PROJ_TOPFRONT_SIZE = 200; // logical (CSS-pixel) canvas size; kept in sync by resizeCube3DRow()
let PROJ_SIDE_SIZE = 220;

let _last3D = null; // cached [x,y,z] so drag-rotate doesn't recompute the curve

// Ratio annotation on the TOP/FRONT/SIDE titles only makes sense when
// there's exactly one note per axis to compare — omitted for 6-note mode.
// Ratio annotation only makes sense when there's exactly one note on each of
// the two axes being compared — omitted otherwise (more than one per axis,
// or momentary mode having left one of them empty).
function proj3DRatioSuffix(groupA, groupB) {
  if (groupA.length !== 1 || groupB.length !== 1) return '';
  const [r, iv] = describeRatio(groupA[0].freq, groupB[0].freq);
  return `   [${r}${iv ? ` – ${iv}` : ''}]`;
}

function updateCube3DFull() {
  const [xGroup, yGroup, zGroup] = currentNoteGroups();
  const xFreqs = xGroup.map(n => n.freq), yFreqs = yGroup.map(n => n.freq), zFreqs = zGroup.map(n => n.freq);
  const [x, y, z] = lissajous3([xFreqs, yFreqs, zFreqs], state3d.phiY, state3d.phiZ);
  _last3D = [x, y, z];

  renderCube3DToCtx(cube3dCtx, CUBE_SIZE, x, y, z);
  syncViz();
  renderCurveToCtx(projTopCtx, PROJ_TOPFRONT_SIZE, PROJ_TOPFRONT_SIZE, x, z);
  renderCurveToCtx(projFrontCtx, PROJ_TOPFRONT_SIZE, PROJ_TOPFRONT_SIZE, x, y);
  renderCurveToCtx(projSideCtx, PROJ_SIDE_SIZE, PROJ_SIDE_SIZE, y, z);

  // Color-codes the axis letters to double as a legend for which of the
  // three key/curve colors is which axis — otherwise nothing on screen says
  // so once the (axis-labeled) slot boxes are hidden in momentary mode.
  projTopTitleEl.innerHTML   = `TOP (${axisLetterHtml('X')}–${axisLetterHtml('Z')})${proj3DRatioSuffix(xGroup, zGroup)}`;
  projFrontTitleEl.innerHTML = `FRONT (${axisLetterHtml('X')}–${axisLetterHtml('Y')})${proj3DRatioSuffix(xGroup, yGroup)}`;
  projSideTitleEl.innerHTML  = `SIDE (${axisLetterHtml('Y')}–${axisLetterHtml('Z')})${proj3DRatioSuffix(yGroup, zGroup)}`;

  const freqs = [...xFreqs, ...yFreqs, ...zFreqs];
  if (audioEngine.on) audioEngine.setFreqs(freqs);
}

// Fast path for phase-slider drags: recompute the curve but skip re-reading
// note/frequency state (unchanged) — mirrors updateCurveFast().
function updateCube3DFast() {
  const [xGroup, yGroup, zGroup] = currentNoteGroups();
  const xFreqs = xGroup.map(n => n.freq), yFreqs = yGroup.map(n => n.freq), zFreqs = zGroup.map(n => n.freq);
  const [x, y, z] = lissajous3([xFreqs, yFreqs, zFreqs], state3d.phiY, state3d.phiZ);
  _last3D = [x, y, z];
  renderCube3DToCtx(cube3dCtx, CUBE_SIZE, x, y, z);
  syncViz();
  renderCurveToCtx(projTopCtx, PROJ_TOPFRONT_SIZE, PROJ_TOPFRONT_SIZE, x, z);
  renderCurveToCtx(projFrontCtx, PROJ_TOPFRONT_SIZE, PROJ_TOPFRONT_SIZE, x, y);
  renderCurveToCtx(projSideCtx, PROJ_SIDE_SIZE, PROJ_SIDE_SIZE, y, z);
  if (audioEngine.on) audioEngine.setFreqs([...xFreqs, ...yFreqs, ...zFreqs]);
}

// Rotation-only redraw for dragging the cube — the curve itself hasn't
// changed, so this skips recomputing lissajous3() and the (unaffected by
// rotation) projection panels.
function redrawCube3DRotationOnly() {
  if (!_last3D) return;
  const [x, y, z] = _last3D;
  renderCube3DToCtx(cube3dCtx, CUBE_SIZE, x, y, z);
  syncViz();
}

function renderCube3DSnapshot(freqGroups, phiY, phiZ, size = 480) {
  const [x, y, z] = lissajous3(freqGroups, phiY, phiZ);
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

// ---------------------------------------------------------------------------
// 3D-print export — turns the curve into a solid tube (so it has enough
// structural integrity to print) and writes it out as a binary STL, the
// format nearly every slicer (Cura, PrusaSlicer, Bambu Studio, …) expects.
// ---------------------------------------------------------------------------
const STL_WORLD_SCALE = 40;   // mm per unit — curve spans roughly ±1, so ~80mm overall
const STL_TUBE_RADIUS = 1.5;  // mm — ~3mm diameter, sturdy enough for FDM printing
const STL_TUBE_SIDES = 12;    // cross-section polygon
const STL_SAMPLE_EVERY = 6;   // thin N_POINTS_3D down to a print-friendly vertex count

function v3sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function v3add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
function v3scale(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
function v3dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function v3cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function v3norm(a) {
  const len = Math.hypot(a[0], a[1], a[2]) || 1e-9;
  return [a[0] / len, a[1] / len, a[2] / len];
}

// Tangent at each point of a closed polyline, from its two neighbors.
function tubeTangents(pts) {
  const n = pts.length;
  return pts.map((_, i) => v3norm(v3sub(pts[(i + 1) % n], pts[(i - 1 + n) % n])));
}

// Rotation-minimizing frame (Wang/Jüttler/Zheng/Liu "double reflection"
// method) — propagates a normal vector along the curve without the twist
// per-segment Frenet frames would introduce, which is what keeps the tube's
// cross-section from corkscrewing as it bends.
function tubeRotationMinimizingNormals(pts, tangents) {
  const n = pts.length;
  const normals = new Array(n);
  const arbitrary = Math.abs(tangents[0][1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  normals[0] = v3norm(v3cross(tangents[0], arbitrary));
  for (let i = 0; i < n - 1; i++) {
    const v1 = v3sub(pts[i + 1], pts[i]);
    const c1 = v3dot(v1, v1) || 1e-12;
    const rL = v3sub(normals[i], v3scale(v1, (2 * v3dot(v1, normals[i])) / c1));
    const tL = v3sub(tangents[i], v3scale(v1, (2 * v3dot(v1, tangents[i])) / c1));
    const v2 = v3sub(tangents[i + 1], tL);
    const c2 = v3dot(v2, v2) || 1e-12;
    normals[i + 1] = v3norm(v3sub(rL, v3scale(v2, (2 * v3dot(v2, rL)) / c2)));
  }
  return normals;
}

// Sweeps a `sides`-gon of the given radius around the closed centerline,
// producing a closed watertight tube (no end caps needed — the curve
// already loops back on itself after one Lissajous period).
function buildTubeTriangles(centerline, radius, sides) {
  const n = centerline.length;
  const tangents = tubeTangents(centerline);
  const normals = tubeRotationMinimizingNormals(centerline, tangents);
  const rings = centerline.map((p, i) => {
    const binormal = v3cross(tangents[i], normals[i]);
    const ring = new Array(sides);
    for (let s = 0; s < sides; s++) {
      const theta = (s / sides) * 2 * Math.PI;
      const offset = v3add(v3scale(normals[i], Math.cos(theta) * radius), v3scale(binormal, Math.sin(theta) * radius));
      ring[s] = v3add(p, offset);
    }
    return ring;
  });

  const triangles = [];
  for (let i = 0; i < n; i++) {
    const ringA = rings[i], ringB = rings[(i + 1) % n];
    for (let s = 0; s < sides; s++) {
      const s2 = (s + 1) % sides;
      triangles.push([ringA[s], ringA[s2], ringB[s2]]);
      triangles.push([ringA[s], ringB[s2], ringB[s]]);
    }
  }
  return triangles;
}

function trianglesToBinarySTL(triangles) {
  const buf = new ArrayBuffer(84 + 50 * triangles.length);
  const view = new DataView(buf);
  view.setUint32(80, triangles.length, true);
  let offset = 84;
  for (const [a, b, c] of triangles) {
    const n = v3norm(v3cross(v3sub(b, a), v3sub(c, a)));
    for (const component of n) { view.setFloat32(offset, component, true); offset += 4; }
    for (const vert of [a, b, c]) {
      for (const component of vert) { view.setFloat32(offset, component, true); offset += 4; }
    }
    view.setUint16(offset, 0, true); offset += 2; // unused "attribute byte count"
  }
  return buf;
}

function export3DPrintSTL() {
  if (!_last3D) return;
  const [xs, ys, zs] = _last3D;
  const centerline = [];
  for (let i = 0; i < xs.length; i += STL_SAMPLE_EVERY) {
    centerline.push([xs[i] * STL_WORLD_SCALE, ys[i] * STL_WORLD_SCALE, zs[i] * STL_WORLD_SCALE]);
  }
  const triangles = buildTubeTriangles(centerline, STL_TUBE_RADIUS, STL_TUBE_SIDES);
  downloadBlob('lissajous_3d.stl', trianglesToBinarySTL(triangles), 'model/stl');
}

// ---- drag-to-rotate (shared by the inline cube canvas and the visualizer) ----
function attachDragToRotate(canvas, onRotate) {
  let dragging = false, lastX = 0, lastY = 0;
  canvas.addEventListener('pointerdown', (ev) => {
    dragging = true;
    lastX = ev.clientX; lastY = ev.clientY;
    canvas.setPointerCapture(ev.pointerId);
  });
  canvas.addEventListener('pointermove', (ev) => {
    if (!dragging) return;
    const dx = ev.clientX - lastX, dy = ev.clientY - lastY;
    lastX = ev.clientX; lastY = ev.clientY;
    rot3D.azim += dx * 0.012;
    rot3D.elev = Math.max(-1.5, Math.min(1.5, rot3D.elev - dy * 0.012));
    onRotate();
  });
  canvas.addEventListener('pointerup', () => { dragging = false; });
  canvas.addEventListener('pointercancel', () => { dragging = false; });
}
attachDragToRotate(cube3dCanvas, redrawCube3DRotationOnly);

// Base (1x) widths of the 3D row's four elements — matches the .slots-col-3d/
// canvas sizes in the CSS/HTML — plus the row's fixed (unscaled) gap. Scaling
// all four by the same factor keeps their proportions to each other while
// making the whole row exactly as wide as the piano/panel above it, so the
// note slots line up with the keyboard's left edge and the TOP/FRONT stack
// lines up with its right edge.
const CUBE3D_BASE_SLOTS_W = 104;
const CUBE3D_BASE_SIDE = 220;
const CUBE3D_BASE_CUBE = 480;
const CUBE3D_BASE_TOPFRONT = 200;
const CUBE3D_ROW_GAP = 10;
const CUBE3D_BASE_TOTAL =
  CUBE3D_BASE_SLOTS_W + CUBE3D_BASE_SIDE + CUBE3D_BASE_CUBE + CUBE3D_BASE_TOPFRONT + 3 * CUBE3D_ROW_GAP;

// Below this the CSS switches .main-row-3d to a stacked mobile layout (see
// the @media rule) — matches that breakpoint exactly.
const CUBE3D_MOBILE_BREAKPOINT = 720;

function resizeCube3D() {
  const dpr = window.devicePixelRatio || 1;

  function sizeCanvas(canvas, ctx, size) {
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  if (window.innerWidth <= CUBE3D_MOBILE_BREAKPOINT) {
    // Let the mobile CSS govern (vw-based cube, full-width note slots)
    // instead of the desktop proportional scaling below — clear any inline
    // sizes a wider layout may have left behind, then just keep each
    // canvas's pixel buffer crisp at whatever size the CSS gives it.
    slots3DEl.style.width = '';
    for (const [canvas, ctx, base] of [
      [cube3dCanvas, cube3dCtx, CUBE3D_BASE_CUBE],
      [projSideCanvas, projSideCtx, CUBE3D_BASE_SIDE],
      [projTopCanvas, projTopCtx, CUBE3D_BASE_TOPFRONT],
      [projFrontCanvas, projFrontCtx, CUBE3D_BASE_TOPFRONT],
    ]) {
      canvas.style.width = '';
      canvas.style.height = '';
      const size = canvas.clientWidth || base;
      sizeCanvas(canvas, ctx, size);
      if (canvas === cube3dCanvas) CUBE_SIZE = size;
      else if (canvas === projSideCanvas) PROJ_SIDE_SIZE = size;
      else PROJ_TOPFRONT_SIZE = size;
    }
    return;
  }

  // The cube matches the 2D curve's size exactly (not its own independent
  // scale) so the graph itself is the same height in both modes and nothing
  // below it jumps up or down when you toggle. The other three elements then
  // scale together to soak up whatever width is left, keeping the row's
  // total width matched to the keyboard above it.
  const panel = document.querySelector('.panel');
  const available = (panel && panel.clientWidth) || CUBE3D_BASE_TOTAL;
  const cubeSize = CURVE_SIZE;
  // Momentary mode hides the note-slot column entirely (see
  // updateInputModeUI()) — a hidden flex item takes no width and no gap, so
  // its budget needs to go entirely to the rest of the row instead.
  const slotsHidden = slots3DEl.hidden;
  // 6-note mode shows two note-cards per axis row (X1/X2, Y1/Y2, Z1/Z2)
  // side by side instead of one tall stack, so that column needs roughly
  // double the width to stay legible.
  const slotsBase = slotsHidden ? 0 : CUBE3D_BASE_SLOTS_W * (state3d.noteCount === 6 ? 2 : 1);
  const gapCount = slotsHidden ? 2 : 3;
  const othersBase = slotsBase + CUBE3D_BASE_SIDE + CUBE3D_BASE_TOPFRONT;
  const remaining = available - cubeSize - gapCount * CUBE3D_ROW_GAP;
  const scale = Math.max(0.2, remaining / othersBase);

  const slotsW = Math.round(slotsBase * scale);
  const sideSize = Math.round(CUBE3D_BASE_SIDE * scale);
  const topFrontSize = Math.round(CUBE3D_BASE_TOPFRONT * scale);

  if (!slotsHidden) slots3DEl.style.width = `${slotsW}px`;
  sizeCanvas(cube3dCanvas, cube3dCtx, cubeSize);
  sizeCanvas(projSideCanvas, projSideCtx, sideSize);
  sizeCanvas(projTopCanvas, projTopCtx, topFrontSize);
  sizeCanvas(projFrontCanvas, projFrontCtx, topFrontSize);

  CUBE_SIZE = cubeSize;
  PROJ_SIDE_SIZE = sideSize;
  PROJ_TOPFRONT_SIZE = topFrontSize;
}

function fullRedraw() {
  redrawSlots();
  updatePiano();
  if (mode === '2d') updateCurveFull();
  else updateCube3DFull();
}

// ---------------------------------------------------------------------------
// Full-screen visualizer — just the curve, large, on black, no axes/grid/
// wireframe behind it. Meant for projecting during a live performance while
// still playing notes normally (piano/keyboard/MIDI keep working underneath).
// ---------------------------------------------------------------------------
const vizOverlay = $('#vizOverlay');
const vizCanvas = $('#vizCanvas');
const vizCtx = vizCanvas.getContext('2d');
const vizToggleBtn = $('#vizToggle');
const vizExitBtn = $('#vizExit');
const vizHintEl = $('#vizHint');

let vizActive = false;
let VIZ_SIZE = 0;

function resizeVizCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const size = Math.floor(Math.min(window.innerWidth, window.innerHeight) * 0.92);
  VIZ_SIZE = size;
  vizCanvas.style.width = `${size}px`;
  vizCanvas.style.height = `${size}px`;
  vizCanvas.width = size * dpr;
  vizCanvas.height = size * dpr;
  vizCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

// Called from every place that already redraws the small on-screen curve/cube
// — a no-op unless the overlay is open, so it's cheap to sprinkle everywhere.
function syncViz() {
  if (!vizActive) return;
  if (mode === '2d') {
    if (!_last2D) return;
    renderCurveToCtx(vizCtx, VIZ_SIZE, VIZ_SIZE, _last2D[0], _last2D[1], /* withGrid */ false);
  } else {
    if (!_last3D) return;
    renderCube3DToCtx(vizCtx, VIZ_SIZE, ..._last3D, rot3D, { wireframe: false, labels: false });
  }
}

attachDragToRotate(vizCanvas, redrawCube3DRotationOnly);

function enterViz() {
  vizActive = true;
  vizOverlay.hidden = false;
  vizOverlay.classList.toggle('mode-3d', mode === '3d');
  vizHintEl.textContent = mode === '3d' ? 'Drag to rotate  ·  Esc to exit' : 'Esc to exit';
  resizeVizCanvas();
  syncViz();
  const req = vizOverlay.requestFullscreen || vizOverlay.webkitRequestFullscreen;
  if (req) req.call(vizOverlay).catch?.(() => {});
}

function exitViz() {
  vizActive = false;
  vizOverlay.hidden = true;
  if (document.fullscreenElement) {
    (document.exitFullscreen || document.webkitExitFullscreen)?.call(document).catch?.(() => {});
  }
}

vizToggleBtn.addEventListener('click', enterViz);
vizExitBtn.addEventListener('click', exitViz);
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement && vizActive) exitViz();
});
window.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && vizActive) exitViz();
});
window.addEventListener('resize', () => {
  if (vizActive) { resizeVizCanvas(); syncViz(); }
});

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

// Slow auto-rotate for the 3D cube (a full turn takes about a minute) — handy
// for a hands-off live-performance visual.
const ROTATE_STEP = 0.006; // radians per 40ms tick
const rotateToggleBtn = $('#rotateToggle');
rotateToggleBtn.addEventListener('click', () => {
  state3d.autoRotate = !state3d.autoRotate;
  rotateToggleBtn.classList.toggle('on', state3d.autoRotate);
});

const exportStlBtn = $('#exportStlBtn');
exportStlBtn.addEventListener('click', export3DPrintSTL);

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
    if (st.autoRotate) {
      rot3D.azim = (rot3D.azim + ROTATE_STEP) % TWO_PI;
      if (!changed) redrawCube3DRotationOnly(); // updateCube3DFast() above already redrew this frame
    }
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

// Clicking any button or radio (mode toggle, temperament, note count, …)
// leaves it focused; note-playing keydowns still reach window either way,
// but a lingering focus ring is confusing and (for buttons specifically) a
// held Space/Enter would double as "click this button again". Blurring
// right after the click keeps focus neutral so the keyboard always plays
// notes immediately, with no need to click the piano first.
document.addEventListener('click', (ev) => {
  const el = ev.target.closest('button, input[type="radio"]');
  if (el) el.blur();
});

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

  // Slot/axis selection only means something in latch mode — momentary mode
  // has no fixed slots to select.
  if (inputMode === 'latch') {
    const digits = Array.from({ length: n }, (_, i) => String(i + 1));
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
    if (ev.repeat) return; // held key auto-repeats keydown; momentary mode already has it down
    const [semi, octOff] = KB_MAP[key];
    const note = NOTE_NAMES[semi];
    let octave = st.baseOctave + octOff;
    octave = Math.max(PIANO_OCT_LOW, Math.min(PIANO_OCT_HIGH, octave));
    if (inputMode === 'momentary') {
      addHeldNote(key, note, octave, 'kbd');
    } else {
      const slot = st.activeSlot;
      st.notes[slot] = note;
      st.octs[slot] = octave;
      st.activeSlot = (slot + 1) % n;
      fullRedraw();
    }
  }
});

window.addEventListener('keyup', (ev) => {
  const activeTag = document.activeElement && document.activeElement.tagName;
  if (activeTag === 'INPUT' || activeTag === 'TEXTAREA') return;
  if (inputMode !== 'momentary') return;
  const key = ev.key.toLowerCase();
  if (key in KB_MAP) removeHeldNote(key);
});

// Safety net: if a keyup is missed (e.g. alt-tabbing away mid-note), don't
// leave a note stuck on forever.
window.addEventListener('blur', releaseAllKeyboardHeldNotes);

// ---------------------------------------------------------------------------
// MIDI input (Web MIDI API)
// ---------------------------------------------------------------------------
function handleMidiNoteOn(midiNote) {
  const note = NOTE_NAMES[midiNote % 12];
  const octave = Math.floor(midiNote / 12) - 1;
  if (inputMode === 'momentary') {
    addHeldNote(`midi-${midiNote}`, note, octave, 'midi');
    return;
  }
  const st = activeState();
  const n = activeSlotCount();
  const slot = st.activeSlot;
  st.notes[slot] = note;
  st.octs[slot] = octave;
  st.activeSlot = (slot + 1) % n;
  fullRedraw();
}

function handleMidiNoteOff(midiNote) {
  if (inputMode === 'momentary') removeHeldNote(`midi-${midiNote}`);
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
        if (type === 0x90 && velocity > 0) handleMidiNoteOn(note);
        else if (type === 0x80 || (type === 0x90 && velocity === 0)) handleMidiNoteOff(note);
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
// -1 when empty. Must count only the *current mode's* presets (modePresets()),
// not presets.length — with a mix of saved 2D and 3D presets, indexing the
// filtered list with an unfiltered count could point past its end.
let presetIdx = modePresets().length - 1;

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

// Copies as many notes/octaves as the preset provides into the fixed
// 6-slot state arrays, leaving any remaining slots at whatever they already
// were — handles both current (always 6-length) and older, shorter presets.
function applyPresetNotes(st, notes, octs) {
  for (let i = 0; i < notes.length && i < 6; i++) { st.notes[i] = notes[i]; st.octs[i] = octs[i]; }
}

function applyPreset(p) {
  // Temperament is shared, so applying a preset updates it on both states
  // regardless of which mode the preset itself belongs to.
  state.temp = p.temperament;
  state3d.temp = p.temperament;
  if (mode === '2d') {
    state.noteCount = p.noteCount || (NOTE_COUNTS_2D.includes(p.notes.length) ? p.notes.length : 4);
    applyPresetNotes(state, p.notes, p.octaves);
    state.activeSlot = Math.min(state.activeSlot, state.noteCount - 1);
    const ph = presetPhases(p);
    state.phiX = ph.phiX;
    state.phiXY = ph.phiXY;
    slPx.value = state.phiX;
    slPxy.value = state.phiXY;
  } else {
    state3d.noteCount = p.noteCount || (NOTE_COUNTS_3D.includes(p.notes.length) ? p.notes.length : 3);
    applyPresetNotes(state3d, p.notes, p.octaves);
    state3d.activeSlot = Math.min(state3d.activeSlot, state3d.noteCount - 1);
    const ph = p.phases || {};
    state3d.phiY = ph.phiY;
    state3d.phiZ = ph.phiZ;
    slPx.value = state3d.phiY;
    slPxy.value = state3d.phiZ;
  }
  tempDescEl.textContent = TEMP_DESCRIPTIONS[activeState().temp];
  styleTempButtons();
  updateNoteCountUI();
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
    const [xGroup, yGroup] = currentNoteGroups();
    const groups = [xGroup.map(n => n.freq), yGroup.map(n => n.freq)];
    try { image = renderCurveSnapshot(groups, st.phiX, st.phiXY); } catch (e) { image = null; }
    preset = {
      name, mode: '2d', noteCount: st.noteCount,
      notes: [...st.notes], octaves: [...st.octs],
      phases: { phiX: st.phiX, phiXY: st.phiXY },
      temperament: st.temp,
      created: new Date().toISOString(),
    };
  } else {
    const [xGroup, yGroup, zGroup] = currentNoteGroups();
    const groups = [xGroup.map(n => n.freq), yGroup.map(n => n.freq), zGroup.map(n => n.freq)];
    try { image = renderCube3DSnapshot(groups, st.phiY, st.phiZ); } catch (e) { image = null; }
    preset = {
      name, mode: '3d', noteCount: st.noteCount,
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

function updatePianoHint() {
  let base;
  if (inputMode === 'momentary') {
    base = 'Hold a key &nbsp;&middot;&nbsp; A&ndash;J = C&ndash;B (home oct) &nbsp;&middot;&nbsp; K,O,L,P = next oct &nbsp;&middot;&nbsp; ' +
      '[ ] shift octave &nbsp;&middot;&nbsp; Space = sound on/off';
  } else {
    const n = activeSlotCount();
    base = 'Click a key &nbsp;&middot;&nbsp; A&ndash;J = C&ndash;B (home oct) &nbsp;&middot;&nbsp; K,O,L,P = next oct &nbsp;&middot;&nbsp; ' +
      `[ ] shift octave &nbsp;&middot;&nbsp; 1&ndash;${n} / Tab select ${mode === '2d' ? 'slot' : 'axis'} &nbsp;&middot;&nbsp; Space = sound on/off`;
  }
  pianoHintEl.innerHTML = mode === '2d' ? base : `${base} &nbsp;&middot;&nbsp; Drag cube to rotate`;
}

function setMode(newMode) {
  mode = newMode;
  mode2DEl.hidden = mode !== '2d';
  mode3DEl.hidden = mode !== '3d';
  updateExportStlVisibility();
  modeToggleBtn.textContent = mode === '2d' ? '3D View →' : '2D View →';
  pageTitleEl.textContent = mode === '2d' ? '2D LISSAJOUS CURVE' : '3D LISSAJOUS CURVE';
  phiLabelAEl.textContent = mode === '2d' ? 'φ inner X' : 'φ Y';
  phiLabelBEl.textContent = mode === '2d' ? 'φ X vs Y' : 'φ Z';
  updatePianoHint();
  updateNoteCountUI();

  const st = activeState();
  if (mode === '2d') { slPx.value = st.phiX; slPxy.value = st.phiXY; }
  else { slPx.value = st.phiY; slPxy.value = st.phiZ; }

  resizeCanvas(); // no-ops while 2D is hidden; refreshes CURVE_SIZE when switching back to it
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
  // #mode2D is display:none while in 3D mode, so its clientWidth reads 0 —
  // skip and keep CURVE_SIZE's last valid value (resizeCube3D() reuses it to
  // keep the two modes' graph height matched, so it must stay correct even
  // while 2D is offscreen).
  if (mode2DEl.hidden) return;
  const wrap = curveCanvas.parentElement;
  const size = Math.min(560, wrap.clientWidth || 560);
  const dpr = window.devicePixelRatio || 1;
  CURVE_SIZE = size;
  curveCanvas.style.width = `${size}px`;
  curveCanvas.style.height = `${size}px`;
  curveCanvas.width = size * dpr;
  curveCanvas.height = size * dpr;
  curveCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  yLabelEl.style.maxHeight = `${size}px`; // never let it grow taller than the curve
}

resizeCanvas();
resizeCube3D();
initTempButtons();
updateNoteCountUI();
updateInputModeUI();
updatePianoHint();
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
