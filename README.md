# Lissajous Keyboard

An interactive Lissajous-curve visualizer driven by a piano keyboard — play
notes (via MIDI, your computer keyboard, or clicking the on-screen piano) and
watch their combined oscillations trace the curve in real time, with live
audio synthesis and six historical tuning systems.

Runs entirely in the browser — no install required. Open `index.html`
locally or use the published GitHub Pages link. Pure vanilla HTML/CSS/JS, no
build step, no dependencies. Uses:

- **Canvas 2D** for all curve/cube rendering
- **Web Audio API** for real-time additive synthesis (Sine / E. Piano / Piano)
- **Web MIDI API** for MIDI keyboard input (Chrome / Edge — Web MIDI isn't
  supported in Firefox or Safari)

## Modes

**2D** — a 4-note chord, two notes summed per axis:

```
x(t) = sin(r1·t)          +  sin(r2·t + φx)
y(t) = sin(r3·t + φxy)    +  sin(r4·t + φxy)
```

**3D** — a 3-note chord, one note per axis, rendered as a true 3D curve you
can drag to rotate, shown alongside its three 2D projections (top / front /
side).

Toggle between them with the button in the top-right corner. Piano,
temperament, audio, and presets are shared across both modes.

## Controls

- 2D: Click a key · A–J = C–B (home octave) · K,O,L,P = next octave ·
  `[` `]` shift octave · 1–4 / Tab select note slot · Space = sound on/off
- 3D: same, but 1–3 selects an axis and you can drag the cube to rotate it

## Presets

Save/browse/delete curves locally (stored in the browser via `localStorage`),
each with an embedded PNG snapshot. Export to a shareable `.json` file and
import one someone else sent you.

## Running locally

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

## Origin

Ported from [`lissajous_keyboard.py`](https://github.com/willmskinner/lissajous/tree/master),
a Python/matplotlib desktop app with the same core math. That branch still
exists but is no longer actively developed — this web version is the primary
project going forward.
