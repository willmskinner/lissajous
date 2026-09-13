# Lissajous

An interactive Lissajous-curve visualizer driven by a piano keyboard — play
four notes (via MIDI or the computer keyboard) and watch their combined
oscillations trace the curve in real time, with live audio synthesis and six
historical tuning systems.

```
x(t) = sin(r1·t)  +  sin(r2·t + φx)
y(t) = sin(r3·t + φxy)  +  sin(r4·t + φxy)
```

## Requirements

- Python 3.9+
- numpy >= 2.0
- matplotlib >= 3.7
- mido >= 1.3 *(optional — enables MIDI keyboard input)*
- python-rtmidi *(optional — MIDI backend for mido)*
- sounddevice >= 0.4 *(optional — enables real-time audio synthesis)*

## Installation

```bash
pip install -r requirements.txt
```

## Usage

```bash
python lissajous_keyboard.py
```

## Controls

Select the four active notes either by clicking the on-screen piano keyboard
or with computer-keyboard shortcuts (standard DAW virtual-piano layout — key
labels appear on the piano keys). If a MIDI input device is connected, notes
played on it fill the four slots automatically, cycling slot-by-slot.

| Key(s) | What it does |
|--------|-------------|
| `1` `2` `3` `4` | Select active note slot |
| `Tab` | Cycle active slot |
| `[` / `]` | Shift the home octave down / up |
| `A`–`J` | C D E F G A B (home octave) |
| `W` `E` `T` `Y` `U` | C# D# F# G# A# (home octave) |
| `K` `L` | C D (+1 octave) |
| `O` `P` | C# D# (+1 octave) |

Additional on-screen controls:

| Control | What it does |
|---------|-------------|
| **φ inner X** | Phase offset between Note 1 and Note 2 — sweep to morph between constructive and destructive interference |
| **φ X vs Y** | Overall phase of the X axis relative to Y — the classic Lissajous phase that rotates the figure, with an animate toggle |
| **Temperament buttons** | Switch tuning system (see below) |
| **Audio on/off + tone buttons** | Enable real-time audio synthesis (Sine / E. Piano / Piano) with a volume slider |

## Tuning Systems

| System | Description |
|--------|-------------|
| **Equal (12-TET)** | Every semitone = 2^(1/12). Universal modern standard — every key sounds identical. |
| **Just (5-limit)** | Pure integer ratios (5/4, 3/2, …). Perfectly consonant in one key; beating in others. |
| **Pythagorean** | Stacked pure perfect 5ths (3/2). Brilliant 5ths; major 3rds are noticeably wide (81/64). |
| **¼-Comma Meantone** | Fifths narrowed so four of them equal an exact 5/4. Sweet major 3rds; wolf 5th on G#–Eb. |
| **Well temperament (1691)** | Werckmeister III. All 12 keys usable; home keys sound purer and warmer. |
| **Well temperament (c. 1779)** | Kirnberger III. C–E exactly 5/4; gentle gradation toward sharper keys. |

All systems are anchored to A4 = 440 Hz.
