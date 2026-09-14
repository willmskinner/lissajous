"""
Lissajous Curve — Four Musical Notes  ·  Piano Keyboard Interface  ·  2D module

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

The "3D View" button in the top-right switches to the 3-note 3D module
(lissajous_keyboard_3d.py) without losing your audio/MIDI connection.
"""

import os
import numpy as np
from matplotlib.widgets import Slider, Button, TextBox

import lissajous_common as lc

# ─────────────────────────────────────────────────────────────────────────────
# Lissajous computation  (2D: two notes summed on each axis)
# ─────────────────────────────────────────────────────────────────────────────

_N_POINTS = 8000


def lissajous_4(freqs, phi_x, phi_xy, n=_N_POINTS):
    f_min = min(freqs)
    r  = [f / f_min for f in freqs]
    T  = lc.period(freqs)
    t  = np.linspace(0, 2 * np.pi * T, n)
    x  = np.sin(r[0] * t)           + np.sin(r[1] * t + phi_x)
    y  = np.sin(r[2] * t + phi_xy)  + np.sin(r[3] * t + phi_xy)
    xs, ys = np.abs(x).max(), np.abs(y).max()
    if xs > 1e-6: x /= xs
    else:         x[:] = 0.0
    if ys > 1e-6: y /= ys
    else:         y[:] = 0.0
    return x, y


def render_curve_image(preset, path, size_px=640, dpi=120):
    """Standalone PNG snapshot of a preset's curve — viewable in any image
    viewer, without opening this app."""
    freqs = [lc.note_freq(preset['notes'][i], preset['octaves'][i], preset['temperament'])
             for i in range(4)]
    phases = lc.preset_phases(preset)
    x, y = lissajous_4(freqs, phases['phi_x'], phases['phi_xy'])

    fig, ax = lc.new_offscreen_figure(size_px, dpi)
    ax.set_xlim(-1.15, 1.15)
    ax.set_ylim(-1.15, 1.15)
    ax.set_aspect('equal')
    ax.set_xticks([])
    ax.set_yticks([])
    for spine in ax.spines.values():
        spine.set_visible(False)
    ax.add_collection(lc.gradient_line_collection(x, y, linewidth=1.6))

    os.makedirs(os.path.dirname(path) or '.', exist_ok=True)
    fig.savefig(path, facecolor=lc.BG)

# ─────────────────────────────────────────────────────────────────────────────
# Curve drawing — persistent LineCollection (no ax.clear() on each frame)
# ─────────────────────────────────────────────────────────────────────────────

def _init_curve_ax(ax):
    """Set up ax_main once: static decorations + persistent LineCollection.
    Returns (lc_artist, segs_buf)."""
    ax.set_facecolor(lc.BG)
    for v in [-1, -0.5, 0, 0.5, 1]:
        ax.axhline(v, color=lc.DIM, lw=0.3, alpha=0.6)
        ax.axvline(v, color=lc.DIM, lw=0.3, alpha=0.6)
    ax.set_xlim(-1.15, 1.15)
    ax.set_ylim(-1.15, 1.15)
    ax.set_aspect('equal')
    ax.set_xticks([])
    ax.set_yticks([])
    for spine in ax.spines.values():
        spine.set_color(lc.DIM)
    ax.set_xlabel('', color=lc.X_COL, fontsize=9, labelpad=5)
    ax.set_ylabel('', color=lc.Y_COL, fontsize=9, labelpad=5, rotation=90)
    ax.set_title('', color=lc.WHITE, fontsize=10, pad=10)

    n_seg = _N_POINTS - 1
    segs_buf = np.empty((n_seg, 2, 2))
    lc_artist = lc.gradient_line_collection(np.zeros(_N_POINTS), np.zeros(_N_POINTS))
    ax.add_collection(lc_artist)
    return lc_artist, segs_buf


def _fill_curve(lc_artist, freqs, phi_x, phi_xy, segs_buf):
    """Update curve geometry only — no label recalculation.
    Called every animation frame; avoids all per-frame allocation."""
    x, y = lissajous_4(freqs, phi_x, phi_xy)
    xy   = np.stack([x, y], axis=1)   # (n, 2)
    segs_buf[:, 0, :] = xy[:-1]
    segs_buf[:, 1, :] = xy[1:]
    lc_artist.set_segments(segs_buf)


def _update_curve(lc_artist, ax, freqs, phi_x, phi_xy, labels, temperament, segs_buf):
    """Update curve geometry + axis labels. Called on note/temperament change."""
    _fill_curve(lc_artist, freqs, phi_x, phi_xy, segs_buf)
    f1, f2, f3, f4 = freqs
    rx, ix = lc.describe_ratio(f1, f2)
    ry, iy = lc.describe_ratio(f3, f4)
    ix_s = f' – {ix}' if ix else ''
    iy_s = f' – {iy}' if iy else ''
    ax.set_xlabel(
        f'{labels[0]} ({f1:.1f} Hz) + {labels[1]} ({f2:.1f} Hz)   [{rx}{ix_s}]',
        color=lc.X_COL, fontsize=9, labelpad=5)
    ax.set_ylabel(
        f'{labels[2]} ({f3:.1f} Hz) + {labels[3]} ({f4:.1f} Hz)   [{ry}{iy_s}]',
        color=lc.Y_COL, fontsize=9, labelpad=5, rotation=90)
    ax.set_title(f'{temperament}', color=lc.WHITE, fontsize=10, pad=10)

# ─────────────────────────────────────────────────────────────────────────────
# UI
# ─────────────────────────────────────────────────────────────────────────────

def build_ui(fig, ctx):
    """Draw the 2D mode into `fig` (assumed freshly cleared). `ctx` carries
    the resources that must survive a 2D/3D toggle: audio engine, MIDI
    queue, and the shared preset library."""
    ctx['mode'] = '2d'
    _audio_engine = ctx['audio_engine']

    state = {
        'notes':       ['A', 'E', 'D', 'A'],
        'octs':        [ 4,   5,   5,   5 ],
        'phi_x':       0.0,
        'phi_xy':      np.pi / 4,
        'temp':        ctx['temp'],
        'active_slot': 0,
        'base_octave': 4,   # 'A' computer key → C of this octave
        'anim_phi_x':  False,
        'anim_phi_xy': False,
    }

    mode_presets = lambda: lc.presets_for_mode(ctx['presets'], '2d')
    preset_idx = [len(mode_presets()) - 1]  # mutable box (int isn't); -1 if empty

    piano_keys = lc.build_piano_keys()

    fig.suptitle('4-note Lissajous Curve',
                 color=lc.WHITE, fontsize=13, fontweight='bold', y=0.997)

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
        0.50, TEMP_DESC_Y, lc.TEMP_DESCRIPTIONS[state['temp']],
        ha='center', va='top', color='#7a8fa8', fontsize=8, style='italic')

    ax_main  = fig.add_axes([MAIN_X,  MAIN_Y,  MAIN_W,  MAIN_H])
    _curve_lc, _segs_buf = _init_curve_ax(ax_main)

    ax_piano = fig.add_axes([0.010,   PIANO_Y, 0.980,   PIANO_H])
    _piano_arts = lc.init_piano_ax(ax_piano, piano_keys)

    # Note slot axes: 0=Note1(X), 1=Note2(X), 2=Note3(Y), 3=Note4(Y)
    ax_slots = [
        fig.add_axes([SLOT_X_L, SLOT_Y_TOP, SLOT_W, SLOT_H_TOP]),
        fig.add_axes([SLOT_X_L, SLOT_Y_BOT, SLOT_W, SLOT_H_BOT]),
        fig.add_axes([SLOT_X_R, SLOT_Y_TOP, SLOT_W, SLOT_H_TOP]),
        fig.add_axes([SLOT_X_R, SLOT_Y_BOT, SLOT_W, SLOT_H_BOT]),
    ]
    _slot_arts = [
        lc.init_slot_ax(ax_slots[i], f'Note {i + 1}',
                        'X  AXIS' if i < 2 else 'Y  AXIS',
                        lc.X_COL if i < 2 else lc.Y_COL)
        for i in range(4)
    ]

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

    n_temp  = len(lc.TEMP_NAMES)
    btn_w   = 0.98 / n_temp
    btn_axs = [fig.add_axes([0.01 + i * btn_w, TEMP_Y, btn_w * 0.97, TEMP_H])
               for i in range(n_temp)]

    # Mode toggle (top-right corner)
    ax_mode = fig.add_axes([0.900, 0.958, 0.090, 0.032])

    for ax in ([ax_px, ax_pxy, ax_anim_px, ax_anim_pxy,
                ax_aud_on, ax_aud_sine, ax_aud_ep, ax_aud_pno, ax_vol,
                ax_preset_name, ax_preset_save, ax_preset_prev, ax_preset_next,
                ax_preset_del, ax_preset_path, ax_preset_brow, ax_preset_exp,
                ax_preset_imp, ax_mode]
               + btn_axs):
        ax.set_facecolor(lc.BG)

    # Static labels
    fig.text(0.065, 0.943, 'X  AXIS', color=lc.X_COL,
             ha='center', fontsize=11, fontweight='bold')
    fig.text(0.860, 0.943, 'Y  AXIS', color=lc.Y_COL,
             ha='center', fontsize=11, fontweight='bold')
    fig.text(0.50, PIANO_Y + PIANO_H + 0.003,
           'Click a key  ·  A–J = C–B (home oct)  ·  K,O,L,P = next oct  ·  '
           '[ ] shift octave  ·  1–4 / Tab select slot  ·  Space = sound on/off',
           ha='center', va='bottom', color='#7a8fa8', fontsize=7)

    # Phase sliders
    sl_px  = lc.track_widget(ctx, Slider(ax_px,  'φ inner X ', 0, 2 * np.pi,
                    valinit=state['phi_x'],  color='#996633'))
    sl_pxy = lc.track_widget(ctx, Slider(ax_pxy, 'φ X vs Y ',  0, 2 * np.pi,
                    valinit=state['phi_xy'], color='#664499'))
    for sl in (sl_px, sl_pxy):
        sl.label.set_color(lc.WHITE)
        sl.valtext.set_color(lc.WHITE)

    # Animate buttons (one per slider, at the outer edges)
    btn_anim_px  = lc.track_widget(ctx, Button(ax_anim_px,  '▶', color=lc.BTN_OFF, hovercolor='#162840'))
    btn_anim_pxy = lc.track_widget(ctx, Button(ax_anim_pxy, '▶', color=lc.BTN_OFF, hovercolor='#162840'))
    for btn in (btn_anim_px, btn_anim_pxy):
        btn.label.set_color(lc.WHITE)
        btn.label.set_fontsize(12)
    for ax in (ax_anim_px, ax_anim_pxy):
        for sp in ax.spines.values():
            sp.set_edgecolor(lc.BTN_EDGE_OFF)
            sp.set_linewidth(0.5)

    # Mode toggle button
    btn_mode = lc.track_widget(ctx, Button(ax_mode, '3D View →', color=lc.BTN_OFF, hovercolor='#162840'))
    btn_mode.label.set_fontsize(8)
    btn_mode.label.set_color(lc.WHITE)
    for sp in ax_mode.spines.values():
        sp.set_edgecolor(lc.ACCENT)
        sp.set_linewidth(1.0)

    # Audio controls
    _AUDIO_TONE_NAMES = [('sine', 'Sine'), ('epiano', 'E. Piano'), ('piano', 'Piano')]
    btn_aud_on   = lc.track_widget(ctx, Button(ax_aud_on,   '♪  off', color=lc.BTN_OFF, hovercolor='#162840'))
    btn_aud_sine = lc.track_widget(ctx, Button(ax_aud_sine, 'Sine',    color=lc.BTN_OFF, hovercolor='#162840'))
    btn_aud_ep   = lc.track_widget(ctx, Button(ax_aud_ep,   'E. Piano',color=lc.BTN_OFF, hovercolor='#162840'))
    btn_aud_pno  = lc.track_widget(ctx, Button(ax_aud_pno,  'Piano',   color=lc.BTN_OFF, hovercolor='#162840'))
    sl_vol = lc.track_widget(ctx, Slider(ax_vol, 'Vol', 0.0, 1.0, valinit=ctx['vol'], color='#2a5a3a'))
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

    # Temperament buttons
    btns = []
    for i, name in enumerate(lc.TEMP_NAMES):
        btn = lc.track_widget(ctx, Button(btn_axs[i], name, color=lc.BTN_OFF, hovercolor='#162840'))
        btn.label.set_fontsize(8.5)
        btns.append(btn)
    lc.style_temp_buttons(btn_axs, btns, lc.TEMP_NAMES.index(state['temp']))

    # Preset controls
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

    name_box = lc.track_widget(ctx, TextBox(ax_preset_name, '', initial='', textalignment='left'))
    btn_preset_save = lc.track_widget(ctx, Button(ax_preset_save, 'Save', color=lc.BTN_OFF, hovercolor='#162840'))
    btn_preset_prev = lc.track_widget(ctx, Button(ax_preset_prev, '◀', color=lc.BTN_OFF, hovercolor='#162840'))
    btn_preset_next = lc.track_widget(ctx, Button(ax_preset_next, '▶', color=lc.BTN_OFF, hovercolor='#162840'))
    btn_preset_del  = lc.track_widget(ctx, Button(ax_preset_del,  'Delete', color=lc.BTN_OFF, hovercolor='#162840'))
    path_box = lc.track_widget(ctx, TextBox(ax_preset_path, '',
                        initial=os.path.expanduser('~/lissajous_shared.json'),
                        textalignment='left'))
    btn_preset_browse = lc.track_widget(ctx, Button(ax_preset_brow, 'Browse…', color=lc.BTN_OFF, hovercolor='#162840'))
    btn_preset_export = lc.track_widget(ctx, Button(ax_preset_exp,  'Export ↑', color=lc.BTN_OFF, hovercolor='#162840'))
    btn_preset_import = lc.track_widget(ctx, Button(ax_preset_imp,  'Import ↓', color=lc.BTN_OFF, hovercolor='#162840'))

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
        for i in range(4):
            lc.draw_slot(ax_slots[i], _slot_arts[i], state['notes'][i], state['octs'][i],
                         state['temp'], lc.NOTE_COLS[i], state['active_slot'] == i, str(i + 1))

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
        freqs = [lc.note_freq(state['notes'][i], state['octs'][i], state['temp'])
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
        lc.update_piano(_piano_arts, piano_keys, state, lc.NOTE_COLS)
        freqs  = [lc.note_freq(state['notes'][i], state['octs'][i], state['temp'])
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
        phases = lc.preset_phases(p)
        state['phi_x']  = float(phases['phi_x'])
        state['phi_xy'] = float(phases['phi_xy'])
        state['temp']   = p['temperament']
        sl_px.set_val(state['phi_x'])
        sl_pxy.set_val(state['phi_xy'])
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
        preset = lc.preset_from_state(state, name, '2d')

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
            new_p.pop('image', None)  # the image file itself isn't bundled in the export
            new_p.setdefault('mode', '2d')
            if new_p['mode'] == '2d':
                try:
                    image_path, image_rel = lc.unique_image_path(name)
                    render_curve_image(new_p, image_path)
                    new_p['image'] = image_rel
                except Exception:
                    pass  # metadata still imports fine without a local image
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
        # Click on a note slot → make it active
        for i, ax in enumerate(ax_slots):
            if event.inaxes is ax:
                state['active_slot'] = i
                redraw_slots()
                fig.canvas.draw_idle()
                return
        # Click on the piano → assign note to active slot
        if event.inaxes is ax_piano and event.xdata is not None:
            k = lc.find_key_at(piano_keys, event.xdata, event.ydata)
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
            state['base_octave'] = max(lc.PIANO_OCT_LOW, state['base_octave'] - 1)
            lc.update_piano(_piano_arts, piano_keys, state, lc.NOTE_COLS)
            fig.canvas.draw_idle()
            return

        if key == ']':
            state['base_octave'] = min(lc.PIANO_OCT_HIGH - 1, state['base_octave'] + 1)
            lc.update_piano(_piano_arts, piano_keys, state, lc.NOTE_COLS)
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
            state['active_slot'] = (slot + 1) % 4
            full_redraw()

    def make_temp_cb(i, name):
        def cb(_):
            state['temp'] = name
            ctx['temp'] = name
            temp_desc.set_text(lc.TEMP_DESCRIPTIONS[name])
            lc.style_temp_buttons(btn_axs, btns, i)
            full_redraw()
        return cb

    sl_px.on_changed( lambda v: state.update({'phi_x':  v}) or _refresh_anim())
    sl_pxy.on_changed(lambda v: state.update({'phi_xy': v}) or _refresh_anim())

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

    btn_anim_px.on_clicked(_make_anim_toggle('anim_phi_x',  ax_anim_px,  btn_anim_px))
    btn_anim_pxy.on_clicked(_make_anim_toggle('anim_phi_xy', ax_anim_pxy, btn_anim_pxy))

    # ── Audio callbacks ───────────────────────────────────────────────────────

    def _toggle_audio(_):
        if not lc.SD_OK:
            return
        if _audio_engine._on:
            _audio_engine.disable()
        else:
            freqs = [lc.note_freq(state['notes'][i], state['octs'][i], state['temp'])
                     for i in range(4)]
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

    def _switch_to_3d(_event):
        import lissajous_keyboard_3d as m3d
        lc.teardown_ui(fig, ctx)
        m3d.build_ui(fig, ctx)
        fig.canvas.draw_idle()

    btn_mode.on_clicked(_switch_to_3d)

    ctx['_cids'] = [
        fig.canvas.mpl_connect('button_press_event', on_click),
        fig.canvas.mpl_connect('key_press_event',    on_key),
        fig.canvas.mpl_connect('resize_event', lambda _e: (_blit.__setitem__(0, None),
                                                            _save_bg())),
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

    _ANIM_STEP = 0.05  # radians per 40 ms  ≈ 5 s per full 2π cycle

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
    ctx['_timer'] = _midi_timer


if __name__ == '__main__':
    lc.run_app('2d')
