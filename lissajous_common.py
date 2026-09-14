"""
Lissajous Keyboard — shared code used by both the 2D module
(lissajous_keyboard.py) and the 3D module (lissajous_keyboard_3d.py):
note/temperament math, the piano widget, the audio engine, MIDI input,
and the preset save/share system. Also hosts run_app(), the small
orchestrator that owns the long-lived bits (audio subprocess, MIDI
thread, preset library) across a live 2D/3D mode toggle.
"""

import queue as _queue
import threading
import multiprocessing as _mp
import json
import os
from datetime import datetime
import numpy as np
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
import matplotlib.colors as mcolors
from matplotlib.collections import LineCollection
from matplotlib.widgets import Button
from matplotlib.figure import Figure
from matplotlib.backends.backend_agg import FigureCanvasAgg
from fractions import Fraction
from math import gcd, lcm

try:
    import mido
    MIDO_OK = True
except ImportError:
    MIDO_OK = False

try:
    import sounddevice as _sd
    SD_OK = True
except ImportError:
    SD_OK = False

try:
    import tkinter
    from tkinter import filedialog as _filedialog
    TK_OK = True
except Exception:
    TK_OK = False

# ─────────────────────────────────────────────────────────────────────────────
# Note names & interval labels
# ─────────────────────────────────────────────────────────────────────────────

NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

INTERVAL_NAMES = {
    (1, 1):   'Unison',      (16, 15): 'Minor 2nd',
    (9, 8):   'Major 2nd',   (6, 5):   'Minor 3rd',
    (5, 4):   'Major 3rd',   (4, 3):   'Perfect 4th',
    (45, 32): 'Tritone',     (64, 45): 'Tritone',
    (3, 2):   'Perfect 5th', (8, 5):   'Minor 6th',
    (5, 3):   'Major 6th',   (16, 9):  'Minor 7th',
    (9, 5):   'Minor 7th',   (15, 8):  'Major 7th',
    (2, 1):   'Octave',      (3, 1):   'Oct + 5th',
    (4, 1):   'Two Octaves',
}

# ─────────────────────────────────────────────────────────────────────────────
# Temperament systems  (anchored: A4 = 440 Hz)
# ─────────────────────────────────────────────────────────────────────────────

_F5 = [0, 7, 2, 9, 4, -1, 6, 1, 8, 3, 10, 5]  # semitone → fifths above C


def _pyth(n):
    r = (3 / 2) ** abs(n)
    if n < 0:
        r = 1.0 / r
    while r >= 2.0:
        r /= 2.0
    while r < 1.0:
        r *= 2.0
    return r


def _mt(n):
    r = 5.0 ** (n / 4.0)
    while r >= 2.0:
        r /= 2.0
    while r < 1.0:
        r *= 2.0
    return r


_W3 = [0, 90.225, 192.18, 294.135, 390.225, 498.045,
       588.27, 696.09, 792.18, 888.27, 996.09, 1092.18]
_K3 = [0, 90.225, 193.157, 294.135, 386.314, 498.045,
       590.224, 696.578, 792.18, 889.735, 996.09, 1088.269]

TEMPERAMENTS = {
    'Equal  (12-TET)':  [2 ** (n / 12)    for n in range(12)],
    'Just  (5-limit)':  [1, 16/15, 9/8, 6/5, 5/4, 4/3, 45/32,
                         3/2, 8/5, 5/3, 9/5, 15/8],
    'Pythagorean':      [_pyth(n)          for n in _F5],
    '¼-Comma Meantone': [_mt(n)            for n in _F5],
    'Well temperament (1691)': [2 ** (c / 1200)   for c in _W3],
    'Well temperament (c. 1779)':   [2 ** (c / 1200)   for c in _K3],
}

TEMP_NAMES = list(TEMPERAMENTS.keys())

TEMP_DESCRIPTIONS = {
    'Equal  (12-TET)':
        'All semitones identical: ratio = 2^(1/12).  '
        'Universal modern standard — every key sounds the same.',
    'Just  (5-limit)':
        'Pure intervals built from integer ratios (5/4, 3/2, …).  '
        'Perfectly consonant in one key; beating in others.',
    'Pythagorean':
        'Stacked pure perfect 5ths (3/2).  '
        'Brilliant 5ths; major 3rds are noticeably sharp (81/64 ≈ 408 ¢).',
    '¼-Comma Meantone':
        'Narrows each 5th by ¼ syntonic comma so four 5ths = exact 5/4.  '
        'Sweet major 3rds; a "wolf" 5th on G#–Eb.',
    'Well temperament (1691)':
        'Werckmeister III: four 5ths narrow by ¼ Pythagorean comma.  '
        'All 12 keys usable; "home" keys sound purer and warmer.',
    'Well temperament (c. 1779)':
        'Kirnberger III: C–E pure (5/4); gentle gradation.  '
        'Smooth in flat keys; brighter toward sharps.',
}


def note_freq(name, octave, temperament):
    ratios   = TEMPERAMENTS[temperament]
    semitone = NOTE_NAMES.index(name)
    a_ratio  = ratios[9]
    c4_hz    = 440.0 / a_ratio
    return c4_hz * 2 ** (octave - 4) * ratios[semitone]


def describe_ratio(f1, f2):
    ratio = f1 / f2
    if ratio >= 1:
        frac = Fraction(ratio).limit_denominator(48)
        key  = (frac.numerator, frac.denominator)
        s    = f'{frac.numerator}:{frac.denominator}'
    else:
        frac = Fraction(1 / ratio).limit_denominator(48)
        key  = (frac.numerator, frac.denominator)
        s    = f'{frac.denominator}:{frac.numerator}'
    return s, INTERVAL_NAMES.get(key, '')


def period(freqs, max_denom=24, cap=96):
    """Multiple of the fundamental period after which an N-tone Lissajous
    figure retraces itself — works for any number of frequencies."""
    f_min = min(freqs)
    fracs = [Fraction(f / f_min).limit_denominator(max_denom) for f in freqs]
    inv   = [Fraction(fr.denominator, fr.numerator) for fr in fracs]
    lcm_n = lcm(*[f.numerator   for f in inv])
    gcd_d = gcd(*[f.denominator for f in inv])
    return min(lcm_n / gcd_d, cap)

# ─────────────────────────────────────────────────────────────────────────────
# Colours
# ─────────────────────────────────────────────────────────────────────────────

BG           = '#0b0c1e'
WHITE        = '#e8eaf0'
DIM          = '#2a3a4a'
X_COL        = '#ff9955'
Y_COL        = '#55ccff'
Z_COL        = '#66ffaa'
NOTE_COLS    = ['#ff6644', '#ffbb44', '#44ddbb', '#4499ff']
CURVE_COL    = '#00d4ff'
ACCENT       = '#00d4ff'
BTN_ON       = '#1c3a5c'
BTN_OFF      = '#0f1825'
BTN_EDGE_ON  = ACCENT
BTN_EDGE_OFF = DIM
ORANGE       = '#ff8833'
ORANGE_DIM   = '#7a4a2a'
ORANGE_BG_ON = '#4a2410'
PIANO_WHITE  = '#dde0e8'
PIANO_BLACK  = '#1c1c2c'
PIANO_BORDER = '#111122'

# ─────────────────────────────────────────────────────────────────────────────
# Offscreen rendering helper (for preset snapshot images)
# ─────────────────────────────────────────────────────────────────────────────

def new_offscreen_figure(size_px=640, dpi=120, projection=None):
    """A standalone Agg-backed Figure/Axes, independent of any on-screen
    window — safe to build and save at any time without disturbing the
    live app. Used for preset snapshot PNGs."""
    fig = Figure(figsize=(size_px / dpi, size_px / dpi), dpi=dpi, facecolor=BG)
    FigureCanvasAgg(fig)
    kwargs = {'projection': projection} if projection else {}
    ax = fig.add_axes([0, 0, 1, 1], **kwargs)
    ax.set_facecolor(BG)
    return fig, ax


def gradient_line_collection(x, y, color=CURVE_COL, linewidth=0.9,
                              alpha_range=(0.15, 1.0)):
    """A 2D LineCollection whose segments fade from alpha_range[0] to [1]
    along the curve — the app's signature "trail" look."""
    n = len(x)
    xy = np.stack([x, y], axis=1)
    segs = np.stack([xy[:-1], xy[1:]], axis=1)
    r, g, b = mcolors.to_rgb(color)
    alphas = np.linspace(alpha_range[0], alpha_range[1], n - 1)
    colors = np.column_stack([np.full(n - 1, r), np.full(n - 1, g),
                               np.full(n - 1, b), alphas])
    lc = LineCollection(segs, linewidths=linewidth, capstyle='butt')
    lc.set_color(colors)
    return lc

# ─────────────────────────────────────────────────────────────────────────────
# Temperament button styling
# ─────────────────────────────────────────────────────────────────────────────

def style_temp_buttons(btn_axs, btns, active_idx):
    for i, (ax, btn) in enumerate(zip(btn_axs, btns)):
        on = (i == active_idx)
        ax.set_facecolor(BTN_ON if on else BTN_OFF)
        for sp in ax.spines.values():
            sp.set_edgecolor(BTN_EDGE_ON  if on else BTN_EDGE_OFF)
            sp.set_linewidth(1.4          if on else 0.5)
        btn.label.set_color(WHITE if on else '#778899')

# ─────────────────────────────────────────────────────────────────────────────
# Piano keyboard geometry
# ─────────────────────────────────────────────────────────────────────────────

PIANO_OCT_LOW  = 3
PIANO_OCT_HIGH = 6
N_WHITE        = (PIANO_OCT_HIGH - PIANO_OCT_LOW + 1) * 7  # 28

_WHITE_SEMI  = [0, 2, 4, 5, 7, 9, 11]   # C D E F G A B
_BLACK_SEMI  = [1, 3, 6, 8, 10]          # C# D# F# G# A#
_BLACK_X_OFF = {1: 0.65, 3: 1.65, 6: 3.65, 8: 4.65, 10: 5.65}

BK_W = 0.65   # black key width  (in white-key units)
BK_H = 0.62   # black key height (fraction of white key)
BK_Y = 0.38   # black key y-bottom


def build_piano_keys():
    keys  = []
    w_idx = 0
    for oct in range(PIANO_OCT_LOW, PIANO_OCT_HIGH + 1):
        oct_start = w_idx
        for semi in _WHITE_SEMI:
            keys.append({'note': NOTE_NAMES[semi], 'octave': oct, 'semi': semi,
                         'x': float(w_idx), 'y': 0.0,
                         'w': 1.0, 'h': 1.0, 'is_black': False})
            w_idx += 1
        for semi in _BLACK_SEMI:
            keys.append({'note': NOTE_NAMES[semi], 'octave': oct, 'semi': semi,
                         'x': oct_start + _BLACK_X_OFF[semi], 'y': BK_Y,
                         'w': BK_W, 'h': BK_H, 'is_black': True})
    return keys


def find_key_at(keys, x, y):
    """Return the key dict hit at (x, y) in piano data coords, or None.
    Black keys take priority over white keys (they're drawn on top)."""
    for k in keys:
        if k['is_black']:
            if k['x'] <= x <= k['x'] + k['w'] and k['y'] <= y <= k['y'] + k['h']:
                return k
    for k in keys:
        if not k['is_black']:
            if k['x'] <= x <= k['x'] + k['w'] and k['y'] <= y <= k['y'] + k['h']:
                return k
    return None

# ─────────────────────────────────────────────────────────────────────────────
# Computer keyboard mapping  (standard DAW virtual-piano layout)
#
#  Home row  →  white keys of home octave:  A S D F G H J  =  C D E F G A B
#  Top row   →  black keys of home octave:  W E   T Y U    =  C# D# F# G# A#
#  Home+1    →  K L   =  C D  (+1 octave)
#  Top+1     →  O P   =  C# D#  (+1 octave)
# ─────────────────────────────────────────────────────────────────────────────

KB_MAP = {
    'a': (0,  0), 'w': (1,  0), 's': (2,  0), 'e': (3,  0),
    'd': (4,  0), 'f': (5,  0), 't': (6,  0), 'g': (7,  0),
    'y': (8,  0), 'h': (9,  0), 'u': (10, 0), 'j': (11, 0),
    'k': (0,  1), 'o': (1,  1), 'l': (2,  1), 'p': (3,  1),
}

# ─────────────────────────────────────────────────────────────────────────────
# Piano drawing — persistent patches/artists (no ax.clear() on each update)
# ─────────────────────────────────────────────────────────────────────────────

def init_piano_ax(ax, keys):
    """Build all piano artists once. Returns artist dict for later updates."""
    ax.set_facecolor(BG)
    ax.set_xlim(-0.3, N_WHITE + 0.3)
    ax.set_ylim(-0.14, 1.04)
    ax.set_xticks([])
    ax.set_yticks([])
    for sp in ax.spines.values():
        sp.set_color(DIM)
        sp.set_linewidth(0.5)

    patches = {}
    for k in keys:        # white keys first so black keys render on top
        if not k['is_black']:
            rect = mpatches.Rectangle(
                (k['x'] + 0.04, k['y'] + 0.02), k['w'] - 0.08, k['h'] - 0.04,
                facecolor=PIANO_WHITE, edgecolor=PIANO_BORDER,
                linewidth=0.6, zorder=1)
            ax.add_patch(rect)
            patches[(k['note'], k['octave'])] = rect
    for k in keys:
        if k['is_black']:
            rect = mpatches.Rectangle(
                (k['x'], k['y']), k['w'], k['h'],
                facecolor=PIANO_BLACK, edgecolor='#000000',
                linewidth=0.5, zorder=2)
            ax.add_patch(rect)
            patches[(k['note'], k['octave'])] = rect

    # Position lookup: (note, octave) → (cx, cy, is_black)
    pos = {}
    for k in keys:
        cx = k['x'] + k['w'] / 2
        cy = (k['y'] + 0.11) if k['is_black'] else (k['y'] + 0.09)
        pos[(k['note'], k['octave'])] = (cx, cy, k['is_black'])

    # Shortcut label Text artists — one per KB_MAP entry, repositioned on octave shift
    shortcuts = {}
    for kb_key in KB_MAP:
        shortcuts[kb_key] = ax.text(0, 0, kb_key.upper(),
                                    ha='center', va='center',
                                    fontsize=6.0, color='#334455',
                                    zorder=3, visible=False)

    # Octave label Text artists — one per C key, always visible
    oct_labels = {}
    for k in keys:
        if k['note'] == 'C':
            oct_labels[k['octave']] = ax.text(
                k['x'] + 0.5, -0.07, f"C{k['octave']}",
                ha='center', va='center', fontsize=6.5, color='#3a4a5a', zorder=3)

    # Active-octave underline — single Line2D, repositioned on octave shift
    underline, = ax.plot([0, 0], [-0.03, -0.03],
                         color=ACCENT, lw=1.2, alpha=0.7, zorder=4,
                         solid_capstyle='round', visible=False)

    return {'patches': patches, 'shortcuts': shortcuts,
            'oct_labels': oct_labels, 'underline': underline, '_pos': pos}


def update_piano(arts, keys, state, note_cols):
    """Update piano facecolors, shortcut labels, and octave underline in-place.
    note_cols[i] highlights the key currently assigned to slot i (whatever
    the caller's number of slots — 3 axes in 3D mode, 4 in 2D mode)."""
    patches    = arts['patches']
    shortcuts  = arts['shortcuts']
    oct_labels = arts['oct_labels']
    underline  = arts['underline']
    pos        = arts['_pos']
    base_oct   = state['base_octave']

    # Reset all keys to default color, then apply slot highlights
    for (note, _), rect in patches.items():
        rect.set_facecolor(PIANO_BLACK if note in ('C#', 'D#', 'F#', 'G#', 'A#')
                           else PIANO_WHITE)
    for i in range(len(state['notes'])):
        key = (state['notes'][i], state['octs'][i])
        if key in patches:
            patches[key].set_facecolor(note_cols[i])

    # Reposition shortcut labels for the current base octave
    for kb_key, (semi, oct_off) in KB_MAP.items():
        tgt = (NOTE_NAMES[semi], base_oct + oct_off)
        t = shortcuts[kb_key]
        if tgt in pos:
            cx, cy, is_black = pos[tgt]
            t.set_position((cx, cy))
            t.set_fontsize(5.5 if is_black else 6.0)
            t.set_color('#cccccc' if is_black else '#334455')
            t.set_visible(True)
        else:
            t.set_visible(False)

    # Update octave label colors
    for octave, t in oct_labels.items():
        t.set_color(ACCENT if octave == base_oct else '#3a4a5a')

    # Reposition active-octave underline
    for k in keys:
        if k['note'] == 'C' and k['octave'] == base_oct:
            underline.set_xdata([k['x'] + 0.1, k['x'] + 6.9])
            underline.set_visible(True)
            break
    else:
        underline.set_visible(False)

# ─────────────────────────────────────────────────────────────────────────────
# Note slot drawing — persistent Text artists (no ax.clear() on each update)
# ─────────────────────────────────────────────────────────────────────────────

def init_slot_ax(ax, title, axis_label, axis_color):
    """Set up a slot axis once; return dict of persistent Text artists."""
    ax.set_facecolor('#070813')
    ax.set_xticks([])
    ax.set_yticks([])
    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1)
    return {
        'title':  ax.text(0.5, 0.90, title,
                          ha='center', va='center',
                          fontsize=7.5, fontweight='bold',
                          transform=ax.transAxes),
        'axis':   ax.text(0.5, 0.79, axis_label,
                          ha='center', va='center',
                          color=axis_color, fontsize=6.5,
                          transform=ax.transAxes),
        'note':   ax.text(0.5, 0.54, '',
                          ha='center', va='center',
                          fontsize=20, fontweight='bold',
                          transform=ax.transAxes),
        'freq':   ax.text(0.5, 0.35, '',
                          ha='center', va='center',
                          color='#4a5a6a', fontsize=8,
                          transform=ax.transAxes),
        'status': ax.text(0.5, 0.16, '',
                          ha='center', va='center',
                          fontsize=7, fontweight='bold',
                          transform=ax.transAxes),
    }


def draw_slot(ax, arts, note, octave, temperament, color, is_active, select_key):
    for sp in ax.spines.values():
        sp.set_edgecolor(color)
        sp.set_linewidth(2.5 if is_active else 0.8)

    arts['title'].set_color(color if is_active else '#445566')
    arts['note'].set_text(f'{note}{octave}')
    arts['note'].set_color(color)
    arts['freq'].set_text(f'{note_freq(note, octave, temperament):.1f} Hz')
    if is_active:
        arts['status'].set_text('▲  ACTIVE')
        arts['status'].set_color(color)
        arts['status'].set_fontsize(7)
    else:
        arts['status'].set_text(f'press  {select_key}')
        arts['status'].set_color('#2a3a4a')
        arts['status'].set_fontsize(6.5)

# ─────────────────────────────────────────────────────────────────────────────
# MIDI background worker
# ─────────────────────────────────────────────────────────────────────────────

def midi_worker(q, port_name):
    """Background thread: push note-on MIDI note numbers onto q."""
    try:
        with mido.open_input(port_name) as port:
            for msg in port:
                if msg.type == 'note_on' and msg.velocity > 0:
                    q.put(msg.note)
    except Exception:
        pass

# ─────────────────────────────────────────────────────────────────────────────
# Audio engine — additive synthesis for any number of simultaneous notes
# ─────────────────────────────────────────────────────────────────────────────

_AUDIO_SR    = 44100
_AUDIO_BLOCK = 2048

# Harmonic series for each tone type: list of (harmonic_number, amplitude)
TONE_HARMONICS = {
    'sine':   [(1, 1.000)],
    'epiano': [(1, 0.600), (2, 0.280), (3, 0.080), (4, 0.020)],
    'piano':  [(1, 0.380), (2, 0.220), (3, 0.140), (4, 0.090),
               (5, 0.055), (6, 0.035), (7, 0.020), (8, 0.012)],
}


class _AudioEngine:
    """Real-time additive synthesis engine for N simultaneous notes.
    N is whatever length array is passed to enable()/set_freqs() — 3 voices
    for the 3D module's X/Y/Z notes, 4 for the 2D module's note slots."""

    def __init__(self):
        self._sr     = _AUDIO_SR
        self._freqs  = np.array([440.0])
        self._phases = np.zeros(1)   # phase accumulator per note
        self._tone   = 'sine'
        self._vol    = 0.25
        self._on     = False
        self._lock   = threading.Lock()
        self._stream = None

    def _set_freqs_locked(self, freqs):
        freqs = np.asarray(freqs, dtype=np.float64)
        if freqs.shape != self._freqs.shape:
            self._phases = np.zeros(len(freqs))
        self._freqs = freqs

    def set_freqs(self, freqs):
        with self._lock:
            self._set_freqs_locked(freqs)

    def set_tone(self, tone):
        with self._lock:
            self._tone = tone

    def set_volume(self, v):
        with self._lock:
            self._vol = float(v)

    def _callback(self, outdata, frames, _time, _status):
        with self._lock:
            freqs  = self._freqs.copy()
            phases = self._phases.copy()
            tone   = self._tone
            vol    = self._vol
            on     = self._on

        n_voices   = len(freqs)
        n          = frames
        idx        = np.arange(n, dtype=np.float64)
        out        = np.zeros(n)
        harmonics  = TONE_HARMONICS.get(tone, TONE_HARMONICS['sine'])
        new_phases = phases.copy()

        for i in range(n_voices):
            f   = freqs[i]
            dp  = 2.0 * np.pi * f / self._sr
            phi = phases[i] + dp * idx
            sig = np.zeros(n)
            for h, amp in harmonics:
                sig += amp * np.sin(h * phi)
            out += sig
            new_phases[i] = (phases[i] + dp * n) % (2.0 * np.pi)

        if not on:
            out[:] = 0.0
        out  = np.tanh(out * vol / max(n_voices, 1))   # scale then soft-clip
        mono = out.astype(np.float32)
        outdata[:, 0] = mono
        if outdata.shape[1] > 1:
            outdata[:, 1] = mono

        with self._lock:
            self._phases = new_phases

    def enable(self, freqs):
        with self._lock:
            self._set_freqs_locked(freqs)
            self._on = True
        if self._stream is None or not self._stream.active:
            try:
                self._stream = _sd.OutputStream(
                    samplerate = self._sr,
                    channels   = 2,
                    callback   = self._callback,
                    blocksize  = _AUDIO_BLOCK,
                    dtype      = 'float32',
                )
                self._stream.start()
            except Exception:
                with self._lock:
                    self._on = False

    def disable(self):
        with self._lock:
            self._on = False

    def close(self):
        self.disable()
        if self._stream:
            self._stream.stop()
            self._stream.close()
            self._stream = None


def _audio_process_main(cmd_q):
    """Subprocess entry point: owns the AudioEngine in its own GIL."""
    engine = _AudioEngine()
    while True:
        try:
            msg = cmd_q.get(timeout=0.5)
        except Exception:
            continue
        op = msg[0]
        if   op == 'enable':     engine.enable(msg[1])
        elif op == 'disable':    engine.disable()
        elif op == 'set_freqs':  engine.set_freqs(msg[1])
        elif op == 'set_tone':   engine.set_tone(msg[1])
        elif op == 'set_volume': engine.set_volume(msg[1])
        elif op == 'close':      engine.close(); return


class AudioProxy:
    """Sends commands to the audio subprocess; mirrors _AudioEngine's API."""

    def __init__(self, q):
        self._q  = q
        self._on = False   # mirrored locally so the UI can query it

    def enable(self, freqs):
        self._on = True
        self._q.put(('enable', list(freqs)))

    def disable(self):
        self._on = False
        self._q.put(('disable',))

    def set_freqs(self, freqs):
        self._q.put(('set_freqs', list(freqs)))

    def set_tone(self, tone):
        self._q.put(('set_tone', tone))

    def set_volume(self, v):
        self._q.put(('set_volume', float(v)))

    def close(self):
        self._on = False
        self._q.put(('close',))

# ─────────────────────────────────────────────────────────────────────────────
# Presets — save/export/import curve settings as shareable JSON
# ─────────────────────────────────────────────────────────────────────────────

PRESETS_FORMAT = 'lissajous-presets-v1'
PRESETS_DIR    = os.path.expanduser('~/.lissajous_keyboard')
PRESETS_FILE   = os.path.join(PRESETS_DIR, 'presets.json')
IMAGES_DIR     = os.path.join(PRESETS_DIR, 'images')


def slugify(name):
    slug = ''.join(c.lower() if c.isalnum() else '-' for c in name).strip('-')
    while '--' in slug:
        slug = slug.replace('--', '-')
    return slug or 'preset'


def preset_from_state(state, name, mode):
    """mode is '2d' or '3d'. Phase parameters are picked up generically from
    any state key starting with 'phi_' (phi_x/phi_xy for 2D, phi_y/phi_z for
    3D), so this needs no per-mode special-casing."""
    return {
        'name':        name,
        'mode':        mode,
        'notes':       list(state['notes']),
        'octaves':     list(state['octs']),
        'phases':      {k: float(v) for k, v in state.items() if k.startswith('phi_')},
        'temperament': state['temp'],
        'created':     datetime.now().isoformat(timespec='seconds'),
    }


def preset_phases(p):
    """Phase params for a preset, tolerating the pre-refactor flat schema
    (phi_x/phi_xy directly on the preset instead of nested under 'phases')."""
    return p.get('phases') or {k: v for k, v in p.items() if k.startswith('phi_')}


def presets_for_mode(presets, mode):
    """Presets saved before the 'mode' field existed are treated as 2D."""
    return [p for p in presets if p.get('mode', '2d') == mode]


def load_presets(path):
    """Load a preset library from disk. Returns [] if missing or invalid."""
    if not os.path.exists(path):
        return []
    try:
        with open(path) as f:
            data = json.load(f)
        return list(data.get('presets', []))
    except (OSError, ValueError):
        return []


def write_presets(path, presets):
    """Write a preset library to disk, creating parent directories as needed."""
    os.makedirs(os.path.dirname(path) or '.', exist_ok=True)
    with open(path, 'w') as f:
        json.dump({'format': PRESETS_FORMAT, 'presets': presets}, f, indent=2)


def unique_image_path(name):
    """A collision-free path under IMAGES_DIR for a new preset snapshot."""
    slug = slugify(name)
    image_name = f'{slug}.png'
    n = 2
    while os.path.exists(os.path.join(IMAGES_DIR, image_name)):
        image_name = f'{slug}-{n}.png'
        n += 1
    return os.path.join(IMAGES_DIR, image_name), os.path.join('images', image_name)

# ─────────────────────────────────────────────────────────────────────────────
# App orchestrator — owns the resources that must survive a mode toggle
# ─────────────────────────────────────────────────────────────────────────────

def teardown_ui(fig, ctx):
    """Disconnect the previous mode's event handlers/timers before rebuilding
    the figure for a different mode. Leaves the audio subprocess, MIDI
    thread/queue, and preset library untouched — those are shared via ctx."""
    for cid in ctx.get('_cids', []):
        try:
            fig.canvas.mpl_disconnect(cid)
        except Exception:
            pass
    ctx['_cids'] = []
    timer = ctx.get('_timer')
    if timer is not None:
        try:
            timer.stop()
        except Exception:
            pass
        ctx['_timer'] = None
    fig.clf()


def run_app(initial_mode='2d'):
    """Entry point shared by both modules' `python lissajous_keyboard*.py`.
    Builds the long-lived resources once, then hands off to whichever
    module's build_ui() draws the requested mode."""
    for k in list(plt.rcParams.keys()):
        if k.startswith('keymap.'):
            plt.rcParams[k] = []   # avoid conflicts with note-entry keys

    audio_q    = _mp.Queue()
    audio_proc = _mp.Process(target=_audio_process_main, args=(audio_q,), daemon=True)
    audio_proc.start()

    ctx = {
        'audio_engine': AudioProxy(audio_q),
        'midi_q':       _queue.Queue(),
        'presets':      load_presets(PRESETS_FILE),
        'temp':         TEMP_NAMES[0],
        'tone':         'sine',
        'vol':          0.25,
        '_cids':        [],
        '_timer':       None,
    }

    if MIDO_OK:
        ports = mido.get_input_names()
        if ports:
            ctx['midi_port'] = ports[0]
            threading.Thread(target=midi_worker, args=(ctx['midi_q'], ports[0]),
                             daemon=True).start()

    fig = plt.figure(figsize=(14, 7.75), facecolor=BG)

    def _build(mode):
        if mode == '2d':
            import lissajous_keyboard as m
        else:
            import lissajous_keyboard_3d as m
        m.build_ui(fig, ctx)

    _build(initial_mode)
    fig.canvas.mpl_connect('close_event', lambda _e: ctx['audio_engine'].close())
    plt.show()
