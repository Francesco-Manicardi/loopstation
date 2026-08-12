# RC-505mkII Web

A browser emulation of the **BOSS RC-505mkII Loop Station** — the panel, the
128×64 LCD, the five-track looper, the rhythm machine and the input/track effect
banks, all running on the Web Audio API. It is playable entirely with the mouse
or entirely from the keyboard.

The behaviour, parameter names, value ranges and menu structure follow the
official BOSS *RC-505mkII Owner's Manual* and *Parameter Guide*; the text
extracts used while building it are kept in [`docs/`](docs) for reference.

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # tsc --noEmit && vite build  → dist/
npm run preview    # serve the production build
```

Open the page and click **POWER ON** (a user gesture is required before a
browser will start an `AudioContext`). **POWER ON + MICROPHONE** does the same
and asks for microphone access so you can actually record; without it the input
is silent but everything else — rhythm, effects, memories — still works.
A recent Chromium- or Firefox-based browser is required (`AudioWorklet`,
`MediaStreamAudioSourceNode`, IndexedDB).

Press **`/`** at any time for the shortcut list.

## What is emulated

### Looper

* **5 stereo tracks**, each with its own `[TRACK]`, `[FX]`, `[■]`, `[▶/●]`
  buttons and level slider, exactly as on the panel.
* Record → overdub → play cycling on `[▶/●]`, with the manual's
  **REC ACTION** (`REC→DUB` / `REC→PLAY`), **PLAY MODE** (`MULTI` / `SINGLE`),
  **START MODE** (`IMMEDIATE` / `FADE IN`), **STOP MODE**
  (`IMMEDIATE` / `FADE OUT` / `LOOP END`), **1SHOT**, **REVERSE**,
  **OVERDUB MODE** (`OVERDUB` / `REPLACE`), **LOOP FX**, **PAN**,
  **PLAY LEVEL**, **MEASURE**, **LOOP SYNC**, **TEMPO SYNC**.
* **LOOP LENGTH** (`AUTO` / `FREE` / `MEASURE`), **QUANTIZE = MEASURE** and
  **LOOP SYNC**: a new track started while another is playing is quantised to
  the measure and its loop length is snapped to a whole number of measures of
  the master loop.
* **TEMPO SYNC** with the two hardware algorithms: `PITCH` (resampling — speed
  and pitch move together) and `XFADE` (two-grain overlap-add — tempo changes
  without transposing).
* Tempo detection from the first recorded loop, folded into the musical
  80–160 BPM band the way the hardware does, so a two-bar phrase does not come
  back as 270 BPM.
* **UNDO / REDO** per track, plus **MARK SET / MARK BACK / MARK CLEAR**
  (the `[UNDO/REDO]` hold-mode remap of `[FX]`, `[TRACK]`, `[■]`, `[▶/●]`
  described under *Top Panel* in the manual).
* `[ALL START/STOP]`, **QUICK CLEAR** (double-tap `[■]`) and **ALL CLEAR**
  (hold `[ALL START/STOP]`), both switchable in `MENU → SETUP`.
* Loop position rings, level meters and beat indicators on the panel LEDs and
  in the LCD, driven by the same transport clock as the audio.

### Rhythm

* 21 genres / 274 patterns / 16 kits, with `VARIATION A–D`, `VARIATION CHANGE`
  (`MEASURE` / `LOOP END`), `INTRO`, `ENDING`, `FILL IN`, `REC COUNT`,
  `PLAY COUNT`, `STOP MODE`, `BEAT` (2/4 … 7/4 and 5/8 … 15/8),
  `RHYTHM LEVEL`.
* The kits are synthesised at load time (no sample downloads); patterns are
  generated per genre/variation and scheduled one measure ahead so a
  variation, fill or ending always lands on a musical boundary.
* `TAP TEMPO` (average of up to five taps, 40–300 BPM) and the tempo LED /
  beat flash.

### Effects

* **INPUT FX** and **TRACK FX**, four banks (A–D) × four slots (A–D) each,
  `SINGLE` / `MULTI` bank mode, `TOGGLE` / `MOMENT` switching, per-slot
  `INSERT` routing and the `[EDIT]`-hold bank select.
* All **55 FX types** of the RC-505mkII are present with real DSP, not
  placeholders: filters (LPF/BPF/HPF/ISOLATOR/EQ), modulation
  (PHASER/FLANGER/CHORUS/VIBRATO/TREMOLO/AUTO PAN/MANUAL PAN/STEREO ENHANCE),
  dynamics (DYNAMICS/SUSTAINER/SLOW GEAR/PREAMP/DIST), delays and reverbs
  (DELAY/PANNING/MOD/REVERSE/TAPE ECHO 1+2/GRANULAR, REVERB/GATE/REVERSE),
  pitch (OCTAVE/TRANSPOSE/PITCH BEND/G2B/ROBOT/ELECTRIC/HRM MANUAL/HRM AUTO),
  synthesis (SYNTH/AUTO RIFF/VOCODER/OSC VOC/OSC BOT/RING MOD),
  lo-fi (LO-FI/RADIO/VINYL FLICK) and the beat effects
  (PATTERN + STEP SLICER, ROLL 1/2, BEAT REPEAT/SCATTER/SHIFT, FREEZE, WARP,
  TWIST).
* **FX SEQUENCE** per slot: `SEQ SW`, `SEQ SYNC`, `SEQ RETRIG`, `SEQ TARGET`,
  `SEQ RATE`, `SEQ MAX` and 16 steps, stepping in sync with the loop tempo.
* Beat-synchronised effects follow the current tempo and time signature
  (`♬`, `♩`, `1MEAS`, … rates).

### Memories, mixer, system

* **99 memories**, each holding the five tracks' settings, rhythm, both FX
  sections and the mixer; `[EXIT]`+`[ENTER]` writes, `MEMORY CLEAR` erases,
  and the name editor is the hardware's 12-character one.
* Memories and system settings are stored in `localStorage`; **recorded audio
  is stored in IndexedDB**, so a written memory still has its phrases after a
  reload.
* `[ENTER]` on the play screen opens the **MIXER**: input levels
  (MIC 1/2, INST 1/2), output levels, and LOOP / RHYTHM / MASTER, with 0–200
  ranges and mute, laid out over the four `[1]`–`[4]` knobs.
* `MENU` tree: `INPUT` (stereo link and, per input — MIC 1/2, INST 1/2,
  USB IN — gain, level, mute, phantom, 3-band EQ, compressor, noise gate and
  reverb send), `OUTPUT` (output levels, `MASTER FX`, `PHONES MIX`),
  `CTL FUNC`, `USB`, `MIDI`, `SETUP`, `FACTORY RESET`.
* All **7 play-screen variations** of the hardware (loop rings, five bars, big
  tempo with beat boxes, level meters, FX overview, rhythm detail, memory) on
  `[◀] [▶]`.

## Keyboard shortcuts

Keys are matched on physical key position (`KeyboardEvent.code`), so a non-US
layout works unchanged. Buttons are press/release, so holding a key behaves
like holding the button (MOMENT-mode FX, long-press clear, `[EDIT]` hold).

| Keys | Action |
| --- | --- |
| `1` … `5` | Track `[▶/●]` — record / overdub / play |
| `Shift`+`1` … `5` | Track `[■]` — stop (hold 2 s to clear the track) |
| `Ctrl`+`1` … `5` | Clear track |
| `Q` `W` `E` `R` `T` | Track `[TRACK]` — select the track / open its settings |
| `A` `S` `D` `F` `G` | Track `[FX]` — track FX on/off for that track |
| `PgUp` / `PgDn` | Current track's level slider |
| `Space` | `[ALL START/STOP]` (hold for ALL CLEAR) |
| `U` | `[UNDO/REDO]` (hold: MARK mode on `[FX]`/`[TRACK]`/`[■]`/`[▶/●]`) |
| `Z` | Undo / redo the current track |
| `B` / `N` / `V` | MARK SET / MARK BACK / MARK CLEAR |
| `H` | `RHYTHM [START/STOP]` |
| `J` | `RHYTHM [EDIT]` |
| `Y` | `[TAP TEMPO]` (hold: back to the previous tempo) |
| `X` | Rhythm fill-in |
| `C` | Next rhythm variation |
| `6` `7` `8` `9` | `INPUT FX [A]`–`[D]` |
| `Shift`+`6` … `9` | INPUT FX bank A–D |
| `F1` … `F4` | `TRACK FX [A]`–`[D]` |
| `Shift`+`F1` … `F4` | TRACK FX bank A–D |
| `I` / `O` | INPUT FX `[EDIT]` / TRACK FX `[EDIT]` (hold: bank select) |
| `-` / `=` | `[INPUT FX]` knob |
| `[` / `]` | `[TRACK FX]` knob |
| `M` | `[MENU]` |
| `Shift`+`M` | Enable / disable the microphone input |
| `L` | `[LOOP]` |
| `Enter` | `[ENTER]` (on the play screen: MIXER) |
| `Esc` / `Backspace` | `[EXIT]` |
| `←` / `→` | `[◀] [▶]` — page, cursor, play-screen variation |
| `Shift`+`←` / `→` | Previous / next memory |
| `↑` / `↓` | Turn the focused `[1]`–`[4]` knob (`Shift` = coarse) |
| `Tab` / `Shift`+`Tab` | Focus the next / previous `[1]`–`[4]` knob |
| `P` | Push the focused knob (toggles ON/OFF values) |
| `,` / `.` | `[OUTPUT LEVEL]` knob |
| `Ctrl`+`S` | WRITE / CLEAR memory (`[EXIT]`+`[ENTER]`) |
| `/` | Show / hide the shortcut list |

Everything above is also reachable with the mouse: every button, knob and
slider on the panel is a real control (knobs and sliders drag vertically and
respond to the scroll wheel).

## Architecture

```
src/
  main.ts                  bootstrap, power-on gate, help overlay
  app.ts                   the "firmware": buttons, holds, menus, LEDs, memories
  types.ts                 memory / system / status data model
  state/                   defaults (factory settings), store, persistence
  audio/
    engine.ts              node graph, tracks, routing, worklet plumbing
    worklets/
      looper-processor.js   5-track recorder/player + transport clock
      fx-processor.js       pitch-shift, beat, lo-fi, vocoder, synth … processors
    fx-chain.ts            one FX unit per type, built from the parameter tree
    rhythm.ts              measure-ahead pattern scheduler
    drum-kit.ts            synthesised drum kits
  data/                    FX list, rhythm genres/patterns
  ui/
    panel.ts               DOM replica of the top panel
    lcd/                   1-bit framebuffer + 5×7 font
    screens.ts             every LCD screen
    params.ts              declarative parameter tree ([1]–[4] knob pages)
    keyboard.ts            key bindings
  styles/                  reset / panel / overlay CSS
```

The looper is a single `AudioWorkletProcessor` with six inputs (one recording
source per track plus the bounce bus) and five stereo outputs, so all five
tracks share one sample-accurate clock — the same reason the hardware can keep
loops phase-locked. Everything the UI shows (positions, meters, beats, undo
availability) comes from that processor's status messages.

The panel is plain DOM on a fixed 1240×690 surface scaled with a CSS
`transform`, so it stays pixel-proportional at any window size; the LCD is a
`<canvas>` drawn from a 1-bit framebuffer with nearest-neighbour scaling, which
is what gives it the hard pixel edges of the real negative display.

## Known differences from the hardware

Faithful where it can be, honest where it cannot:

* **INPUT FX insert point.** The hardware inserts input effects per input jack;
  here they sit on the summed input with the manual's `INSERT` options, so
  per-input assignment is modelled as "any enabled input" plus a rhythm gate.
* **PHONES OUT is not in the MIXER.** A browser has no separate headphone bus,
  so `LOOP` / `RHYTHM` / `MASTER OUT` are implemented and the phones output
  page is informational only.
* **MIDI-driven FX.** `HRM AUTO (M)` and `OSC VOC (M)` take their pitch from
  MIDI notes on the hardware; here they follow the detected input pitch.
  `FORMANT` on the pitch units is not implemented.
* **No external I/O.** USB audio, MIDI in/out and the `CTL` / `EXP` pedal jacks
  are present as settings pages but do nothing; there is no Web MIDI bridge yet.
* **Rhythm content is generated, not sampled.** The genres, pattern names, kit
  names and beat signatures match the Parameter Guide, but the audio is
  synthesised, so the grooves are stylistically right rather than
  bit-identical to BOSS's recordings.
* **Latency** is whatever the browser's audio stack gives (typically
  ~10–30 ms); the hardware is far below that.

## Licence / trademarks

BOSS and RC-505mkII are trademarks of Roland Corporation. This is an
independent, educational re-implementation; no Roland code or audio content is
included.
