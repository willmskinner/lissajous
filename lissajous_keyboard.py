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
"""

import queue as _queue
import threading
import numpy as np
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
from matplotlib.widgets import Slider, Button
from fractions import Fraction
from math import gcd, lcm
try:
    import mido
    _MIDO_OK = True
except ImportError:
    _MIDO_OK = False

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
    'Werckmeister III': [2 ** (c / 1200)   for c in _W3],
    'Kirnberger III':   [2 ** (c / 1200)   for c in _K3],
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
    'Werckmeister III':
        'Well temperament (1691): four 5ths narrow by ¼ Pythagorean comma.  '
        'All 12 keys usable; "home" keys sound purer and warmer.',
    'Kirnberger III':
        'Well temperament (c. 1779): C–E pure (5/4); gentle gradation.  '
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
PIANO_WHITE  = '#dde0e8'
PIANO_BLACK  = '#1c1c2c'
PIANO_BORDER = '#111122'

# ─────────────────────────────────────────────────────────────────────────────
# Curve drawing
# ─────────────────────────────────────────────────────────────────────────────

def draw_curve(ax, freqs, phi_x, phi_xy, labels, temperament):
    f1, f2, f3, f4 = freqs
    x, y = lissajous_4(freqs, phi_x, phi_xy)
    rx, ix = describe_ratio(f1, f2)
    ry, iy = describe_ratio(f3, f4)
    ix_s = f' – {ix}' if ix else ''
    iy_s = f' – {iy}' if iy else ''

    ax.clear()
    ax.set_facecolor(BG)
    for v in [-1, -0.5, 0, 0.5, 1]:
        ax.axhline(v, color=DIM, lw=0.3, alpha=0.6)
        ax.axvline(v, color=DIM, lw=0.3, alpha=0.6)

    segs    = 80
    seg_len = len(x) // segs
    for i in range(segs):
        s = slice(i * seg_len, (i + 1) * seg_len + 1)
        ax.plot(x[s], y[s], color=CURVE_COL,
                lw=0.9, alpha=0.15 + 0.85 * (i / segs),
                solid_capstyle='round')

    ax.set_xlim(-1.15, 1.15)
    ax.set_ylim(-1.15, 1.15)
    ax.set_aspect('equal')
    ax.set_xticks([])
    ax.set_yticks([])
    for spine in ax.spines.values():
        spine.set_color(DIM)

    ax.set_xlabel(
        f'{labels[0]} ({f1:.1f} Hz) + {labels[1]} ({f2:.1f} Hz)   [{rx}{ix_s}]',
        color=X_COL, fontsize=9, labelpad=5)
    ax.set_ylabel(
        f'{labels[2]} ({f3:.1f} Hz) + {labels[3]} ({f4:.1f} Hz)   [{ry}{iy_s}]',
        color=Y_COL, fontsize=9, labelpad=5, rotation=90)
    ax.set_title(
        f'{temperament}   ·   '
        f'X = {labels[0]} + {labels[1]}   ·   Y = {labels[2]} + {labels[3]}',
        color=WHITE, fontsize=10, pad=10)

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
# Piano drawing
# ─────────────────────────────────────────────────────────────────────────────

def draw_piano(ax, keys, state):
    ax.clear()
    ax.set_facecolor(BG)
    ax.set_xlim(-0.3, N_WHITE + 0.3)
    ax.set_ylim(-0.14, 1.04)
    ax.set_xticks([])
    ax.set_yticks([])
    for sp in ax.spines.values():
        sp.set_color(DIM)
        sp.set_linewidth(0.5)

    base_oct = state['base_octave']

    # Build (note, octave) → slot-color map for highlighted keys
    assigned = {}
    for i in range(4):
        assigned[(state['notes'][i], state['octs'][i])] = NOTE_COLS[i]

    # White keys
    for k in keys:
        if k['is_black']:
            continue
        nt = (k['note'], k['octave'])
        fc = assigned.get(nt, PIANO_WHITE)
        ax.add_patch(mpatches.Rectangle(
            (k['x'] + 0.04, k['y'] + 0.02), k['w'] - 0.08, k['h'] - 0.04,
            facecolor=fc, edgecolor=PIANO_BORDER, linewidth=0.6, zorder=1))

    # Black keys (drawn on top)
    for k in keys:
        if not k['is_black']:
            continue
        nt = (k['note'], k['octave'])
        fc = assigned.get(nt, PIANO_BLACK)
        ax.add_patch(mpatches.Rectangle(
            (k['x'], k['y']), k['w'], k['h'],
            facecolor=fc, edgecolor='#000000', linewidth=0.5, zorder=2))

    # Keyboard shortcut labels on the keys for the current base octave
    for kb_key, (semi, oct_off) in KB_MAP.items():
        tgt_note = NOTE_NAMES[semi]
        tgt_oct  = base_oct + oct_off
        for k in keys:
            if k['note'] == tgt_note and k['octave'] == tgt_oct:
                cx = k['x'] + k['w'] / 2
                if k['is_black']:
                    cy, tc, fs = k['y'] + 0.11, '#cccccc', 5.5
                else:
                    cy, tc, fs = k['y'] + 0.09, '#334455', 6.0
                ax.text(cx, cy, kb_key.upper(),
                        ha='center', va='center',
                        fontsize=fs, color=tc, zorder=3)
                break

    # Octave labels (C3, C4, …) below each C key
    for k in keys:
        if k['note'] == 'C':
            col = ACCENT if k['octave'] == base_oct else '#3a4a5a'
            ax.text(k['x'] + 0.5, -0.07, f"C{k['octave']}",
                    ha='center', va='center',
                    fontsize=6.5, color=col, zorder=3)

    # Underline the active base-octave span
    for k in keys:
        if k['note'] == 'C' and k['octave'] == base_oct:
            ax.plot([k['x'] + 0.1, k['x'] + 6.9], [-0.03, -0.03],
                    color=ACCENT, lw=1.2, alpha=0.7, zorder=4,
                    solid_capstyle='round')
            break

# ─────────────────────────────────────────────────────────────────────────────
# Note slot drawing
# ─────────────────────────────────────────────────────────────────────────────

def draw_slot(ax, slot_idx, state):
    note    = state['notes'][slot_idx]
    octave  = state['octs'][slot_idx]
    col     = NOTE_COLS[slot_idx]
    is_act  = (state['active_slot'] == slot_idx)
    ax_lbl  = 'X  AXIS' if slot_idx < 2 else 'Y  AXIS'
    ax_col  = X_COL    if slot_idx < 2 else Y_COL

    ax.clear()
    ax.set_facecolor('#070813')
    ax.set_xticks([])
    ax.set_yticks([])
    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1)

    for sp in ax.spines.values():
        sp.set_edgecolor(col)
        sp.set_linewidth(2.5 if is_act else 0.8)

    ax.text(0.5, 0.90, f'Note {slot_idx + 1}',
            ha='center', va='center',
            color=col if is_act else '#445566',
            fontsize=7.5, fontweight='bold',
            transform=ax.transAxes)

    ax.text(0.5, 0.79, ax_lbl,
            ha='center', va='center',
            color=ax_col, fontsize=6.5,
            transform=ax.transAxes)

    ax.text(0.5, 0.54, f'{note}{octave}',
            ha='center', va='center',
            color=col, fontsize=20, fontweight='bold',
            transform=ax.transAxes)

    freq = note_freq(note, octave, state['temp'])
    ax.text(0.5, 0.35, f'{freq:.1f} Hz',
            ha='center', va='center',
            color='#4a5a6a', fontsize=8,
            transform=ax.transAxes)

    if is_act:
        ax.text(0.5, 0.16, '▲  ACTIVE',
                ha='center', va='center',
                color=col, fontsize=7, fontweight='bold',
                transform=ax.transAxes)
    else:
        ax.text(0.5, 0.16, f'press  {slot_idx + 1}',
                ha='center', va='center',
                color='#2a3a4a', fontsize=6.5,
                transform=ax.transAxes)

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

    piano_keys = _build_piano_keys()

    fig = plt.figure(figsize=(16, 10), facecolor=BG)
    fig.suptitle('Lissajous Curve  ·  Four Musical Notes  ·  Piano Keyboard',
                 color=WHITE, fontsize=13, fontweight='bold', y=0.997)

    temp_desc = fig.text(
        0.50, 0.975, TEMP_DESCRIPTIONS[state['temp']],
        ha='center', va='top', color='#7a8fa8', fontsize=8, style='italic')

    # ── Layout ────────────────────────────────────────────────────────────────
    TEMP_Y,  TEMP_H  = 0.010, 0.055
    PHASE_Y, PHASE_H = 0.082, 0.046   # taller sliders, pushed up to clear TEMP label
    PIANO_Y, PIANO_H = 0.147, 0.140   # raised to give MIDI status its own gap
    MAIN_X,  MAIN_Y  = 0.140, 0.325   # raised to clear piano instruction + xlabel
    MAIN_W,  MAIN_H  = 0.720, 0.605   # slightly shorter to keep top at 0.930
    SLOT_X_L, SLOT_X_R, SLOT_W = 0.010, 0.875, 0.110
    SLOT_Y_TOP, SLOT_H_TOP = 0.620, 0.310
    SLOT_Y_BOT, SLOT_H_BOT = 0.325, 0.285  # bottom of slot matches new MAIN_Y

    ax_main  = fig.add_axes([MAIN_X,  MAIN_Y,  MAIN_W,  MAIN_H])
    ax_piano = fig.add_axes([0.010,   PIANO_Y, 0.980,   PIANO_H])

    # Note slot axes: 0=Note1(X), 1=Note2(X), 2=Note3(Y), 3=Note4(Y)
    ax_slots = [
        fig.add_axes([SLOT_X_L, SLOT_Y_TOP, SLOT_W, SLOT_H_TOP]),
        fig.add_axes([SLOT_X_L, SLOT_Y_BOT, SLOT_W, SLOT_H_BOT]),
        fig.add_axes([SLOT_X_R, SLOT_Y_TOP, SLOT_W, SLOT_H_TOP]),
        fig.add_axes([SLOT_X_R, SLOT_Y_BOT, SLOT_W, SLOT_H_BOT]),
    ]

    _ANIM_W = 0.055
    ax_anim_px  = fig.add_axes([0.010,  PHASE_Y, _ANIM_W, PHASE_H])
    ax_px       = fig.add_axes([0.075,  PHASE_Y, 0.380,   PHASE_H])
    ax_pxy      = fig.add_axes([0.545,  PHASE_Y, 0.380,   PHASE_H])
    ax_anim_pxy = fig.add_axes([0.935,  PHASE_Y, _ANIM_W, PHASE_H])

    n_temp  = len(TEMP_NAMES)
    btn_w   = 0.98 / n_temp
    btn_axs = [fig.add_axes([0.01 + i * btn_w, TEMP_Y, btn_w * 0.97, TEMP_H])
               for i in range(n_temp)]

    for ax in ax_slots + [ax_piano, ax_px, ax_pxy, ax_anim_px, ax_anim_pxy] + btn_axs:
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
             '[ ] shift octave  ·  1–4 / Tab select slot',
             ha='center', va='bottom', color='#3a4a5a', fontsize=7)

    # Phase sliders
    sl_px  = Slider(ax_px,  'φ inner X', 0, 2 * np.pi,
                    valinit=state['phi_x'],  color='#996633')
    sl_pxy = Slider(ax_pxy, 'φ X vs Y',  0, 2 * np.pi,
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

    # Temperament buttons
    btns = []
    for i, name in enumerate(TEMP_NAMES):
        btn = Button(btn_axs[i], name, color=BTN_OFF, hovercolor='#162840')
        btn.label.set_fontsize(8.5)
        btns.append(btn)
    _style_temp_buttons(btn_axs, btns, 0)

    # ── Draw helpers ──────────────────────────────────────────────────────────

    def redraw_slots():
        for i in range(4):
            draw_slot(ax_slots[i], i, state)

    def refresh(_=None):
        freqs  = [note_freq(state['notes'][i], state['octs'][i], state['temp'])
                  for i in range(4)]
        labels = [f'{state["notes"][i]}{state["octs"][i]}' for i in range(4)]
        draw_curve(ax_main, freqs, state['phi_x'], state['phi_xy'],
                   labels, state['temp'])
        fig.canvas.draw_idle()

    def full_redraw():
        redraw_slots()
        draw_piano(ax_piano, piano_keys, state)
        refresh()

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
            draw_piano(ax_piano, piano_keys, state)
            fig.canvas.draw_idle()
            return

        if key == ']':
            state['base_octave'] = min(PIANO_OCT_HIGH - 1, state['base_octave'] + 1)
            draw_piano(ax_piano, piano_keys, state)
            fig.canvas.draw_idle()
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

    sl_px.on_changed( lambda v: state.update({'phi_x':  v}) or refresh())
    sl_pxy.on_changed(lambda v: state.update({'phi_xy': v}) or refresh())

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

    plt.show()


if __name__ == '__main__':
    main()
