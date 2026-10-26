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
- **AudioWorklet + getUserMedia** for the live voice harmonizer

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

## Voice harmonizer

Sing or play into a mic and every active note on the keyboard becomes a
harmony voice, in the spirit of Jacob Collier's harmonizer and Bon Iver's
"Messina". Click **Voice off** to turn it on, then pick a character:

- **Natural**: re-pitched copies of your own voice. Sounds like a choir of
  you.
- **Messina**: your voice shapes a synth chord (a vocoder). This gives the
  robotic, hard-tuned Bon Iver sound. Hold the note you're singing as well
  if you want the lead line processed too. The menu next to it picks the
  synth tone: **Soft** (rounded and mellow), **Choir** (three slightly
  detuned saws per note) or **Saw** (the brightest and most robotic).

and a way of playing:

- **Momentary** mode: each held key (computer keyboard, MIDI, or on-screen
  piano) is one harmony voice, sounding only while held. This is the
  "play the chord, sing the line" way of using it.
- **Latch** mode: the slot chord sustains as harmony under whatever you sing.

Harmonies follow the selected temperament, so **Just** gives pure-interval
chords. Up to 8 voices.

How it works: `harmonizer-worklet.js` detects the input pitch (YIN).

- **Natural** re-spaces individual pitch periods of the real signal
  (TD-PSOLA) to land on each target note. Because it moves whole periods
  instead of resampling, the voice keeps its own vowel color and doesn't go
  chipmunk. Each voice is levelled to the input, since how loud a shifted
  copy comes out depends on how far it moves and where its harmonics land
  among the vowel's resonances.
- **Messina** splits the mic into 22 bands and imposes each band's loudness
  on the same band of a synth chord at the target notes. Consonants
  switch in a noise carrier, so they come through as a whisper. The input
  pitch only decides voiced vs. unvoiced, so this character tolerates
  breathy or off-pitch singing that Natural would warble on.

**Signal chain.** Send the dry voice to your monitors or PA through your
audio interface's direct monitoring or a mixer. Only the harmonies go
through the browser:

```
Mic ─► interface ─┬─► direct monitor / mixer ─► PA / headphones   (dry, no delay)
                  └─► browser ─► harmony voices ─► interface out ─► mixer
```

- **Use headphones.** A speaker near the mic will feed back.
- **Dry** also plays the unprocessed mic through the browser, for setups
  without direct monitoring. That copy is delayed slightly.
- **Low voice / High voice** sets the lowest pitch the detector listens for.
  Use High for tenor, alto, soprano and most instruments: it makes fewer
  octave mistakes.
- **Delay.** The readout next to the input pitch shows the estimated delay of
  the harmony voices.
  - Natural adds about 2.5–3 cycles of the input pitch (about 10 ms at
    220 Hz, about 27 ms at 110 Hz).
  - Messina adds about 7 ms, or about 10 ms for low voices.
  - On top of either, the browser's own audio I/O adds roughly 15–25 ms on a
    Mac.
  - Expect 20–50 ms in total.
- **Requirements.** The harmonizer needs the page served over https or
  localhost (GitHub Pages, or the local server below), because browsers block
  both mic access and worklet loading from `file://`. It uses only standard
  Web Audio, and has been tested in Chrome and Firefox.

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
