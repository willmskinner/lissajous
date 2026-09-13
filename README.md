# Lissajous Keyboard — Web Port

A browser port of the [`lissajous_keyboard.py`](https://github.com/willmskinner/lissajous-keyboard-interface/tree/master)
desktop app: a Lissajous-curve visualizer driven by a piano keyboard, with
live audio synthesis and Web MIDI input. No install required — open
`index.html` or the published GitHub Pages link.

Pure vanilla HTML/CSS/JS — no build step, no dependencies. Uses:

- **Canvas 2D** for the Lissajous curve rendering
- **Web Audio API** for real-time additive synthesis (Sine / E. Piano / Piano)
- **Web MIDI API** for MIDI keyboard input (Chrome / Edge — Web MIDI isn't
  supported in Firefox or Safari)

## Running locally

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

## Controls

Same as the desktop version — see the
[main README](https://github.com/willmskinner/lissajous-keyboard-interface/tree/master)
for the full control reference and tuning-system descriptions.

This branch (`gh-pages`) contains only the static site and is kept separate
from `master`, which holds the Python original.
