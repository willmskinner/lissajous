"""
Lissajous Curve — Three Musical Notes  ·  Piano Keyboard Interface  ·  3D module

  X(t) = sin(rx·t)
  Y(t) = sin(ry·t + φy)
  Z(t) = sin(rz·t + φz)

One note per axis (instead of the 2D module's two-notes-summed-per-axis).
The central plot is the true 3D curve; the panel above it, below it, and to
its right are the 2D projections onto the XZ ("top"), XY ("front"), and YZ
("side") planes.

Same piano / computer-keyboard controls, phase sliders, temperaments, audio
engine, and preset system as the 2D module — see lissajous_keyboard.py.
Notes go to X/Y/Z instead of four note slots:

  1 / 2 / 3        select active note slot (X / Y / Z)
  Tab              cycle active slot
  [ / ]            shift the home octave down / up
  A–J              C D E F G A B  (home octave)
  W E T Y U        C# D# F# G# A#  (home octave)
  K L              C D  (+1 octave)
  O P              C# D#  (+1 octave)
  Space            toggle sound on/off

The "2D View" button in the top-right switches back to the 2D module
without losing your audio/MIDI connection.
"""

import os
import numpy as np
from matplotlib.widgets import Slider, Button, TextBox
from mpl_toolkits.mplot3d import Axes3D  # noqa: F401  (registers the 3d projection)
from mpl_toolkits.mplot3d.art3d import Line3DCollection

import lissajous_common as lc

# ─────────────────────────────────────────────────────────────────────────────
# Lissajous computation  (3D: one note per axis)
# ─────────────────────────────────────────────────────────────────────────────

_N_POINTS = 6000

AXIS_NAMES = ['X', 'Y', 'Z']
AXIS_COLS  = [lc.X_COL, lc.Y_COL, lc.Z_COL]
SLOT_COLS  = lc.NOTE_COLS[:3]


def lissajous_3(freqs, phi_y, phi_z, n=_N_POINTS):
    f_min = min(freqs)
    r = [f / f_min for f in freqs]
    T = lc.period(freqs)
    t = np.linspace(0, 2 * np.pi * T, n)
    x = np.sin(r[0] * t)
    y = np.sin(r[1] * t + phi_y)
    z = np.sin(r[2] * t + phi_z)
    for arr in (x, y, z):
        m = np.abs(arr).max()
        if m > 1e-6:
            arr /= m
    return x, y, z


def _gradient_line3d(x, y, z, color=lc.CURVE_COL, linewidth=1.2):
    n = len(x)
    xyz = np.stack([x, y, z], axis=1)
    segs = np.stack([xyz[:-1], xyz[1:]], axis=1)
    import matplotlib.colors as mcolors
    r, g, b = mcolors.to_rgb(color)
    alphas = np.linspace(0.15, 1.0, n - 1)
    colors = np.column_stack([np.full(n - 1, r), np.full(n - 1, g),
                               np.full(n - 1, b), alphas])
    lc3d = Line3DCollection(segs, linewidths=linewidth)
    lc3d.set_color(colors)
    return lc3d


def render_curve_image(preset, path, size_px=640, dpi=120):
    """Standalone PNG snapshot of a 3D preset's curve."""
    freqs = [lc.note_freq(preset['notes'][i], preset['octaves'][i], preset['temperament'])
             for i in range(3)]
    phases = lc.preset_phases(preset)
    x, y, z = lissajous_3(freqs, phases['phi_y'], phases['phi_z'])

    fig, ax = lc.new_offscreen_figure(size_px, dpi, projection='3d')
    _style_3d_axes(ax)
    ax.add_collection3d(_gradient_line3d(x, y, z, linewidth=1.8))
    ax.view_init(elev=22, azim=-60)

    os.makedirs(os.path.dirname(path) or '.', exist_ok=True)
    fig.savefig(path, facecolor=lc.BG)


def _style_3d_axes(ax):
    ax.set_facecolor(lc.BG)
    ax.set_xlim(-1.15, 1.15)
    ax.set_ylim(-1.15, 1.15)
    ax.set_zlim(-1.15, 1.15)
    try:
        ax.set_box_aspect([1, 1, 1])
    except AttributeError:
        pass
    for pane in (ax.xaxis.pane, ax.yaxis.pane, ax.zaxis.pane):
        pane.set_facecolor(lc.BG)
        pane.set_edgecolor(lc.DIM)
    for axis in (ax.xaxis, ax.yaxis, ax.zaxis):
        axis.line.set_color(lc.DIM)
        axis._axinfo['grid']['color'] = lc.DIM
    ax.set_xticks([])
    ax.set_yticks([])
    ax.set_zticks([])


def _init_projection_ax(ax, title):
    ax.set_facecolor(lc.BG)
    for v in [-1, -0.5, 0, 0.5, 1]:
        ax.axhline(v, color=lc.DIM, lw=0.3, alpha=0.5)
        ax.axvline(v, color=lc.DIM, lw=0.3, alpha=0.5)
    ax.set_xlim(-1.15, 1.15)
    ax.set_ylim(-1.15, 1.15)
    ax.set_aspect('equal')
    ax.set_xticks([])
    ax.set_yticks([])
    for sp in ax.spines.values():
        sp.set_color(lc.DIM)
    ax.set_title(title, color='#7a8fa8', fontsize=8, pad=4)
    lc_artist = lc.gradient_line_collection(np.zeros(2), np.zeros(2))
    ax.add_collection(lc_artist)
    return lc_artist


def _fill_projection(lc_artist, a, b):
    xy = np.stack([a, b], axis=1)
    segs = np.stack([xy[:-1], xy[1:]], axis=1)
    lc_artist.set_segments(segs)

# ─────────────────────────────────────────────────────────────────────────────
# UI
# ─────────────────────────────────────────────────────────────────────────────

def build_ui(fig, ctx):
    """Draw the 3D mode into `fig` (assumed freshly cleared)."""
    ctx['mode'] = '3d'
    _audio_engine = ctx['audio_engine']

    state = {
        'notes':       ['C', 'G', 'C'],
        'octs':        [ 4,   4,   5 ],
        'phi_y':       np.pi / 4,
        'phi_z':       np.pi / 3,
        'temp':        ctx['temp'],
        'active_slot': 0,
        'base_octave': 4,
        'anim_phi_y':  False,
        'anim_phi_z':  False,
    }

    mode_presets = lambda: lc.presets_for_mode(ctx['presets'], '3d')
    preset_idx = [len(mode_presets()) - 1]

    piano_keys = lc.build_piano_keys()

    fig.suptitle('3-note Lissajous Curve — 3D',
                 color=lc.WHITE, fontsize=13, fontweight='bold', y=0.997)

    # ── Layout — bottom chrome matches the 2D module for a seamless toggle ──
    PRESET_Y, PRESET_H = 0.005, 0.028
    TEMP_DESC_Y      = 0.058
    TEMP_Y,  TEMP_H  = 0.068, 0.03
    PHASE_Y, PHASE_H = 0.120, 0.046
    PIANO_Y, PIANO_H = 0.185, 0.140
    AUDIO_Y, AUDIO_H = 0.128, 0.028

    GRAPH_Y0, GRAPH_Y1 = 0.345, 0.930   # top-section vertical span
    GRAPH_YC = (GRAPH_Y0 + GRAPH_Y1) / 2

    temp_desc = fig.text(
        0.50, TEMP_DESC_Y, lc.TEMP_DESCRIPTIONS[state['temp']],
        ha='center', va='top', color='#7a8fa8', fontsize=8, style='italic')

    # Note slot column (left, narrow): X (top) / Y (middle) / Z (bottom)
    SLOT_X, SLOT_W = 0.010, 0.075
    slot_h = (GRAPH_Y1 - GRAPH_Y0 - 0.02) / 3
    slot_ys = [GRAPH_Y1 - slot_h, GRAPH_Y1 - 2 * slot_h - 0.01, GRAPH_Y0]
    ax_slots = [fig.add_axes([SLOT_X, y, SLOT_W, slot_h]) for y in slot_ys]
    _slot_arts = [
        lc.init_slot_ax(ax_slots[i], f'{AXIS_NAMES[i]} Note',
                        f'{AXIS_NAMES[i]}  AXIS', AXIS_COLS[i])
        for i in range(3)
    ]

    # The 3D curve is the centerpiece. The three 2D projections are smaller
    # thumbnails placed nearest the cube face they correspond to: SIDE (Y–Z)
    # on the left wall's side, TOP (X–Z) upper-right near the back/right
    # wall, FRONT (X–Y) lower-right near the floor. The upper-right one is
    # nudged left of the lower-right one (not stacked directly on top) so it
    # visually reads as the farther-back face.
    LEFT_PROJ_X, LEFT_PROJ_W, LEFT_PROJ_H = 0.120, 0.170, 0.44
    ax_left = fig.add_axes([LEFT_PROJ_X, GRAPH_YC - LEFT_PROJ_H / 2,
                            LEFT_PROJ_W, LEFT_PROJ_H])

    CENTER_X0, CENTER_X1 = LEFT_PROJ_X + LEFT_PROJ_W + 0.02, 0.68
    ax_3d = fig.add_axes([CENTER_X0, GRAPH_Y0, CENTER_X1 - CENTER_X0,
                          GRAPH_Y1 - GRAPH_Y0], projection='3d')
    _style_3d_axes(ax_3d)
    ax_3d.view_init(elev=22, azim=-60)
    _curve_3d = _gradient_line3d(np.zeros(2), np.zeros(2), np.zeros(2))
    ax_3d.add_collection3d(_curve_3d)

    # Unobtrusive labels painted flat onto the cube's own faces — plain
    # billboard 3D text with a manual screen-space rotation (matplotlib's
    # zdir-based auto-orientation didn't read as flat-on-the-face), turned
    # to roughly match each pane's rendered slant at this fixed view_init
    # (elev=22, azim=-60): the floor is the z=-1.15 pane, the left wall is
    # x=-1.15, the right wall is y=+1.15.
    _face_label_kw = dict(color='#7a8fa8', fontsize=8, ha='center', va='center')
    # Rotations measured directly off this view_init's actual projection —
    # the angle, in display space, of each face's more-horizontal pair of
    # boundary edges (the pane border lines running above/below the label).
    ax_3d.text(0, 0, -1.32, 'X–Z', rotation=-13.7, **_face_label_kw)   # floor   ("top view" side)
    ax_3d.text(-1.32, 0, 0, 'Y–Z', rotation=30.5,  **_face_label_kw)   # left wall
    ax_3d.text(0, 1.32, 0, 'X–Y', rotation=-11.5,  **_face_label_kw)   # right wall ("front view" side)

    LOWER_X = 0.805
    UPPER_H = LOWER_H = 0.2825
    # _init_projection_ax below sets equal data aspect (xlim/ylim both
    # [-1.15, 1.15], a 1:1 box), and matplotlib enforces that by shrinking
    # each axes to a centered square, discarding the rest of its requested
    # width — independently per axes, around each one's own center. Two
    # panels placed edge-to-edge using the *requested* width therefore end
    # up with a gap between them (each contributes half its own shrink to
    # the gap) even though the math says they should touch. Requesting the
    # width the box will actually keep — computed from its height and the
    # figure's real aspect ratio — makes the shrink a no-op, so the panels
    # stay genuinely flush.
    fig_w_in, fig_h_in = fig.get_size_inches()
    RIGHT_PROJ_W = LOWER_H * (fig_h_in / fig_w_in)
    UPPER_X = LOWER_X - RIGHT_PROJ_W  # right edge flush with the lower panel's left edge
    ax_upper = fig.add_axes([UPPER_X, 0.950 - UPPER_H,
                             RIGHT_PROJ_W, UPPER_H])
    ax_lower = fig.add_axes([LOWER_X, GRAPH_Y0,
                             RIGHT_PROJ_W, LOWER_H])

    _lc_left  = _init_projection_ax(ax_left,  'SIDE   (Y–Z)')
    _lc_upper = _init_projection_ax(ax_upper, 'TOP   (X–Z)')
    _lc_lower = _init_projection_ax(ax_lower, 'FRONT   (X–Y)')

    ax_piano = fig.add_axes([0.010, PIANO_Y, 0.980, PIANO_H])
    _piano_arts = lc.init_piano_ax(ax_piano, piano_keys)

    # Preset row
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
    ax_anim_py = fig.add_axes([0.010, PHASE_Y, _ANIM_W, PHASE_H])
    ax_py      = fig.add_axes([0.130, PHASE_Y, 0.100,   PHASE_H])
    ax_pz      = fig.add_axes([0.790, PHASE_Y, 0.100,   PHASE_H])
    ax_anim_pz = fig.add_axes([0.935, PHASE_Y, _ANIM_W, PHASE_H])

    ax_aud_on   = fig.add_axes([0.310, AUDIO_Y, 0.05, AUDIO_H])
    ax_aud_sine = fig.add_axes([0.365, AUDIO_Y, 0.050, AUDIO_H])
    ax_aud_ep   = fig.add_axes([0.420, AUDIO_Y, 0.050, AUDIO_H])
    ax_aud_pno  = fig.add_axes([0.475, AUDIO_Y, 0.050, AUDIO_H])
    ax_vol      = fig.add_axes([0.545, AUDIO_Y, 0.100, AUDIO_H])

    n_temp  = len(lc.TEMP_NAMES)
    btn_w   = 0.98 / n_temp
    btn_axs = [fig.add_axes([0.01 + i * btn_w, TEMP_Y, btn_w * 0.97, TEMP_H])
               for i in range(n_temp)]

    ax_mode = fig.add_axes([0.900, 0.958, 0.090, 0.032])

    for ax in ([ax_py, ax_pz, ax_anim_py, ax_anim_pz,
                ax_aud_on, ax_aud_sine, ax_aud_ep, ax_aud_pno, ax_vol,
                ax_preset_name, ax_preset_save, ax_preset_prev, ax_preset_next,
                ax_preset_del, ax_preset_path, ax_preset_brow, ax_preset_exp,
                ax_preset_imp, ax_mode]
               + btn_axs):
        ax.set_facecolor(lc.BG)

    fig.text(0.50, PIANO_Y + PIANO_H + 0.003,
           'Click a key  ·  A–J = C–B (home oct)  ·  K,O,L,P = next oct  ·  '
           '[ ] shift octave  ·  1–3 / Tab select axis  ·  Space = sound on/off',
           ha='center', va='bottom', color='#7a8fa8', fontsize=7)

    sl_py = Slider(ax_py, 'φ Y ', 0, 2 * np.pi, valinit=state['phi_y'], color='#996633')
    sl_pz = Slider(ax_pz, 'φ Z ', 0, 2 * np.pi, valinit=state['phi_z'], color='#664499')
    for sl in (sl_py, sl_pz):
        sl.label.set_color(lc.WHITE)
        sl.valtext.set_color(lc.WHITE)

    btn_anim_py = Button(ax_anim_py, '▶', color=lc.BTN_OFF, hovercolor='#162840')
    btn_anim_pz = Button(ax_anim_pz, '▶', color=lc.BTN_OFF, hovercolor='#162840')
    for btn in (btn_anim_py, btn_anim_pz):
        btn.label.set_color(lc.WHITE)
        btn.label.set_fontsize(12)
    for ax in (ax_anim_py, ax_anim_pz):
        for sp in ax.spines.values():
            sp.set_edgecolor(lc.BTN_EDGE_OFF)
            sp.set_linewidth(0.5)

    btn_mode = Button(ax_mode, '2D View →', color=lc.BTN_OFF, hovercolor='#162840')
    btn_mode.label.set_fontsize(8)
    btn_mode.label.set_color(lc.WHITE)
    for sp in ax_mode.spines.values():
        sp.set_edgecolor(lc.ACCENT)
        sp.set_linewidth(1.0)

    _AUDIO_TONE_NAMES = [('sine', 'Sine'), ('epiano', 'E. Piano'), ('piano', 'Piano')]
    btn_aud_on   = Button(ax_aud_on,   '♪  off', color=lc.BTN_OFF, hovercolor='#162840')
    btn_aud_sine = Button(ax_aud_sine, 'Sine',    color=lc.BTN_OFF, hovercolor='#162840')
    btn_aud_ep   = Button(ax_aud_ep,   'E. Piano',color=lc.BTN_OFF, hovercolor='#162840')
    btn_aud_pno  = Button(ax_aud_pno,  'Piano',   color=lc.BTN_OFF, hovercolor='#162840')
    sl_vol = Slider(ax_vol, 'Vol', 0.0, 1.0, valinit=ctx['vol'], color='#2a5a3a')
    sl_vol.label.set_color(lc.WHITE)
    sl_vol.valtext.set_color(lc.WHITE)

    _aud_tone_axs  = [ax_aud_sine, ax_aud_ep, ax_aud_pno]
    _aud_tone_btns = [btn_aud_sine, btn_aud_ep, btn_aud_pno]

    def _style_aud_tone(active_key):
        for (key, _), ax, btn in zip(_AUDIO_TONE_NAMES, _aud_tone_axs, _aud_tone_btns):
            on = (key == active_key)
            ax.set_facecolor(lc.BTN_ON if on else lc.BTN_OFF)
            for sp in ax.spines.values():
                sp.set_edgecolor(lc.BTN_EDGE_ON if on else lc.BTN_EDGE_OFF)
                sp.set_linewidth(1.4 if on else 0.5)
            btn.label.set_color(lc.WHITE if on else '#778899')

    for ax in _aud_tone_axs:
        for sp in ax.spines.values():
            sp.set_edgecolor(lc.BTN_EDGE_OFF)
            sp.set_linewidth(0.5)
    for btn in _aud_tone_btns:
        btn.label.set_fontsize(8)
        btn.label.set_color('#778899')
    _style_aud_tone(ctx['tone'])

    def _style_audio_on_button(on):
        if on:
            ax_aud_on.set_facecolor(lc.ORANGE_BG_ON)
            for sp in ax_aud_on.spines.values():
                sp.set_edgecolor(lc.ORANGE)
                sp.set_linewidth(2.0)
            btn_aud_on.label.set_text('♪  on')
        else:
            ax_aud_on.set_facecolor(lc.BTN_OFF)
            for sp in ax_aud_on.spines.values():
                sp.set_edgecolor(lc.ORANGE_DIM)
                sp.set_linewidth(1.2)
            btn_aud_on.label.set_text('♪  off')
        btn_aud_on.label.set_color(lc.ORANGE)

    btn_aud_on.label.set_fontsize(8.5)
    btn_aud_on.label.set_fontweight('bold')
    _style_audio_on_button(_audio_engine._on)

    btns = []
    for i, name in enumerate(lc.TEMP_NAMES):
        btn = Button(btn_axs[i], name, color=lc.BTN_OFF, hovercolor='#162840')
        btn.label.set_fontsize(8.5)
        btns.append(btn)
    lc.style_temp_buttons(btn_axs, btns, lc.TEMP_NAMES.index(state['temp']))

    def _style_preset_button(ax, btn, edge=lc.ACCENT):
        ax.set_facecolor(lc.BTN_OFF)
        for sp in ax.spines.values():
            sp.set_edgecolor(edge)
            sp.set_linewidth(0.9)
        btn.label.set_fontsize(8)
        btn.label.set_color(lc.WHITE)

    def _style_textbox(ax):
        ax.set_facecolor('#0f1825')
        for sp in ax.spines.values():
            sp.set_edgecolor(lc.BTN_EDGE_OFF)
            sp.set_linewidth(0.8)

    name_box = TextBox(ax_preset_name, '', initial='', textalignment='left')
    btn_preset_save = Button(ax_preset_save, 'Save', color=lc.BTN_OFF, hovercolor='#162840')
    btn_preset_prev = Button(ax_preset_prev, '◀', color=lc.BTN_OFF, hovercolor='#162840')
    btn_preset_next = Button(ax_preset_next, '▶', color=lc.BTN_OFF, hovercolor='#162840')
    btn_preset_del  = Button(ax_preset_del,  'Delete', color=lc.BTN_OFF, hovercolor='#162840')
    path_box = TextBox(ax_preset_path, '',
                        initial=os.path.expanduser('~/lissajous_shared.json'),
                        textalignment='left')
    btn_preset_browse = Button(ax_preset_brow, 'Browse…', color=lc.BTN_OFF, hovercolor='#162840')
    btn_preset_export = Button(ax_preset_exp,  'Export ↑', color=lc.BTN_OFF, hovercolor='#162840')
    btn_preset_import = Button(ax_preset_imp,  'Import ↓', color=lc.BTN_OFF, hovercolor='#162840')

    for ax in (ax_preset_name, ax_preset_path):
        _style_textbox(ax)
    for tb in (name_box, path_box):
        tb.label.set_color(lc.WHITE)
        tb.text_disp.set_color(lc.WHITE)
        tb.text_disp.set_fontsize(8)
    for ax, btn in ((ax_preset_save, btn_preset_save), (ax_preset_prev, btn_preset_prev),
                    (ax_preset_next, btn_preset_next), (ax_preset_del, btn_preset_del),
                    (ax_preset_brow, btn_preset_browse), (ax_preset_exp, btn_preset_export),
                    (ax_preset_imp, btn_preset_import)):
        _style_preset_button(ax, btn)

    def _preset_label_text():
        mp = mode_presets()
        if not mp:
            return '(no saved presets)'
        p = mp[preset_idx[0]]
        return f'{preset_idx[0] + 1}/{len(mp)}   {p["name"]}'

    preset_label = fig.text(
        0.293, PRESET_Y + PRESET_H / 2, _preset_label_text(), ha='center', va='center',
        color='#7a8fa8', fontsize=8, fontweight='bold')

    # ── Draw helpers ──────────────────────────────────────────────────────────

    def redraw_slots():
        for i in range(3):
            lc.draw_slot(ax_slots[i], _slot_arts[i], state['notes'][i], state['octs'][i],
                         state['temp'], SLOT_COLS[i], state['active_slot'] == i, str(i + 1))

    def full_redraw():
        redraw_slots()
        lc.update_piano(_piano_arts, piano_keys, state, SLOT_COLS)
        freqs = [lc.note_freq(state['notes'][i], state['octs'][i], state['temp'])
                 for i in range(3)]
        x, y, z = lissajous_3(freqs, state['phi_y'], state['phi_z'])

        segs = np.stack([np.stack([x, y, z], axis=1)[:-1],
                          np.stack([x, y, z], axis=1)[1:]], axis=1)
        _curve_3d.set_segments(segs)
        _fill_projection(_lc_upper, x, z)
        _fill_projection(_lc_left,  y, z)
        _fill_projection(_lc_lower, x, y)

        f_x, f_y, f_z = freqs
        rxy, ixy = lc.describe_ratio(f_x, f_y)
        rxz, ixz = lc.describe_ratio(f_x, f_z)
        ryz, iyz = lc.describe_ratio(f_y, f_z)
        ax_lower.set_title(f'FRONT (X–Y)   [{rxy}{f" – {ixy}" if ixy else ""}]',
                           color='#7a8fa8', fontsize=8, pad=4)
        ax_upper.set_title(f'TOP (X–Z)   [{rxz}{f" – {ixz}" if ixz else ""}]',
                           color='#7a8fa8', fontsize=8, pad=4)
        ax_left.set_title(f'SIDE (Y–Z)   [{ryz}{f" – {iyz}" if iyz else ""}]',
                          color='#7a8fa8', fontsize=8, pad=4)

        fig.canvas.draw_idle()
        if _audio_engine._on:
            _audio_engine.set_freqs(freqs)

    # ── Preset callbacks ──────────────────────────────────────────────────────

    def _apply_preset(p):
        state['notes'] = list(p['notes'])
        state['octs']  = list(p['octaves'])
        phases = lc.preset_phases(p)
        state['phi_y'] = float(phases['phi_y'])
        state['phi_z'] = float(phases['phi_z'])
        state['temp']  = p['temperament']
        sl_py.set_val(state['phi_y'])
        sl_pz.set_val(state['phi_z'])
        temp_desc.set_text(lc.TEMP_DESCRIPTIONS[state['temp']])
        lc.style_temp_buttons(btn_axs, btns, lc.TEMP_NAMES.index(state['temp']))
        full_redraw()

    def _show_preset_status(msg):
        preset_label.set_text(msg)
        fig.canvas.draw_idle()

    def _goto_preset(step):
        mp = mode_presets()
        if not mp:
            return
        preset_idx[0] = (preset_idx[0] + step) % len(mp)
        _apply_preset(mp[preset_idx[0]])
        preset_label.set_text(_preset_label_text())
        fig.canvas.draw_idle()

    def _save_preset(_event):
        name = name_box.text.strip() or f'Preset {len(mode_presets()) + 1}'
        preset = lc.preset_from_state(state, name, '3d')

        image_ok = True
        image_err = None
        try:
            image_path, image_rel = lc.unique_image_path(name)
            render_curve_image(preset, image_path)
            preset['image'] = image_rel
        except Exception as e:
            image_ok, image_err = False, str(e)

        ctx['presets'].append(preset)
        preset_idx[0] = len(mode_presets()) - 1
        try:
            lc.write_presets(lc.PRESETS_FILE, ctx['presets'])
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
        mp = mode_presets()
        if not mp:
            return
        removed = mp[preset_idx[0]]
        ctx['presets'].remove(removed)
        preset_idx[0] = min(preset_idx[0], len(mode_presets()) - 1)
        image_rel = removed.get('image')
        if image_rel:
            try:
                os.remove(os.path.join(lc.PRESETS_DIR, image_rel))
            except OSError:
                pass
        try:
            lc.write_presets(lc.PRESETS_FILE, ctx['presets'])
        except OSError as e:
            _show_preset_status(f'Delete failed: {e}')
            return
        preset_label.set_text(_preset_label_text())
        fig.canvas.draw_idle()

    def _browse_for_path(save):
        if not lc.TK_OK:
            _show_preset_status('Browse unavailable — type a path instead')
            return
        root = lc.tkinter.Tk()
        root.withdraw()
        try:
            if save:
                path = lc._filedialog.asksaveasfilename(
                    defaultextension='.json',
                    filetypes=[('Lissajous presets', '*.json')],
                    initialfile='lissajous_shared.json')
            else:
                path = lc._filedialog.askopenfilename(
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
            lc.write_presets(path, ctx['presets'])
        except OSError as e:
            _show_preset_status(f'Export failed: {e}')
            return
        _show_preset_status(f'Exported {len(ctx["presets"])} preset(s) → {os.path.basename(path)}')

    def _import_presets(_event):
        path = path_box.text.strip()
        if not path:
            return
        try:
            incoming = lc.load_presets(path)
        except OSError as e:
            _show_preset_status(f'Import failed: {e}')
            return
        if not incoming:
            _show_preset_status('No presets found in that file')
            return
        existing_names = {p['name'] for p in ctx['presets']}
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
            new_p.pop('image', None)
            new_p.setdefault('mode', '2d')
            if new_p['mode'] == '3d':
                try:
                    image_path, image_rel = lc.unique_image_path(name)
                    render_curve_image(new_p, image_path)
                    new_p['image'] = image_rel
                except Exception:
                    pass
            ctx['presets'].append(new_p)
            existing_names.add(name)
            added += 1
        preset_idx[0] = len(mode_presets()) - 1
        try:
            lc.write_presets(lc.PRESETS_FILE, ctx['presets'])
        except OSError as e:
            _show_preset_status(f'Import saved in-memory only — {e}')
            return
        _show_preset_status(f'Imported {added} preset(s)')

    # ── Event callbacks ───────────────────────────────────────────────────────

    def on_click(event):
        if event.inaxes is None:
            return
        for i, ax in enumerate(ax_slots):
            if event.inaxes is ax:
                state['active_slot'] = i
                redraw_slots()
                fig.canvas.draw_idle()
                return
        if event.inaxes is ax_piano and event.xdata is not None:
            k = lc.find_key_at(piano_keys, event.xdata, event.ydata)
            if k:
                slot = state['active_slot']
                state['notes'][slot] = k['note']
                state['octs'][slot]  = k['octave']
                state['active_slot'] = (slot + 1) % 3
                full_redraw()

    def on_key(event):
        if name_box.capturekeystrokes or path_box.capturekeystrokes:
            return

        key = (event.key or '').lower()

        if key in ('1', '2', '3'):
            state['active_slot'] = int(key) - 1
            redraw_slots()
            fig.canvas.draw_idle()
            return

        if key == 'tab':
            state['active_slot'] = (state['active_slot'] + 1) % 3
            redraw_slots()
            fig.canvas.draw_idle()
            return

        if key == '[':
            state['base_octave'] = max(lc.PIANO_OCT_LOW, state['base_octave'] - 1)
            lc.update_piano(_piano_arts, piano_keys, state, SLOT_COLS)
            fig.canvas.draw_idle()
            return

        if key == ']':
            state['base_octave'] = min(lc.PIANO_OCT_HIGH - 1, state['base_octave'] + 1)
            lc.update_piano(_piano_arts, piano_keys, state, SLOT_COLS)
            fig.canvas.draw_idle()
            return

        if key == ' ':
            _toggle_audio(None)
            return

        if key in lc.KB_MAP:
            semi, oct_off = lc.KB_MAP[key]
            note   = lc.NOTE_NAMES[semi]
            octave = state['base_octave'] + oct_off
            octave = max(lc.PIANO_OCT_LOW, min(lc.PIANO_OCT_HIGH, octave))
            slot   = state['active_slot']
            state['notes'][slot] = note
            state['octs'][slot]  = octave
            state['active_slot'] = (slot + 1) % 3
            full_redraw()

    def make_temp_cb(i, name):
        def cb(_):
            state['temp'] = name
            ctx['temp'] = name
            temp_desc.set_text(lc.TEMP_DESCRIPTIONS[name])
            lc.style_temp_buttons(btn_axs, btns, i)
            full_redraw()
        return cb

    sl_py.on_changed(lambda v: state.update({'phi_y': v}) or full_redraw())
    sl_pz.on_changed(lambda v: state.update({'phi_z': v}) or full_redraw())

    for i, (btn, name) in enumerate(zip(btns, lc.TEMP_NAMES)):
        btn.on_clicked(make_temp_cb(i, name))

    def _make_anim_toggle(key, ax_btn, btn):
        def cb(_):
            state[key] = not state[key]
            on = state[key]
            ax_btn.set_facecolor(lc.BTN_ON if on else lc.BTN_OFF)
            for sp in ax_btn.spines.values():
                sp.set_edgecolor(lc.BTN_EDGE_ON if on else lc.BTN_EDGE_OFF)
                sp.set_linewidth(1.4 if on else 0.5)
            btn.label.set_text('■' if on else '▶')
            btn.label.set_color(lc.ACCENT if on else lc.WHITE)
            fig.canvas.draw_idle()
        return cb

    btn_anim_py.on_clicked(_make_anim_toggle('anim_phi_y', ax_anim_py, btn_anim_py))
    btn_anim_pz.on_clicked(_make_anim_toggle('anim_phi_z', ax_anim_pz, btn_anim_pz))

    def _toggle_audio(_):
        if not lc.SD_OK:
            return
        if _audio_engine._on:
            _audio_engine.disable()
        else:
            freqs = [lc.note_freq(state['notes'][i], state['octs'][i], state['temp'])
                     for i in range(3)]
            _audio_engine.enable(freqs)
        _style_audio_on_button(_audio_engine._on)
        fig.canvas.draw_idle()

    def _make_tone_cb(key):
        def cb(_):
            _audio_engine.set_tone(key)
            ctx['tone'] = key
            _style_aud_tone(key)
            fig.canvas.draw_idle()
        return cb

    btn_aud_on.on_clicked(_toggle_audio)
    for (key, _), btn in zip(_AUDIO_TONE_NAMES, _aud_tone_btns):
        btn.on_clicked(_make_tone_cb(key))

    def _on_vol_change(v):
        ctx['vol'] = v
        _audio_engine.set_volume(v)

    sl_vol.on_changed(_on_vol_change)

    btn_preset_save.on_clicked(_save_preset)
    btn_preset_prev.on_clicked(lambda _: _goto_preset(-1))
    btn_preset_next.on_clicked(lambda _: _goto_preset(1))
    btn_preset_del.on_clicked(_delete_preset)
    btn_preset_browse.on_clicked(_browse_path_cb)
    btn_preset_export.on_clicked(_export_presets)
    btn_preset_import.on_clicked(_import_presets)

    def _switch_to_2d(_event):
        import lissajous_keyboard as m2d
        lc.teardown_ui(fig, ctx)
        m2d.build_ui(fig, ctx)
        fig.canvas.draw_idle()

    btn_mode.on_clicked(_switch_to_2d)

    ctx['_cids'] = [
        fig.canvas.mpl_connect('button_press_event', on_click),
        fig.canvas.mpl_connect('key_press_event',    on_key),
    ]

    full_redraw()

    # ── MIDI input ────────────────────────────────────────────────────────────
    midi_status = fig.text(
        0.50, (PHASE_Y + PHASE_H + PIANO_Y) / 2, '',
        ha='center', va='center', color='#556677', fontsize=7, style='italic')

    if not lc.MIDO_OK:
        midi_status.set_text('MIDI unavailable  (pip install mido python-rtmidi)')
    elif ctx.get('midi_port'):
        midi_status.set_text(f'MIDI  ·  {ctx["midi_port"]}')
        midi_status.set_color(lc.ACCENT)
    else:
        midi_status.set_text('MIDI  ·  no device found')

    _ANIM_STEP = 0.05

    def _poll_midi():
        midi_changed = False
        q = ctx['midi_q']
        while not q.empty():
            midi_note = q.get_nowait()
            note   = lc.NOTE_NAMES[midi_note % 12]
            octave = (midi_note // 12) - 1
            slot   = state['active_slot']
            state['notes'][slot] = note
            state['octs'][slot]  = octave
            state['active_slot'] = (slot + 1) % 3
            midi_changed = True
        anim = False
        if state['anim_phi_y']:
            sl_py.set_val((state['phi_y'] + _ANIM_STEP) % (2 * np.pi))
            anim = True
        if state['anim_phi_z']:
            sl_pz.set_val((state['phi_z'] + _ANIM_STEP) % (2 * np.pi))
            anim = True
        if midi_changed and not anim:
            full_redraw()

    _midi_timer = fig.canvas.new_timer(interval=40)
    _midi_timer.add_callback(_poll_midi)
    _midi_timer.start()
    ctx['_timer'] = _midi_timer


if __name__ == '__main__':
    lc.run_app('3d')
