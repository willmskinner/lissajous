"""
Lissajous Curve — Four Musical Notes  ·  Piano Keyboard Interface

  X-axis:  x(t) = sin(r1·t)          + sin(r2·t + φx)
  Y-axis:  y(t) = sin(r3·t + φxy)    + sin(r4·t + φxy)

Select notes by clicking the on-screen piano keyboard or pressing
computer-keyboard shortcuts (standard DAW virtual-piano layout —
key labels appear on the piano keys).

  1 / 2 / 3 / 4   select active note slot
  Tab              cycle active slot
  [ / ]            shift the home octave down / up
  A–J              C D E F G A B  (home octave)
  W E T Y U        C# D# F# G# A#  (home octave)
  K L              C D  (+1 octave)
  O P              C# D#  (+1 octave)
  Space            toggle sound on/off

Presets — save a curve you like (notes, octaves, phase, temperament) to a
local library, browse it with the ◀ ▶ buttons, and export/import it as a
JSON file to share curves with other users of this app. Saving also drops
a PNG snapshot of the curve in ~/.lissajous_keyboard/images/, so you can
browse your saved curves in any image viewer without opening this app.
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
from matplotlib.widgets import Slider, Button, TextBox
from matplotlib.figure import Figure
from matplotlib.backends.backend_agg import FigureCanvasAgg
from fractions import Fraction
from math import gcd, lcm
try:
    import mido
    _MIDO_OK = True
except ImportError:
    _MIDO_OK = False

try:
    import sounddevice as _sd
    _SD_OK = True
except ImportError:
    _SD_OK = False

try:
    import tkinter
    from tkinter import filedialog as _filedialog
    _TK_OK = True
except Exception:
    _TK_OK = False

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

# ─────────────────────────────────────────────────────────────────────────────
# Lissajous computation
# ─────────────────────────────────────────────────────────────────────────────

def _period(freqs, max_denom=24, cap=96):
    f_min = min(freqs)
    fracs = [Fraction(f / f_min).limit_denominator(max_denom) for f in freqs]
    inv   = [Fraction(fr.denominator, fr.numerator) for fr in fracs]
    lcm_n = lcm(*[f.numerator   for f in inv])
    gcd_d = gcd(*[f.denominator for f in inv])
    return min(lcm_n / gcd_d, cap)


def lissajous_4(freqs, phi_x, phi_xy, n=8000):
    f_min = min(freqs)
    r  = [f / f_min for f in freqs]
    T  = _period(freqs)
    t  = np.linspace(0, 2 * np.pi * T, n)
    x  = np.sin(r[0] * t)           + np.sin(r[1] * t + phi_x)
    y  = np.sin(r[2] * t + phi_xy)  + np.sin(r[3] * t + phi_xy)
    xs, ys = np.abs(x).max(), np.abs(y).max()
    if xs > 1e-6: x /= xs
    else:         x[:] = 0.0
    if ys > 1e-6: y /= ys
    else:         y[:] = 0.0
    return x, y

# ─────────────────────────────────────────────────────────────────────────────
# Colours
# ─────────────────────────────────────────────────────────────────────────────

BG           = '#0b0c1e'
WHITE        = '#e8eaf0'
DIM          = '#2a3a4a'
X_COL        = '#ff9955'
Y_COL        = '#55ccff'
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
# Presets — save/export/import curve settings as shareable JSON
# ─────────────────────────────────────────────────────────────────────────────

PRESETS_FORMAT = 'lissajous-presets-v1'
PRESETS_DIR    = os.path.expanduser('~/.lissajous_keyboard')
PRESETS_FILE   = os.path.join(PRESETS_DIR, 'presets.json')
IMAGES_DIR     = os.path.join(PRESETS_DIR, 'images')


def _slugify(name):
    slug = ''.join(c.lower() if c.isalnum() else '-' for c in name).strip('-')
    while '--' in slug:
        slug = slug.replace('--', '-')
    return slug or 'preset'


def render_curve_image(preset, path, size_px=640, dpi=120):
    """Render a standalone PNG snapshot of a preset's curve — viewable in any
    image viewer, without opening this app."""
    freqs = [note_freq(preset['notes'][i], preset['octaves'][i], preset['temperament'])
             for i in range(4)]
    x, y = lissajous_4(freqs, preset['phi_x'], preset['phi_xy'])

    fig = Figure(figsize=(size_px / dpi, size_px / dpi), dpi=dpi, facecolor=BG)
    FigureCanvasAgg(fig)
    ax = fig.add_axes([0, 0, 1, 1])
    ax.set_facecolor(BG)
    ax.set_xlim(-1.15, 1.15)
    ax.set_ylim(-1.15, 1.15)
    ax.set_aspect('equal')
    ax.set_xticks([])
    ax.set_yticks([])
    for spine in ax.spines.values():
        spine.set_visible(False)

    n = len(x)
    xy = np.stack([x, y], axis=1)
    segs = np.stack([xy[:-1], xy[1:]], axis=1)
    r, g, b = mcolors.to_rgb(CURVE_COL)
    alphas = np.linspace(0.15, 1.0, n - 1)
    colors = np.column_stack([np.full(n - 1, r), np.full(n - 1, g),
                               np.full(n - 1, b), alphas])
    lc = LineCollection(segs, linewidths=1.6, capstyle='butt')
    lc.set_color(colors)
    ax.add_collection(lc)

    os.makedirs(os.path.dirname(path) or '.', exist_ok=True)
    fig.savefig(path, facecolor=BG)


def _preset_from_state(state, name):
    return {
        'name':        name,
        'notes':       list(state['notes']),
        'octaves':     list(state['octs']),
        'phi_x':       float(state['phi_x']),
        'phi_xy':      float(state['phi_xy']),
        'temperament': state['temp'],
        'created':     datetime.now().isoformat(timespec='seconds'),
    }


def _load_presets(path):
    """Load a preset library from disk. Returns [] if missing or invalid."""
    if not os.path.exists(path):
        return []
    try:
        with open(path) as f:
            data = json.load(f)
        return list(data.get('presets', []))
    except (OSError, ValueError):
        return []


def _write_presets(path, presets):
    """Write a preset library to disk, creating parent directories as needed."""
    os.makedirs(os.path.dirname(path) or '.', exist_ok=True)
    with open(path, 'w') as f:
        json.dump({'format': PRESETS_FORMAT, 'presets': presets}, f, indent=2)

# ─────────────────────────────────────────────────────────────────────────────
# Curve drawing — persistent LineCollection (no ax.clear() on each frame)
# ─────────────────────────────────────────────────────────────────────────────

def _init_curve_ax(ax):
    """Set up ax_main once: static decorations + persistent LineCollection.

    Pre-computes the constant color/alpha array and pre-allocates the segment
    buffer so neither needs to be recreated on each animation frame.
    Returns (lc, segs_buf).
    """
    ax.set_facecolor(BG)
    for v in [-1, -0.5, 0, 0.5, 1]:
        ax.axhline(v, color=DIM, lw=0.3, alpha=0.6)
        ax.axvline(v, color=DIM, lw=0.3, alpha=0.6)
    ax.set_xlim(-1.15, 1.15)
    ax.set_ylim(-1.15, 1.15)
    ax.set_aspect('equal')
    ax.set_xticks([])
    ax.set_yticks([])
    for spine in ax.spines.values():
        spine.set_color(DIM)
    ax.set_xlabel('', color=X_COL, fontsize=9, labelpad=5)
    ax.set_ylabel('', color=Y_COL, fontsize=9, labelpad=5, rotation=90)
    ax.set_title('', color=WHITE, fontsize=10, pad=10)

    # Pre-compute the gradient color array — identical every frame
    n_seg  = 8000 - 1
    r, g, b = mcolors.to_rgb(CURVE_COL)
    alphas = np.linspace(0.15, 1.0, n_seg)
    colors = np.column_stack([np.full(n_seg, r), np.full(n_seg, g),
                               np.full(n_seg, b), alphas])

    # Pre-allocate the segment buffer — filled in-place each frame
    segs_buf = np.empty((n_seg, 2, 2))

    lc = LineCollection([], linewidths=0.9, capstyle='butt')
    lc.set_color(colors)   # set once; survives set_segments() calls
    ax.add_collection(lc)
    return lc, segs_buf


def _fill_curve(lc, freqs, phi_x, phi_xy, segs_buf):
    """Update curve geometry only — no label recalculation.
    Called every animation frame; avoids all per-frame allocation."""
    x, y = lissajous_4(freqs, phi_x, phi_xy)
    xy   = np.stack([x, y], axis=1)   # (n, 2)
    segs_buf[:, 0, :] = xy[:-1]
    segs_buf[:, 1, :] = xy[1:]
    lc.set_segments(segs_buf)


def _update_curve(lc, ax, freqs, phi_x, phi_xy, labels, temperament, segs_buf):
    """Update curve geometry + axis labels. Called on note/temperament change."""
    _fill_curve(lc, freqs, phi_x, phi_xy, segs_buf)
    f1, f2, f3, f4 = freqs
    rx, ix = describe_ratio(f1, f2)
    ry, iy = describe_ratio(f3, f4)
    ix_s = f' – {ix}' if ix else ''
    iy_s = f' – {iy}' if iy else ''
    ax.set_xlabel(
        f'{labels[0]} ({f1:.1f} Hz) + {labels[1]} ({f2:.1f} Hz)   [{rx}{ix_s}]',
        color=X_COL, fontsize=9, labelpad=5)
    ax.set_ylabel(
        f'{labels[2]} ({f3:.1f} Hz) + {labels[3]} ({f4:.1f} Hz)   [{ry}{iy_s}]',
        color=Y_COL, fontsize=9, labelpad=5, rotation=90)
    ax.set_title(f'{temperament}', color=WHITE, fontsize=10, pad=10)

# ─────────────────────────────────────────────────────────────────────────────
# Temperament button styling
# ─────────────────────────────────────────────────────────────────────────────

def _style_temp_buttons(btn_axs, btns, active_idx):
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


def _build_piano_keys():
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

def _init_piano_ax(ax, keys):
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


def update_piano(arts, keys, state):
    """Update piano facecolors, shortcut labels, and octave underline in-place."""
    patches   = arts['patches']
    shortcuts = arts['shortcuts']
    oct_labels = arts['oct_labels']
    underline  = arts['underline']
    pos        = arts['_pos']
    base_oct   = state['base_octave']

    # Reset all keys to default color, then apply slot highlights
    for (note, _), rect in patches.items():
        rect.set_facecolor(PIANO_BLACK if note in ('C#','D#','F#','G#','A#')
                           else PIANO_WHITE)
    for i in range(4):
        key = (state['notes'][i], state['octs'][i])
        if key in patches:
            patches[key].set_facecolor(NOTE_COLS[i])

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

def _init_slot_ax(ax, slot_idx):
    """Set up a slot axis once; return dict of persistent Text artists."""
    ax_lbl = 'X  AXIS' if slot_idx < 2 else 'Y  AXIS'
    ax_col = X_COL    if slot_idx < 2 else Y_COL
    ax.set_facecolor('#070813')
    ax.set_xticks([])
    ax.set_yticks([])
    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1)
    return {
        'title':  ax.text(0.5, 0.90, f'Note {slot_idx + 1}',
                          ha='center', va='center',
                          fontsize=7.5, fontweight='bold',
                          transform=ax.transAxes),
        'axis':   ax.text(0.5, 0.79, ax_lbl,
                          ha='center', va='center',
                          color=ax_col, fontsize=6.5,
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


def draw_slot(ax, slot_idx, state, arts):
    note   = state['notes'][slot_idx]
    octave = state['octs'][slot_idx]
    col    = NOTE_COLS[slot_idx]
    is_act = (state['active_slot'] == slot_idx)

    for sp in ax.spines.values():
        sp.set_edgecolor(col)
        sp.set_linewidth(2.5 if is_act else 0.8)

    arts['title'].set_color(col if is_act else '#445566')
    arts['note'].set_text(f'{note}{octave}')
    arts['note'].set_color(col)
    arts['freq'].set_text(f'{note_freq(note, octave, state["temp"]):.1f} Hz')
    if is_act:
        arts['status'].set_text('▲  ACTIVE')
        arts['status'].set_color(col)
        arts['status'].set_fontsize(7)
    else:
        arts['status'].set_text(f'press  {slot_idx + 1}')
        arts['status'].set_color('#2a3a4a')
        arts['status'].set_fontsize(6.5)

# ─────────────────────────────────────────────────────────────────────────────
# MIDI background worker
# ─────────────────────────────────────────────────────────────────────────────

def _midi_worker(q, port_name):
    """Background thread: push note-on MIDI note numbers onto q."""
    try:
        with mido.open_input(port_name) as port:
            for msg in port:
                if msg.type == 'note_on' and msg.velocity > 0:
                    q.put(msg.note)
    except Exception:
        pass

# ─────────────────────────────────────────────────────────────────────────────
# Audio engine
# ─────────────────────────────────────────────────────────────────────────────

_AUDIO_SR    = 44100
_AUDIO_BLOCK = 2048

# Harmonic series for each tone type: list of (harmonic_number, amplitude)
_TONE_HARMONICS = {
    'sine':   [(1, 1.000)],
    'epiano': [(1, 0.600), (2, 0.280), (3, 0.080), (4, 0.020)],
    'piano':  [(1, 0.380), (2, 0.220), (3, 0.140), (4, 0.090),
               (5, 0.055), (6, 0.035), (7, 0.020), (8, 0.012)],
}


class _AudioEngine:
    """Real-time additive synthesis engine for four simultaneous notes."""

    def __init__(self):
        self._sr     = _AUDIO_SR
        self._freqs  = np.ones(4) * 440.0
        self._phases = np.zeros(4)   # phase accumulator per note
        self._tone   = 'sine'
        self._vol    = 0.25
        self._on     = False
        self._lock   = threading.Lock()
        self._stream = None

    def set_freqs(self, freqs):
        with self._lock:
            self._freqs = np.array(freqs, dtype=np.float64)

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

        n          = frames
        idx        = np.arange(n, dtype=np.float64)
        out        = np.zeros(n)
        harmonics  = _TONE_HARMONICS.get(tone, _TONE_HARMONICS['sine'])
        new_phases = phases.copy()

        for i in range(4):
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
        out  = np.tanh(out * vol / 4.0)   # scale then soft-clip
        mono = out.astype(np.float32)
        outdata[:, 0] = mono
        if outdata.shape[1] > 1:
            outdata[:, 1] = mono

        with self._lock:
            self._phases = new_phases

    def enable(self, freqs):
        with self._lock:
            self._freqs = np.array(freqs, dtype=np.float64)
            self._on    = True
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


class _AudioProxy:
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
# Main
# ─────────────────────────────────────────────────────────────────────────────

def main():
    # Remove all default matplotlib keybindings to avoid conflicts with
    # note-entry keys (s, f, g, h, l, p, etc.)
    for k in list(plt.rcParams.keys()):
        if k.startswith('keymap.'):
            plt.rcParams[k] = []

    state = {
        'notes':       ['A', 'E', 'D', 'A'],
        'octs':        [ 4,   5,   5,   5 ],
        'phi_x':       0.0,
        'phi_xy':      np.pi / 4,
        'temp':        TEMP_NAMES[0],
        'active_slot': 0,
        'base_octave': 4,   # 'A' computer key → C of this octave
        'anim_phi_x':  False,
        'anim_phi_xy': False,
    }

    presets = _load_presets(PRESETS_FILE)
    preset_idx = [len(presets) - 1 if presets else -1]  # mutable box (int isn't)

    piano_keys = _build_piano_keys()

    # ── Audio subprocess ───────────────────────────────────────────────────────
    _audio_q    = _mp.Queue()
    _audio_proc = _mp.Process(target=_audio_process_main,
                              args=(_audio_q,), daemon=True)
    _audio_proc.start()
    _audio_engine = _AudioProxy(_audio_q)

    fig = plt.figure(figsize=(14, 7.75), facecolor=BG)
    fig.suptitle('4-note Lissajous Curve',
                 color=WHITE, fontsize=13, fontweight='bold', y=0.997)

    # ── Layout ────────────────────────────────────────────────────────────────
    PRESET_Y, PRESET_H = 0.005, 0.028  # preset row: the very bottom of the window
    TEMP_DESC_Y      = 0.058
    TEMP_Y,  TEMP_H  = 0.068, 0.03
    PHASE_Y, PHASE_H = 0.120, 0.046
    PIANO_Y, PIANO_H = 0.185, 0.140
    AUDIO_Y, AUDIO_H = 0.128, 0.028   # audio controls strip between phase sliders
    MAIN_X,  MAIN_Y  = 0.140, 0.368   # lowered slightly to make room for the preset row
    MAIN_W,  MAIN_H  = 0.720, 0.562   # keep top at 0.930
    SLOT_X_L, SLOT_X_R, SLOT_W = 0.010, 0.875, 0.110
    SLOT_Y_TOP, SLOT_H_TOP = 0.640, 0.290
    SLOT_Y_BOT, SLOT_H_BOT = 0.368, 0.262

    temp_desc = fig.text(
        0.50, TEMP_DESC_Y, TEMP_DESCRIPTIONS[state['temp']],
        ha='center', va='top', color='#7a8fa8', fontsize=8, style='italic')

    ax_main  = fig.add_axes([MAIN_X,  MAIN_Y,  MAIN_W,  MAIN_H])
    _curve_lc, _segs_buf = _init_curve_ax(ax_main)

    ax_piano = fig.add_axes([0.010,   PIANO_Y, 0.980,   PIANO_H])
    _piano_arts = _init_piano_ax(ax_piano, piano_keys)

    # Note slot axes: 0=Note1(X), 1=Note2(X), 2=Note3(Y), 3=Note4(Y)
    ax_slots = [
        fig.add_axes([SLOT_X_L, SLOT_Y_TOP, SLOT_W, SLOT_H_TOP]),
        fig.add_axes([SLOT_X_L, SLOT_Y_BOT, SLOT_W, SLOT_H_BOT]),
        fig.add_axes([SLOT_X_R, SLOT_Y_TOP, SLOT_W, SLOT_H_TOP]),
        fig.add_axes([SLOT_X_R, SLOT_Y_BOT, SLOT_W, SLOT_H_BOT]),
    ]
    _slot_arts = [_init_slot_ax(ax_slots[i], i) for i in range(4)]

    # Preset row: name entry + save/prev/next/delete, then file path + browse/export/import
    ax_preset_name  = fig.add_axes([0.010, PRESET_Y, 0.100, PRESET_H])
    ax_preset_save  = fig.add_axes([0.116, PRESET_Y, 0.050, PRESET_H])
    ax_preset_prev  = fig.add_axes([0.172, PRESET_Y, 0.030, PRESET_H])
    ax_preset_next  = fig.add_axes([0.384, PRESET_Y, 0.030, PRESET_H])
    ax_preset_del   = fig.add_axes([0.420, PRESET_Y, 0.055, PRESET_H])
    ax_preset_path  = fig.add_axes([0.501, PRESET_Y, 0.230, PRESET_H])
    ax_preset_brow  = fig.add_axes([0.737, PRESET_Y, 0.065, PRESET_H])
    ax_preset_exp   = fig.add_axes([0.808, PRESET_Y, 0.065, PRESET_H])
    ax_preset_imp   = fig.add_axes([0.879, PRESET_Y, 0.065, PRESET_H])

    _ANIM_W = 0.055
    ax_anim_px  = fig.add_axes([0.010,  PHASE_Y, _ANIM_W, PHASE_H])
    ax_px       = fig.add_axes([0.130,  PHASE_Y, 0.100,   PHASE_H])
    ax_pxy      = fig.add_axes([0.790,  PHASE_Y, 0.100,   PHASE_H])
    ax_anim_pxy = fig.add_axes([0.935,  PHASE_Y, _ANIM_W, PHASE_H])

    # Audio controls strip
    ax_aud_on   = fig.add_axes([0.310, AUDIO_Y, 0.05, AUDIO_H])
    ax_aud_sine = fig.add_axes([0.365, AUDIO_Y, 0.050, AUDIO_H])
    ax_aud_ep   = fig.add_axes([0.420, AUDIO_Y, 0.050, AUDIO_H])
    ax_aud_pno  = fig.add_axes([0.475, AUDIO_Y, 0.050, AUDIO_H])
    ax_vol      = fig.add_axes([0.545, AUDIO_Y, 0.100, AUDIO_H])

    n_temp  = len(TEMP_NAMES)
    btn_w   = 0.98 / n_temp
    btn_axs = [fig.add_axes([0.01 + i * btn_w, TEMP_Y, btn_w * 0.97, TEMP_H])
               for i in range(n_temp)]

    for ax in ([ax_px, ax_pxy, ax_anim_px, ax_anim_pxy,
                ax_aud_on, ax_aud_sine, ax_aud_ep, ax_aud_pno, ax_vol,
                ax_preset_name, ax_preset_save, ax_preset_prev, ax_preset_next,
                ax_preset_del, ax_preset_path, ax_preset_brow, ax_preset_exp,
                ax_preset_imp]
               + btn_axs):
        ax.set_facecolor(BG)

    # Static labels
    fig.text(0.065, 0.943, 'X  AXIS', color=X_COL,
             ha='center', fontsize=11, fontweight='bold')
    fig.text(0.930, 0.943, 'Y  AXIS', color=Y_COL,
             ha='center', fontsize=11, fontweight='bold')
    fig.text(0.50, TEMP_Y + TEMP_H + 0.005, 'T E M P E R A M E N T',
             ha='center', va='bottom', color='#556677',
             fontsize=7.5, fontweight='bold')
    fig.text(0.50, PIANO_Y + PIANO_H + 0.003,
           'Click a key  ·  A–J = C–B (home oct)  ·  K,O,L,P = next oct  ·  '
           '[ ] shift octave  ·  1–4 / Tab select slot  ·  Space = sound on/off',
           ha='center', va='bottom', color='#7a8fa8', fontsize=7) 
    # Phase sliders
    sl_px  = Slider(ax_px,  'φ inner X ', 0, 2 * np.pi,
                    valinit=state['phi_x'],  color='#996633')
    sl_pxy = Slider(ax_pxy, 'φ X vs Y ',  0, 2 * np.pi,
                    valinit=state['phi_xy'], color='#664499')
    for sl in (sl_px, sl_pxy):
        sl.label.set_color(WHITE)
        sl.valtext.set_color(WHITE)

    # Animate buttons (one per slider, at the outer edges)
    btn_anim_px  = Button(ax_anim_px,  '▶', color=BTN_OFF, hovercolor='#162840')
    btn_anim_pxy = Button(ax_anim_pxy, '▶', color=BTN_OFF, hovercolor='#162840')
    for btn in (btn_anim_px, btn_anim_pxy):
        btn.label.set_color(WHITE)
        btn.label.set_fontsize(12)
    for ax in (ax_anim_px, ax_anim_pxy):
        for sp in ax.spines.values():
            sp.set_edgecolor(BTN_EDGE_OFF)
            sp.set_linewidth(0.5)

    # Audio controls
    _AUDIO_TONE_NAMES = [('sine', 'Sine'), ('epiano', 'E. Piano'), ('piano', 'Piano')]
    btn_aud_on   = Button(ax_aud_on,   '♪  off', color=BTN_OFF, hovercolor='#162840')
    btn_aud_sine = Button(ax_aud_sine, 'Sine',    color=BTN_OFF, hovercolor='#162840')
    btn_aud_ep   = Button(ax_aud_ep,   'E. Piano',color=BTN_OFF, hovercolor='#162840')
    btn_aud_pno  = Button(ax_aud_pno,  'Piano',   color=BTN_OFF, hovercolor='#162840')
    sl_vol = Slider(ax_vol, 'Vol', 0.0, 1.0, valinit=0.25, color='#2a5a3a')
    sl_vol.label.set_color(WHITE)
    sl_vol.valtext.set_color(WHITE)

    _aud_tone_axs  = [ax_aud_sine, ax_aud_ep, ax_aud_pno]
    _aud_tone_btns = [btn_aud_sine, btn_aud_ep, btn_aud_pno]

    def _style_aud_tone(active_key):
        for (key, _), ax, btn in zip(_AUDIO_TONE_NAMES, _aud_tone_axs, _aud_tone_btns):
            on = (key == active_key)
            ax.set_facecolor(BTN_ON if on else BTN_OFF)
            for sp in ax.spines.values():
                sp.set_edgecolor(BTN_EDGE_ON if on else BTN_EDGE_OFF)
                sp.set_linewidth(1.4 if on else 0.5)
            btn.label.set_color(WHITE if on else '#778899')

    for ax in _aud_tone_axs:
        for sp in ax.spines.values():
            sp.set_edgecolor(BTN_EDGE_OFF)
            sp.set_linewidth(0.5)
    for sp in ax_aud_on.spines.values():
        sp.set_edgecolor(ORANGE_DIM)
        sp.set_linewidth(1.2)
    for btn in _aud_tone_btns:
        btn.label.set_fontsize(8)
        btn.label.set_color('#778899')
    btn_aud_on.label.set_fontsize(8.5)
    btn_aud_on.label.set_fontweight('bold')
    btn_aud_on.label.set_color(ORANGE)
    _style_aud_tone('sine')   # sine pre-selected

    # Temperament buttons
    btns = []
    for i, name in enumerate(TEMP_NAMES):
        btn = Button(btn_axs[i], name, color=BTN_OFF, hovercolor='#162840')
        btn.label.set_fontsize(8.5)
        btns.append(btn)
    _style_temp_buttons(btn_axs, btns, 0)

    # Preset controls
    def _style_preset_button(ax, btn, edge=ACCENT):
        ax.set_facecolor(BTN_OFF)
        for sp in ax.spines.values():
            sp.set_edgecolor(edge)
            sp.set_linewidth(0.9)
        btn.label.set_fontsize(8)
        btn.label.set_color(WHITE)

    def _style_textbox(ax):
        ax.set_facecolor('#0f1825')
        for sp in ax.spines.values():
            sp.set_edgecolor(BTN_EDGE_OFF)
            sp.set_linewidth(0.8)

    name_box = TextBox(ax_preset_name, '', initial='', textalignment='left')
    btn_preset_save = Button(ax_preset_save, 'Save', color=BTN_OFF, hovercolor='#162840')
    btn_preset_prev = Button(ax_preset_prev, '◀', color=BTN_OFF, hovercolor='#162840')
    btn_preset_next = Button(ax_preset_next, '▶', color=BTN_OFF, hovercolor='#162840')
    btn_preset_del  = Button(ax_preset_del,  'Delete', color=BTN_OFF, hovercolor='#162840')
    path_box = TextBox(ax_preset_path, '',
                        initial=os.path.expanduser('~/lissajous_shared.json'),
                        textalignment='left')
    btn_preset_browse = Button(ax_preset_brow, 'Browse…', color=BTN_OFF, hovercolor='#162840')
    btn_preset_export = Button(ax_preset_exp,  'Export ↑', color=BTN_OFF, hovercolor='#162840')
    btn_preset_import = Button(ax_preset_imp,  'Import ↓', color=BTN_OFF, hovercolor='#162840')

    for ax in (ax_preset_name, ax_preset_path):
        _style_textbox(ax)
    for tb in (name_box, path_box):
        tb.label.set_color(WHITE)
        tb.text_disp.set_color(WHITE)
        tb.text_disp.set_fontsize(8)
    for ax, btn in ((ax_preset_save, btn_preset_save), (ax_preset_prev, btn_preset_prev),
                    (ax_preset_next, btn_preset_next), (ax_preset_del, btn_preset_del),
                    (ax_preset_brow, btn_preset_browse), (ax_preset_exp, btn_preset_export),
                    (ax_preset_imp, btn_preset_import)):
        _style_preset_button(ax, btn)

    def _preset_label_text():
        if not presets:
            return '(no saved presets)'
        p = presets[preset_idx[0]]
        return f'{preset_idx[0] + 1}/{len(presets)}   {p["name"]}'

    preset_label = fig.text(
        0.293, PRESET_Y + PRESET_H / 2, _preset_label_text(), ha='center', va='center',
        color='#7a8fa8', fontsize=8, fontweight='bold')

    # ── Draw helpers ──────────────────────────────────────────────────────────

    def redraw_slots():
        for i in range(4):
            draw_slot(ax_slots[i], i, state, _slot_arts[i])

    # _blit[0] = saved background pixel buffer (ax_main without the curve)
    # _blit[1] = guard flag to prevent re-entrant _save_bg calls
    _blit = [None, False]

    def _save_bg():
        """Save ax_main background (LC hidden) so animation can blit over it."""
        if _blit[1]:
            return
        _blit[1] = True
        _curve_lc.set_visible(False)
        fig.canvas.draw()                                    # sync render, LC absent
        _blit[0] = fig.canvas.copy_from_bbox(ax_main.bbox)  # capture pixel buffer
        _curve_lc.set_visible(True)
        ax_main.draw_artist(_curve_lc)                       # restore LC on screen
        fig.canvas.blit(ax_main.bbox)
        _blit[1] = False

    def _refresh_anim(_=None):
        """Fast animation path: restore saved pixels, draw only the LC, blit."""
        freqs = [note_freq(state['notes'][i], state['octs'][i], state['temp'])
                 for i in range(4)]
        _fill_curve(_curve_lc, freqs, state['phi_x'], state['phi_xy'], _segs_buf)
        if _blit[0] is not None:
            fig.canvas.restore_region(_blit[0])
            ax_main.draw_artist(_curve_lc)
            fig.canvas.blit(ax_main.bbox)
        else:
            fig.canvas.draw_idle()

    def full_redraw():
        redraw_slots()
        update_piano(_piano_arts, piano_keys, state)
        freqs  = [note_freq(state['notes'][i], state['octs'][i], state['temp'])
                  for i in range(4)]
        labels = [f'{state["notes"][i]}{state["octs"][i]}' for i in range(4)]
        _update_curve(_curve_lc, ax_main, freqs,
                      state['phi_x'], state['phi_xy'], labels, state['temp'],
                      _segs_buf)
        _save_bg()   # sync draw + capture background; also puts LC back on screen
        if _audio_engine._on:
            _audio_engine.set_freqs(freqs)

    # ── Preset callbacks ──────────────────────────────────────────────────────

    def _apply_preset(p):
        state['notes']  = list(p['notes'])
        state['octs']   = list(p['octaves'])
        state['phi_x']  = float(p['phi_x'])
        state['phi_xy'] = float(p['phi_xy'])
        state['temp']   = p['temperament']
        sl_px.set_val(state['phi_x'])
        sl_pxy.set_val(state['phi_xy'])
        temp_desc.set_text(TEMP_DESCRIPTIONS[state['temp']])
        _style_temp_buttons(btn_axs, btns, TEMP_NAMES.index(state['temp']))
        full_redraw()

    def _show_preset_status(msg):
        preset_label.set_text(msg)
        fig.canvas.draw_idle()

    def _goto_preset(step):
        if not presets:
            return
        preset_idx[0] = (preset_idx[0] + step) % len(presets)
        _apply_preset(presets[preset_idx[0]])
        preset_label.set_text(_preset_label_text())
        fig.canvas.draw_idle()

    def _save_preset(_event):
        name = name_box.text.strip() or f'Preset {len(presets) + 1}'
        preset = _preset_from_state(state, name)

        image_ok = True
        image_err = None
        try:
            slug = _slugify(name)
            image_name = f'{slug}.png'
            n = 2
            while os.path.exists(os.path.join(IMAGES_DIR, image_name)):
                image_name = f'{slug}-{n}.png'
                n += 1
            image_path = os.path.join(IMAGES_DIR, image_name)
            render_curve_image(preset, image_path)
            preset['image'] = os.path.join('images', image_name)
        except Exception as e:
            image_ok, image_err = False, str(e)

        presets.append(preset)
        preset_idx[0] = len(presets) - 1
        try:
            _write_presets(PRESETS_FILE, presets)
        except OSError as e:
            _show_preset_status(f'Save failed: {e}')
            return

        name_box.set_val('')
        if image_ok:
            preset_label.set_text(_preset_label_text())
        else:
            _show_preset_status(f'Saved "{name}" (image failed: {image_err})')
        fig.canvas.draw_idle()

    def _delete_preset(_event):
        if not presets:
            return
        removed = presets[preset_idx[0]]
        del presets[preset_idx[0]]
        preset_idx[0] = min(preset_idx[0], len(presets) - 1)
        image_rel = removed.get('image')
        if image_rel:
            try:
                os.remove(os.path.join(PRESETS_DIR, image_rel))
            except OSError:
                pass
        try:
            _write_presets(PRESETS_FILE, presets)
        except OSError as e:
            _show_preset_status(f'Delete failed: {e}')
            return
        preset_label.set_text(_preset_label_text())
        fig.canvas.draw_idle()

    def _browse_for_path(save):
        if not _TK_OK:
            _show_preset_status('Browse unavailable — type a path instead')
            return
        root = tkinter.Tk()
        root.withdraw()
        try:
            if save:
                path = _filedialog.asksaveasfilename(
                    defaultextension='.json',
                    filetypes=[('Lissajous presets', '*.json')],
                    initialfile='lissajous_shared.json')
            else:
                path = _filedialog.askopenfilename(
                    filetypes=[('Lissajous presets', '*.json'), ('All files', '*.*')])
        finally:
            root.destroy()
        if path:
            path_box.set_val(path)

    def _browse_path_cb(_event):
        _browse_for_path(save=True)

    def _export_presets(_event):
        path = path_box.text.strip()
        if not path:
            return
        if not path.lower().endswith('.json'):
            path += '.json'
            path_box.set_val(path)
        try:
            _write_presets(path, presets)
        except OSError as e:
            _show_preset_status(f'Export failed: {e}')
            return
        _show_preset_status(f'Exported {len(presets)} preset(s) → {os.path.basename(path)}')

    def _import_presets(_event):
        path = path_box.text.strip()
        if not path:
            return
        try:
            incoming = _load_presets(path)
        except OSError as e:
            _show_preset_status(f'Import failed: {e}')
            return
        if not incoming:
            _show_preset_status('No presets found in that file')
            return
        existing_names = {p['name'] for p in presets}
        added = 0
        for p in incoming:
            name = p.get('name', 'Imported preset')
            if name in existing_names:
                base, n = name, 2
                while f'{base} ({n})' in existing_names:
                    n += 1
                name = f'{base} ({n})'
            new_p = dict(p)
            new_p['name'] = name
            new_p.pop('image', None)  # the image file itself isn't bundled in the export
            try:
                slug = _slugify(name)
                image_name = f'{slug}.png'
                m = 2
                while os.path.exists(os.path.join(IMAGES_DIR, image_name)):
                    image_name = f'{slug}-{m}.png'
                    m += 1
                render_curve_image(new_p, os.path.join(IMAGES_DIR, image_name))
                new_p['image'] = os.path.join('images', image_name)
            except Exception:
                pass  # metadata still imports fine without a local image
            presets.append(new_p)
            existing_names.add(name)
            added += 1
        preset_idx[0] = len(presets) - 1
        try:
            _write_presets(PRESETS_FILE, presets)
        except OSError as e:
            _show_preset_status(f'Import saved in-memory only — {e}')
            return
        _show_preset_status(f'Imported {added} preset(s)')

    # ── Event callbacks ───────────────────────────────────────────────────────

    def on_click(event):
        if event.inaxes is None:
            return
        # Click on a note slot → make it active
        for i, ax in enumerate(ax_slots):
            if event.inaxes is ax:
                state['active_slot'] = i
                redraw_slots()
                fig.canvas.draw_idle()
                return
        # Click on the piano → assign note to active slot
        if event.inaxes is ax_piano and event.xdata is not None:
            k = find_key_at(piano_keys, event.xdata, event.ydata)
            if k:
                slot = state['active_slot']
                state['notes'][slot] = k['note']
                state['octs'][slot]  = k['octave']
                state['active_slot'] = (slot + 1) % 4
                full_redraw()

    def on_key(event):
        if name_box.capturekeystrokes or path_box.capturekeystrokes:
            return  # let the focused text box handle its own typing

        key = (event.key or '').lower()

        if key in ('1', '2', '3', '4'):
            state['active_slot'] = int(key) - 1
            redraw_slots()
            fig.canvas.draw_idle()
            return

        if key == 'tab':
            state['active_slot'] = (state['active_slot'] + 1) % 4
            redraw_slots()
            fig.canvas.draw_idle()
            return

        if key == '[':
            state['base_octave'] = max(PIANO_OCT_LOW, state['base_octave'] - 1)
            update_piano(_piano_arts, piano_keys, state)
            fig.canvas.draw_idle()
            return

        if key == ']':
            state['base_octave'] = min(PIANO_OCT_HIGH - 1, state['base_octave'] + 1)
            update_piano(_piano_arts, piano_keys, state)
            fig.canvas.draw_idle()
            return

        if key == ' ':
            _toggle_audio(None)
            return

        if key in KB_MAP:
            semi, oct_off = KB_MAP[key]
            note   = NOTE_NAMES[semi]
            octave = state['base_octave'] + oct_off
            octave = max(PIANO_OCT_LOW, min(PIANO_OCT_HIGH, octave))
            slot   = state['active_slot']
            state['notes'][slot] = note
            state['octs'][slot]  = octave
            state['active_slot'] = (slot + 1) % 4
            full_redraw()

    def make_temp_cb(i, name):
        def cb(_):
            state['temp'] = name
            temp_desc.set_text(TEMP_DESCRIPTIONS[name])
            _style_temp_buttons(btn_axs, btns, i)
            full_redraw()
        return cb

    sl_px.on_changed( lambda v: state.update({'phi_x':  v}) or _refresh_anim())
    sl_pxy.on_changed(lambda v: state.update({'phi_xy': v}) or _refresh_anim())

    for i, (btn, name) in enumerate(zip(btns, TEMP_NAMES)):
        btn.on_clicked(make_temp_cb(i, name))

    def _make_anim_toggle(key, ax_btn, btn):
        def cb(_):
            state[key] = not state[key]
            on = state[key]
            ax_btn.set_facecolor(BTN_ON if on else BTN_OFF)
            for sp in ax_btn.spines.values():
                sp.set_edgecolor(BTN_EDGE_ON if on else BTN_EDGE_OFF)
                sp.set_linewidth(1.4 if on else 0.5)
            btn.label.set_text('■' if on else '▶')
            btn.label.set_color(ACCENT if on else WHITE)
            fig.canvas.draw_idle()
        return cb

    btn_anim_px.on_clicked(_make_anim_toggle('anim_phi_x',  ax_anim_px,  btn_anim_px))
    btn_anim_pxy.on_clicked(_make_anim_toggle('anim_phi_xy', ax_anim_pxy, btn_anim_pxy))

    # ── Audio callbacks ───────────────────────────────────────────────────────

    def _toggle_audio(_):
        if not _SD_OK:
            return
        if _audio_engine._on:
            _audio_engine.disable()
            ax_aud_on.set_facecolor(BTN_OFF)
            for sp in ax_aud_on.spines.values():
                sp.set_edgecolor(ORANGE_DIM)
                sp.set_linewidth(1.2)
            btn_aud_on.label.set_text('♪  off')
            btn_aud_on.label.set_color(ORANGE)
        else:
            freqs = [note_freq(state['notes'][i], state['octs'][i], state['temp'])
                     for i in range(4)]
            _audio_engine.enable(freqs)
            ax_aud_on.set_facecolor(ORANGE_BG_ON)
            for sp in ax_aud_on.spines.values():
                sp.set_edgecolor(ORANGE)
                sp.set_linewidth(2.0)
            btn_aud_on.label.set_text('♪  on')
            btn_aud_on.label.set_color(ORANGE)
        fig.canvas.draw_idle()

    def _make_tone_cb(key):
        def cb(_):
            _audio_engine.set_tone(key)
            _style_aud_tone(key)
            fig.canvas.draw_idle()
        return cb

    btn_aud_on.on_clicked(_toggle_audio)
    for (key, _), btn in zip(_AUDIO_TONE_NAMES, _aud_tone_btns):
        btn.on_clicked(_make_tone_cb(key))
    sl_vol.on_changed(_audio_engine.set_volume)

    btn_preset_save.on_clicked(_save_preset)
    btn_preset_prev.on_clicked(lambda _: _goto_preset(-1))
    btn_preset_next.on_clicked(lambda _: _goto_preset(1))
    btn_preset_del.on_clicked(_delete_preset)
    btn_preset_browse.on_clicked(_browse_path_cb)
    btn_preset_export.on_clicked(_export_presets)
    btn_preset_import.on_clicked(_import_presets)

    fig.canvas.mpl_connect('button_press_event', on_click)
    fig.canvas.mpl_connect('key_press_event',    on_key)

    full_redraw()

    # ── MIDI input ────────────────────────────────────────────────────────────
    _midi_q = _queue.Queue()
    midi_status = fig.text(
        0.50, (PHASE_Y + PHASE_H + PIANO_Y) / 2, '',
        ha='center', va='center', color='#556677', fontsize=7, style='italic')

    if _MIDO_OK:
        _ports = mido.get_input_names()
        if _ports:
            midi_status.set_text(f'MIDI  ·  {_ports[0]}')
            midi_status.set_color(ACCENT)
            threading.Thread(target=_midi_worker, args=(_midi_q, _ports[0]),
                             daemon=True).start()
        else:
            midi_status.set_text('MIDI  ·  no device found')
    else:
        midi_status.set_text('MIDI unavailable  (pip install mido python-rtmidi)')

    _ANIM_STEP = 0.05  # radians per 40 ms  ≈ 5 s per full 2π cycle

    def _poll_midi():
        midi_changed = False
        while not _midi_q.empty():
            midi_note = _midi_q.get_nowait()
            note   = NOTE_NAMES[midi_note % 12]
            octave = (midi_note // 12) - 1
            slot   = state['active_slot']
            state['notes'][slot] = note
            state['octs'][slot]  = octave
            state['active_slot'] = (slot + 1) % 4
            midi_changed = True
        if state['anim_phi_x']:
            sl_px.set_val((state['phi_x'] + _ANIM_STEP) % (2 * np.pi))
        if state['anim_phi_xy']:
            sl_pxy.set_val((state['phi_xy'] + _ANIM_STEP) % (2 * np.pi))
        if midi_changed:
            full_redraw()

    _midi_timer = fig.canvas.new_timer(interval=40)
    _midi_timer.add_callback(_poll_midi)
    _midi_timer.start()

    fig.canvas.mpl_connect('close_event',  lambda _e: _audio_engine.close())
    fig.canvas.mpl_connect('resize_event', lambda _e: (_blit.__setitem__(0, None),
                                                        _save_bg()))

    plt.show()


if __name__ == '__main__':
    main()
