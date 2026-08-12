/**
 * Input FX / Track FX list — transcribed from the RC-505mkII Parameter Guide
 * (Ver. 1.3, pages 34–43, "Input FX/Track FX List").
 *
 * `knob: true`   → parameter carries the ⟳ symbol in the guide, i.e. it can be
 *                  controlled live by the [INPUT FX] / [TRACK FX] knob.
 * `seqTarget`    → parameter carries the ☆ symbol, i.e. it can be a TARGET of
 *                  the FX SEQUENCE step sequencer.
 * `trackOnly`    → the four types available only as Track FX.
 *
 * BOSS's spec sheet quotes "49 Input FX / 53 Track FX"; the printed list groups
 * `TAPE ECHO1, 2` and `ROLL1, 2` on a single line each. Here they are separate
 * selectable types, which yields 51 shared types + 4 track-only = 55.
 */

export type FxParamKind = 'num' | 'enum' | 'rate';

export interface FxParam {
  id: string;
  /** Label as printed on the LCD (upper-case, ≤ 11 chars). */
  label: string;
  kind: FxParamKind;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  values?: string[];
  def: number | string;
  knob?: boolean;
  seqTarget?: boolean;
}

export interface FxType {
  name: string;
  /** 1–2 lines of ≤ 3–4 chars, as the hardware abbreviates FX names on the play screen. */
  abbr: string[];
  desc: string;
  params: FxParam[];
  /** Implementation key used by the audio engine. */
  dsp: string;
  trackOnly?: boolean;
  /** Supports the FX SEQUENCE function (⌚ mark in the guide). */
  seq?: boolean;
}

/** The shared "RATE" value list: musical divisions then 0–100. */
export const RATE_VALUES: string[] = [
  '4MEAS',
  '2MEAS',
  '1MEAS',
  '♩.', // dotted quarter
  '♩', // quarter
  '♪3', // eighth triplet
  '♪', // eighth
  '♬', // sixteenth
  ...Array.from({ length: 101 }, (_, i) => String(i)),
];

const num = (
  id: string,
  label: string,
  min: number,
  max: number,
  def: number,
  extra: Partial<FxParam> = {},
): FxParam => ({ id, label, kind: 'num', min, max, def, step: 1, ...extra });

const en = (id: string, label: string, values: string[], def: string, extra: Partial<FxParam> = {}): FxParam => ({
  id,
  label,
  kind: 'enum',
  values,
  def,
  ...extra,
});

const rate = (id = 'rate', label = 'RATE', def = '1MEAS', extra: Partial<FxParam> = {}): FxParam => ({
  id,
  label,
  kind: 'rate',
  values: RATE_VALUES,
  def,
  ...extra,
});

const onOff = (id: string, label: string, def: 'OFF' | 'ON' = 'OFF'): FxParam =>
  en(id, label, ['OFF', 'ON'], def);

const stepRate = (): FxParam => ({
  id: 'stepRate',
  label: 'STEP RATE',
  kind: 'rate',
  values: ['OFF', ...RATE_VALUES],
  def: 'OFF',
});

const KEYS = [
  'C (Am)',
  'Db(Bbm)',
  'D (Bm)',
  'Eb(Cm)',
  'E (C#m)',
  'F (Dm)',
  'F#(D#m)',
  'G (Em)',
  'Ab(Fm)',
  'A (F#m)',
  'Bb(Gm)',
  'B (G#m)',
];

const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

const MODE12 = en('mode', 'MODE', ['1', '2'], '2');

const filterParams = (): FxParam[] => [
  rate('rate', 'RATE', '1MEAS'),
  num('depth', 'DEPTH', 0, 100, 50, { knob: true, seqTarget: true }),
  num('resonance', 'RESONANCE', 0, 100, 50),
  num('cutoff', 'CUTOFF', 0, 100, 50, { knob: true, seqTarget: true }),
  stepRate(),
];

const modParams = (extra: FxParam[]): FxParam[] => [
  rate('rate', 'RATE', '1MEAS'),
  num('depth', 'DEPTH', 0, 100, 50, { knob: true, seqTarget: true }),
  num('resonance', 'RESONANCE', 0, 100, 50, { knob: true, seqTarget: true }),
  num('manual', 'MANUAL', 0, 100, 50, { knob: true, seqTarget: true }),
  stepRate(),
  num('dLevel', 'D.LEVEL', 0, 100, 100, { knob: true, seqTarget: true }),
  num('eLevel', 'E.LEVEL', 0, 100, 50, { knob: true, seqTarget: true }),
  ...extra,
];

const delayParams = (defTime = 500): FxParam[] => [
  num('time', 'TIME', 1, 2000, defTime, { unit: 'ms', knob: true, seqTarget: true }),
  num('feedback', 'FEEDBACK', 0, 100, 50, { knob: true, seqTarget: true }),
  num('dLevel', 'D.LEVEL', 0, 100, 100),
  num('eLevel', 'E.LEVEL', 0, 100, 50, { knob: true, seqTarget: true }),
  num('lowCut', 'LOW CUT', 0, 16, 0),
  num('highCut', 'HIGH CUT', 0, 16, 12),
];

const reverbParams = (): FxParam[] => [
  num('time', 'TIME', 1, 100, 40, { knob: true, seqTarget: true }),
  num('preDelay', 'PRE DELAY', 0, 200, 0, { unit: 'ms' }),
  num('density', 'DENSITY', 0, 10, 5),
  num('dLevel', 'D.LEVEL', 0, 100, 100),
  num('eLevel', 'E.LEVEL', 0, 100, 50, { knob: true, seqTarget: true }),
  num('lowCut', 'LOW CUT', 0, 16, 0),
  num('highCut', 'HIGH CUT', 0, 16, 14),
];

/** All FX types available for both Input FX and Track FX, then the four track-only types. */
export const FX_TYPES: FxType[] = [
  {
    name: 'LPF',
    abbr: ['LPF'],
    desc: 'Low pass filter. Reduces the volume of all frequencies above the cutoff.',
    dsp: 'lpf',
    seq: true,
    params: filterParams(),
  },
  {
    name: 'BPF',
    abbr: ['BPF'],
    desc: 'Band pass filter. Leaves only frequencies around the cutoff.',
    dsp: 'bpf',
    seq: true,
    params: filterParams(),
  },
  {
    name: 'HPF',
    abbr: ['HPF'],
    desc: 'High pass filter. Cuts the frequencies below the cutoff.',
    dsp: 'hpf',
    seq: true,
    params: filterParams(),
  },
  {
    name: 'PHASER',
    abbr: ['PHA', 'SER'],
    desc: 'Gives the sound a swishing quality by adding a phase-shifted sound.',
    dsp: 'phaser',
    seq: true,
    params: modParams([en('stage', 'STAGE', ['4', '8', '12', 'BI-PHASE'], '4')]),
  },
  {
    name: 'FLANGER',
    abbr: ['FLN', 'GER'],
    desc: 'Produces a metallic resonance reminiscent of a jet plane.',
    dsp: 'flanger',
    seq: true,
    params: modParams([num('separation', 'SEPARATION', 0, 100, 100, { knob: true, seqTarget: true })]),
  },
  {
    name: 'SYNTH',
    abbr: ['SYN', 'TH'],
    desc: 'Generates a synthesizer sound.',
    dsp: 'synth',
    params: [
      num('frequency', 'FREQUENCY', 0, 100, 50, { knob: true, seqTarget: true }),
      num('resonance', 'RESONANCE', 0, 100, 50, { knob: true, seqTarget: true }),
      num('decay', 'DECAY', 0, 100, 50, { knob: true, seqTarget: true }),
      num('balance', 'BALANCE', 0, 100, 50, { knob: true }),
    ],
  },
  {
    name: 'LO-FI',
    abbr: ['LO', 'FI'],
    desc: 'Intentionally degrades the sound to create a distinctive character.',
    dsp: 'lofi',
    params: [
      en('bitDepth', 'BITDEPTH', ['OFF', '31', '24', '20', '16', '12', '10', '8', '6', '4', '2', '1'], '8'),
      en('sampleRate', 'SAMPLERATE', ['OFF', '1/2', '1/4', '1/8', '1/16', '1/32'], '1/4'),
      num('balance', 'BALANCE', 0, 100, 50, { knob: true }),
    ],
  },
  {
    name: 'RADIO',
    abbr: ['RA', 'DIO'],
    desc: 'Produces a radio voice.',
    dsp: 'radio',
    params: [
      num('lofi', 'LO-FI', 1, 10, 5, { knob: true }),
      num('level', 'LEVEL', 0, 100, 50, { knob: true }),
    ],
  },
  {
    name: 'RING.MOD',
    abbr: ['RNG', 'MOD'],
    desc: 'Gives a metallic character; the sound seems to go out of focus.',
    dsp: 'ringmod',
    params: [
      num('frequency', 'FREQUENCY', 0, 100, 50, { knob: true, seqTarget: true }),
      num('balance', 'BALANCE', 0, 100, 50, { knob: true }),
      MODE12,
    ],
  },
  {
    name: 'G2B',
    abbr: ['G2B'],
    desc: 'Transforms a guitar sound into a bass sound.',
    dsp: 'g2b',
    params: [num('balance', 'BALANCE', 0, 100, 50, { knob: true }), MODE12],
  },
  {
    name: 'SUSTAINER',
    abbr: ['SUS', 'TNR'],
    desc: 'Evens out the level, giving a long sustain without distortion.',
    dsp: 'sustainer',
    params: [
      num('attack', 'ATTACK', 0, 100, 50),
      num('release', 'RELEASE', 0, 100, 50),
      num('level', 'LEVEL', 0, 100, 50, { knob: true }),
      num('lowGain', 'LOW GAIN', -20, 20, 0, { unit: 'dB' }),
      num('hiGain', 'HI GAIN', -20, 20, 0, { unit: 'dB' }),
      num('sustain', 'SUSTAIN', 0, 100, 50, { knob: true }),
    ],
  },
  {
    name: 'AUTO RIFF',
    abbr: ['ATO', 'RIF'],
    desc: 'Automatically creates phrases based on the input sound.',
    dsp: 'autoriff',
    params: [
      num('phrase', 'PHRASE', 1, 30, 1),
      rate('tempo', 'TEMPO', '1MEAS'),
      onOff('hold', 'HOLD'),
      num('attack', 'ATTACK', 0, 100, 50),
      onOff('loop', 'LOOP', 'ON'),
      en('key', 'KEY', KEYS, 'C (Am)'),
      num('balance', 'BALANCE', 0, 100, 50, { knob: true }),
    ],
  },
  {
    name: 'SLOW GEAR',
    abbr: ['SLW', 'GER'],
    desc: 'Produces a volume-swell effect ("violin-like" sound).',
    dsp: 'slowgear',
    params: [
      num('sens', 'SENS', 0, 100, 50),
      num('riseTime', 'RISE TIME', 0, 100, 50, { knob: true }),
      num('level', 'LEVEL', 0, 100, 50),
      MODE12,
    ],
  },
  {
    name: 'TRANSPOSE',
    abbr: ['TRN', 'SPS'],
    desc: 'Transposes the sound when you turn the FX on.',
    dsp: 'transpose',
    params: [num('trans', 'TRANS', -12, 12, 0, { knob: true, seqTarget: true }), MODE12],
  },
  {
    name: 'PITCH BEND',
    abbr: ['PCH', 'BND'],
    desc: 'Creates a pitch bend effect.',
    dsp: 'pitchbend',
    params: [
      en('pitch', 'PITCH', ['-3OCT', '-2OCT', '-1OCT', '+1OCT', '+2OCT', '+3OCT', '+4OCT'], '+1OCT'),
      num('bend', 'BEND', 0, 100, 50, { knob: true, seqTarget: true }),
      MODE12,
    ],
  },
  {
    name: 'ROBOT',
    abbr: ['RO', 'BOT'],
    desc: 'Cyber-robot voice.',
    dsp: 'robot',
    params: [
      en('note', 'NOTE', NOTES, 'C'),
      num('formant', 'FORMANT', -50, 50, 0, { knob: true }),
      MODE12,
    ],
  },
  {
    name: 'ELECTRIC',
    abbr: ['ELE', 'CTR'],
    desc: 'Adjusts the pitch in steps to make the sound more mechanical.',
    dsp: 'electric',
    params: [
      num('shift', 'SHIFT', -12, 12, 0, { knob: true }),
      num('formant', 'FORMANT', -50, 50, 0),
      num('speed', 'SPEED', 0, 10, 5),
      num('stability', 'STABILITY', -10, 10, 0),
      en('scale', 'SCALE', ['CHROMATIC', ...KEYS], 'CHROMATIC'),
    ],
  },
  {
    name: 'HRM MANUAL',
    abbr: ['HRM', 'MAN'],
    desc: 'Adds a harmony to match the value set for the KEY.',
    dsp: 'harmony',
    params: [
      en(
        'voice',
        'VOICE',
        ['OCT-', '-6TH', '-5TH', '-4TH', '-3RD', 'UNISON', '+3RD', '+4TH', '+5TH', '+6TH', 'OCT+'],
        '+3RD',
      ),
      num('formant', 'FORMANT', -50, 50, 0),
      num('pan', 'PAN', -50, 50, 0),
      en('key', 'KEY', KEYS, 'C (Am)'),
      num('dLevel', 'D.LEVEL', 0, 100, 100),
      num('hrmLevel', 'HRM LEVEL', 0, 100, 80, { knob: true }),
    ],
  },
  {
    name: 'HRM AUTO (M)',
    abbr: ['HRM', 'ATO'],
    desc: 'Adds harmony based on received MIDI note messages.',
    dsp: 'harmony-midi',
    params: [
      en('voice', 'VOICE', ['OCT-', 'LOWER', 'LOW', 'UNISON', 'HIGH', 'HIGHER', 'OCT+'], 'HIGH'),
      num('formant', 'FORMANT', -50, 50, 0),
      num('pan', 'PAN', -50, 50, 0),
      en('hrmMode', 'HRM MODE', ['HYBRID', 'SCALIC', 'CHROMATIC'], 'HYBRID'),
      num('dLevel', 'D.LEVEL', 0, 100, 100),
      num('hrmLevel', 'HRM LEVEL', 0, 100, 80, { knob: true }),
    ],
  },
  {
    name: 'VOCODER',
    abbr: ['VO', 'COD'],
    desc: 'Applies a vocoder effect using the input as the modulator.',
    dsp: 'vocoder',
    params: [
      en('carrier', 'CARRIER', ['SAW', 'SQR', 'PULSE', 'SYNTH', 'NOISE'], 'SAW'),
      num('tone', 'TONE', -50, 50, 0, { knob: true }),
      num('attack', 'ATTACK', 0, 100, 20),
      num('modSens', 'MOD SENS', 0, 100, 50),
      num('balance', 'BALANCE', 0, 100, 100, { knob: true }),
      onOff('carrierThru', 'CARRIER THRU'),
    ],
  },
  {
    name: 'OSC VOC (M)',
    abbr: ['OSC', 'VOC'],
    desc: 'Vocoder whose carrier pitch follows received MIDI notes.',
    dsp: 'oscvoc',
    params: [
      en('carrier', 'CARRIER', ['SAW', 'SQR', 'PULSE', 'SYNTH'], 'SAW'),
      num('tone', 'TONE', -50, 50, 0, { knob: true }),
      num('attack', 'ATTACK', 0, 100, 20),
      num('octave', 'OCTAVE', -2, 2, 0),
      num('modSens', 'MOD SENS', 0, 100, 50),
      num('release', 'RELEASE', 0, 100, 30),
      num('balance', 'BALANCE', 0, 100, 100, { knob: true }),
    ],
  },
  {
    name: 'OSC BOT',
    abbr: ['OSC', 'BOT'],
    desc: 'Robot voice using an internal oscillator at a fixed pitch.',
    dsp: 'oscbot',
    params: [
      en('osc', 'OSC', ['SAW', 'SQR', 'PULSE', 'SYNTH'], 'SAW'),
      num('tone', 'TONE', -50, 50, 0, { knob: true }),
      num('attack', 'ATTACK', 0, 100, 20),
      en('note', 'NOTE', NOTES, 'C'),
      num('modSens', 'MOD SENS', 0, 100, 50),
      num('balance', 'BALANCE', 0, 100, 100, { knob: true }),
    ],
  },
  {
    name: 'PREAMP',
    abbr: ['PRE', 'AMP'],
    desc: 'Simulates the sound of a guitar amplifier.',
    dsp: 'preamp',
    params: [
      en(
        'ampType',
        'AMP TYPE',
        ['NATURAL', 'BOUTIQUE', 'STACK', 'HiGAIN', 'POWER DRIVE', 'EXTREME', 'CORE METAL'],
        'NATURAL',
      ),
      en('spkType', 'SPK TYPE', ['OFF', 'ORIGIN', '1x8"', '1x10"', '1x12"', '2x12"', '4x10"', '4x12"', '8x12"'], 'ORIGIN'),
      num('gain', 'GAIN', 0, 120, 50, { knob: true }),
      num('tComp', 'T-COMP', -10, 10, 0),
      num('bass', 'BASS', 0, 100, 50),
      num('middle', 'MIDDLE', 0, 100, 50),
      num('treble', 'TREBLE', 0, 100, 50),
      num('presence', 'PRESENCE', 0, 100, 50),
      num('eLevel', 'E.LEVEL', 0, 100, 50),
    ],
  },
  {
    name: 'DIST',
    abbr: ['DIST'],
    desc: 'Distorts the sound to create long sustain.',
    dsp: 'dist',
    params: [
      en('type', 'TYPE', ['MILD DS', 'NATURAL DS', 'HARD DS', 'TURBO DS', 'FAT DS', 'FUZZ', 'OCT FUZZ'], 'MILD DS'),
      num('tone', 'TONE', -50, 50, 0),
      num('dist', 'DIST', 0, 100, 50, { knob: true, seqTarget: true }),
      num('dLevel', 'D.LEVEL', 0, 100, 0),
      num('eLevel', 'E.LEVEL', 0, 100, 50, { knob: true }),
    ],
  },
  {
    name: 'DYNAMICS',
    abbr: ['DY', 'NMC'],
    desc: 'Compressor / expander optimised for the selected source.',
    dsp: 'dynamics',
    params: [
      en('type', 'TYPE', ['NATURAL COMP', 'MIXER COMP', 'LIVE COMP', 'HARD COMP', 'SOFT COMP', 'CLEAN COMP', 'DANCE COMP', 'ORCH COMP', 'VOX'], 'NATURAL COMP'),
      num('dynamics', 'DYNAMICS', -50, 50, 0, { knob: true }),
    ],
  },
  {
    name: 'EQ',
    abbr: ['EQ'],
    desc: 'Four-band equaliser.',
    dsp: 'eq',
    params: [
      num('lo', 'LO', -20, 20, 0, { unit: 'dB', knob: true }),
      num('loMid', 'LO-MID', -20, 20, 0, { unit: 'dB' }),
      num('loMidFreq', 'LO-MID FREQ', 20, 10000, 400, { unit: 'Hz' }),
      num('loMidQ', 'LO-MID Q', 0, 5, 1),
      num('hiMid', 'HI-MID', -20, 20, 0, { unit: 'dB' }),
      num('hiMidFreq', 'HI-MID FREQ', 20, 10000, 1600, { unit: 'Hz' }),
      num('hiMidQ', 'HI-MID Q', 0, 5, 1),
      num('high', 'HIGH', -20, 20, 0, { unit: 'dB', knob: true }),
      num('level', 'LEVEL', -20, 20, 0, { unit: 'dB' }),
    ],
  },
  {
    name: 'ISOLATOR',
    abbr: ['ISO', 'LTR'],
    desc: 'Cuts a specific frequency band to zero.',
    dsp: 'isolator',
    seq: true,
    params: [
      en('band', 'BAND', ['LOW', 'MID', 'HIGH'], 'LOW'),
      rate('rate', 'RATE', '1MEAS'),
      num('bandLevel', 'BAND LEVEL', 0, 100, 0, { knob: true, seqTarget: true }),
      num('depth', 'DEPTH', 0, 100, 100, { knob: true, seqTarget: true }),
      stepRate(),
      en('waveform', 'WAVEFORM', ['SAW', 'SQR', 'TRI'], 'SAW'),
    ],
  },
  {
    name: 'OCTAVE',
    abbr: ['OCT', 'AVE'],
    desc: 'Adds a sound one or two octaves below.',
    dsp: 'octave',
    params: [
      en('octave', 'OCTAVE', ['-1OCT', '-2OCT'], '-1OCT'),
      MODE12,
      num('octLevel', 'OCT.LEVEL', 0, 100, 50, { knob: true }),
    ],
  },
  {
    name: 'AUTO PAN',
    abbr: ['ATO', 'PAN'],
    desc: 'Cyclically moves the stereo position of the sound.',
    dsp: 'autopan',
    seq: true,
    params: [
      rate('rate', 'RATE', '1MEAS'),
      en('waveform', 'WAVEFORM', ['TRI', 'SQR', 'SAW1', 'SAW2', 'SINE'], 'TRI'),
      num('depth', 'DEPTH', 0, 100, 100, { knob: true, seqTarget: true }),
      num('initPhase', 'INIT PHASE', 0, 180, 0),
      stepRate(),
    ],
  },
  {
    name: 'MANUAL PAN',
    abbr: ['MAN', 'PAN'],
    desc: 'Sets the stereo position manually.',
    dsp: 'manualpan',
    params: [num('position', 'POSITION', -50, 50, 0, { knob: true, seqTarget: true })],
  },
  {
    name: 'STEREO ENHANCE',
    abbr: ['STR', 'ENH'],
    desc: 'Widens the stereo image.',
    dsp: 'stereoenhance',
    params: [
      num('lowCut', 'LOW CUT', 0, 16, 0),
      num('highCut', 'HIGH CUT', 0, 16, 16),
      onOff('flat', 'FLAT'),
      num('enhance', 'ENHANCE', 0, 100, 50, { knob: true }),
    ],
  },
  {
    name: 'TREMOLO',
    abbr: ['TRE', 'MLO'],
    desc: 'Cyclically modulates the volume.',
    dsp: 'tremolo',
    seq: true,
    params: [
      rate('rate', 'RATE', '♩'),
      num('depth', 'DEPTH', 0, 100, 50, { knob: true, seqTarget: true }),
      en('waveform', 'WAVEFORM', ['TRI', 'SQR', 'SAW1', 'SAW2', 'SINE'], 'TRI'),
    ],
  },
  {
    name: 'VIBRATO',
    abbr: ['VIB', 'RTO'],
    desc: 'Cyclically modulates the pitch.',
    dsp: 'vibrato',
    seq: true,
    params: [
      rate('rate', 'RATE', '♩'),
      num('depth', 'DEPTH', 0, 100, 50, { knob: true, seqTarget: true }),
      num('color', 'COLOR', 0, 100, 50),
      num('dLevel', 'D.LEVEL', 0, 100, 0),
      num('eLevel', 'E.LEVEL', 0, 100, 100),
    ],
  },
  {
    name: 'PATTERN SLICER',
    abbr: ['PTN', 'SL'],
    desc: 'Chops the sound with a rhythmic 16-step pattern.',
    dsp: 'patternslicer',
    seq: true,
    params: [
      rate('rate', 'RATE', '1MEAS'),
      num('duty', 'DUTY', 0, 100, 50),
      num('attack', 'ATTACK', 0, 100, 20),
      num('pattern', 'PATTERN', 1, 20, 1, { seqTarget: true }),
      num('depth', 'DEPTH', 0, 100, 100, { knob: true, seqTarget: true }),
      num('compThreshold', 'COMP THRESHOLD', 0, 100, 0),
      num('compGain', 'COMP GAIN', 0, 100, 0),
    ],
  },
  {
    name: 'STEP SLICER',
    abbr: ['STP', 'SL'],
    desc: 'Slices the sound using a user-defined step sequence.',
    dsp: 'stepslicer',
    seq: true,
    params: [
      rate('rate', 'RATE', '1MEAS'),
      num('stepMax', 'STEP MAX', 1, 16, 8),
      num('stepLength', 'STEP LENGTH', 1, 16, 8),
      num('stepLevel', 'STEP LEVEL', 0, 100, 100),
      num('depth', 'DEPTH', 0, 100, 100, { knob: true, seqTarget: true }),
      num('compThreshold', 'COMP THRESHOLD', 0, 100, 0),
      num('compGain', 'COMP GAIN', 0, 100, 0),
    ],
  },
  {
    name: 'DELAY',
    abbr: ['DLY'],
    desc: 'Adds delayed sound to create a sense of depth.',
    dsp: 'delay',
    seq: true,
    params: delayParams(500),
  },
  {
    name: 'PANNING DELAY',
    abbr: ['PAN', 'DLY'],
    desc: 'Delay whose repeats alternate left and right.',
    dsp: 'panningdelay',
    seq: true,
    params: delayParams(500),
  },
  {
    name: 'REVERSE DELAY',
    abbr: ['REV', 'DLY'],
    desc: 'Delay that plays the delayed sound backwards.',
    dsp: 'reversedelay',
    seq: true,
    params: delayParams(500),
  },
  {
    name: 'MOD DELAY',
    abbr: ['MOD', 'DLY'],
    desc: 'Delay with modulation added to the repeats.',
    dsp: 'moddelay',
    seq: true,
    params: [
      ...delayParams(500),
      rate('modRate', 'MOD RATE', '50'),
      num('modDepth', 'MOD DEPTH', 0, 100, 40),
    ],
  },
  {
    name: 'TAPE ECHO1',
    abbr: ['TPE', 'EC1'],
    desc: 'Simulates a tape echo (single head).',
    dsp: 'tapeecho',
    seq: true,
    params: [
      num('time', 'TIME', 1, 2000, 400, { unit: 'ms', knob: true, seqTarget: true }),
      num('feedback', 'FEEDBACK', 0, 100, 40, { knob: true, seqTarget: true }),
      num('wow', 'WOW/FLUTTER', 0, 100, 20),
      num('bass', 'BASS', -50, 50, 0),
      num('treble', 'TREBLE', -50, 50, -10),
      num('dLevel', 'D.LEVEL', 0, 100, 100),
      num('eLevel', 'E.LEVEL', 0, 100, 50, { knob: true }),
    ],
  },
  {
    name: 'TAPE ECHO2',
    abbr: ['TPE', 'EC2'],
    desc: 'Simulates a tape echo (multi head).',
    dsp: 'tapeecho2',
    seq: true,
    params: [
      num('time', 'TIME', 1, 2000, 400, { unit: 'ms', knob: true, seqTarget: true }),
      num('feedback', 'FEEDBACK', 0, 100, 40, { knob: true, seqTarget: true }),
      en('head', 'HEAD', ['S', 'M', 'L', 'S+M', 'S+L', 'M+L', 'S+M+L'], 'S+M'),
      num('wow', 'WOW/FLUTTER', 0, 100, 20),
      num('dLevel', 'D.LEVEL', 0, 100, 100),
      num('eLevel', 'E.LEVEL', 0, 100, 50, { knob: true }),
    ],
  },
  {
    name: 'GRANULAR DELAY',
    abbr: ['GRN', 'DLY'],
    desc: 'Delay that granulates and pitch-shifts the repeats.',
    dsp: 'granulardelay',
    seq: true,
    params: [
      num('time', 'TIME', 1, 1000, 200, { unit: 'ms', knob: true, seqTarget: true }),
      num('feedback', 'FEEDBACK', 0, 100, 60, { knob: true, seqTarget: true }),
      num('pitch', 'PITCH', -12, 12, 12, { seqTarget: true }),
      num('dLevel', 'D.LEVEL', 0, 100, 100),
      num('eLevel', 'E.LEVEL', 0, 100, 50, { knob: true }),
    ],
  },
  {
    name: 'WARP',
    abbr: ['WARP'],
    desc: 'Continuously stretches the sound into a wash of reverb.',
    dsp: 'warp',
    params: [
      num('level', 'LEVEL', 0, 100, 50, { knob: true, seqTarget: true }),
      num('preDelay', 'PRE DELAY', 0, 100, 0),
    ],
  },
  {
    name: 'TWIST',
    abbr: ['TWI', 'ST'],
    desc: 'Compresses then releases the sound in a burst.',
    dsp: 'twist',
    params: [
      num('level', 'LEVEL', 0, 100, 50, { knob: true, seqTarget: true }),
      num('rise', 'RISE TIME', 0, 100, 50),
      num('fall', 'FALL TIME', 0, 100, 50),
    ],
  },
  {
    name: 'ROLL1',
    abbr: ['ROL', 'L1'],
    desc: 'Repeats a short slice of sound like a drum roll (mode 1).',
    dsp: 'roll',
    seq: true,
    params: [
      rate('time', 'TIME', '♬'),
      num('feedback', 'FEEDBACK', 0, 100, 80, { knob: true, seqTarget: true }),
      num('balance', 'BALANCE', 0, 100, 100, { knob: true }),
    ],
  },
  {
    name: 'ROLL2',
    abbr: ['ROL', 'L2'],
    desc: 'Repeats a short slice of sound like a drum roll (mode 2).',
    dsp: 'roll2',
    seq: true,
    params: [
      rate('time', 'TIME', '♬'),
      num('feedback', 'FEEDBACK', 0, 100, 80, { knob: true, seqTarget: true }),
      num('balance', 'BALANCE', 0, 100, 100, { knob: true }),
    ],
  },
  {
    name: 'FREEZE',
    abbr: ['FRE', 'EZE'],
    desc: 'Sustains the sound at the moment the effect is turned on.',
    dsp: 'freeze',
    params: [
      num('level', 'LEVEL', 0, 100, 80, { knob: true, seqTarget: true }),
      num('attack', 'ATTACK', 0, 100, 10),
      num('release', 'RELEASE', 0, 100, 30),
    ],
  },
  {
    name: 'CHORUS',
    abbr: ['CHO', 'RUS'],
    desc: 'Adds spaciousness and depth to the sound.',
    dsp: 'chorus',
    seq: true,
    params: [
      rate('rate', 'RATE', '50'),
      num('depth', 'DEPTH', 0, 100, 50, { knob: true, seqTarget: true }),
      num('lowCut', 'LOW CUT', 0, 16, 2),
      num('highCut', 'HIGH CUT', 0, 16, 16),
      num('dLevel', 'D.LEVEL', 0, 100, 100),
      num('eLevel', 'E.LEVEL', 0, 100, 50, { knob: true }),
    ],
  },
  {
    name: 'REVERB',
    abbr: ['RE', 'VRB'],
    desc: 'Adds reverberation to the sound.',
    dsp: 'reverb',
    seq: true,
    params: reverbParams(),
  },
  {
    name: 'GATE REVERB',
    abbr: ['GAT', 'RVB'],
    desc: 'Reverb that is cut off abruptly.',
    dsp: 'gatereverb',
    seq: true,
    params: reverbParams(),
  },
  {
    name: 'REVERSE REVERB',
    abbr: ['REV', 'RVB'],
    desc: 'Reverb that swells backwards.',
    dsp: 'reversereverb',
    seq: true,
    params: reverbParams(),
  },

  // --- Types available only for Track FX -----------------------------------
  {
    name: 'BEAT SCATTER',
    abbr: ['BT', 'SCT'],
    desc: 'Loops and rearranges the phrase in beat units.',
    dsp: 'beatscatter',
    trackOnly: true,
    seq: true,
    params: [
      en('type', 'TYPE', ['P1', 'P2', 'P3', 'P4'], 'P1'),
      rate('length', 'LENGTH', '♩', { values: ['♬', '♪', '♩', '1MEAS', '2MEAS'] }),
    ],
  },
  {
    name: 'BEAT REPEAT',
    abbr: ['BT', 'RPT'],
    desc: 'Repeats a captured slice of the phrase.',
    dsp: 'beatrepeat',
    trackOnly: true,
    seq: true,
    params: [
      en('type', 'TYPE', ['P1', 'P2', 'P3', 'P4'], 'P1'),
      rate('length', 'LENGTH', '♩', { values: ['♬', '♪', '♩', '1MEAS', '2MEAS'] }),
    ],
  },
  {
    name: 'BEAT SHIFT',
    abbr: ['BT', 'SFT'],
    desc: 'Shifts the phrase playback position in beat units.',
    dsp: 'beatshift',
    trackOnly: true,
    seq: true,
    params: [
      en('type', 'TYPE', ['P1', 'P2', 'P3', 'P4'], 'P1'),
      rate('shift', 'SHIFT', '♩', { values: ['♬', '♪', '♩', '1MEAS'] }),
    ],
  },
  {
    name: 'VINYL FLICK',
    abbr: ['VNL', 'FLK'],
    desc: 'Adds the noise of a record needle flicking.',
    dsp: 'vinylflick',
    trackOnly: true,
    params: [num('flick', 'FLICK', 0, 100, 50, { knob: true, seqTarget: true })],
  },
];

export const FX_BY_NAME = new Map(FX_TYPES.map((f) => [f.name, f]));

/** Types selectable as Input FX (excludes the four track-only types). */
export const INPUT_FX_TYPES = FX_TYPES.filter((f) => !f.trackOnly);
/** Types selectable as Track FX (all of them). */
export const TRACK_FX_TYPES = FX_TYPES;

export function fxType(name: string): FxType {
  return FX_BY_NAME.get(name) ?? FX_TYPES[0];
}

export function defaultFxParams(name: string): Record<string, number | string> {
  const out: Record<string, number | string> = {};
  for (const p of fxType(name).params) out[p.id] = p.def;
  return out;
}

/** The parameter the big FX knob drives for a given type (first ⟳ parameter). */
export function knobParam(name: string): FxParam | undefined {
  return fxType(name).params.find((p) => p.knob);
}

/**
 * Convert a RATE-style value into a frequency in Hz for a given tempo.
 * Musical divisions are tempo-locked; numeric values 0–100 map to 0.05–20 Hz.
 */
export function rateToHz(value: number | string, tempo: number, beatsPerMeasure: number): number {
  const beatSec = 60 / tempo;
  switch (value) {
    case '4MEAS':
      return 1 / (beatSec * beatsPerMeasure * 4);
    case '2MEAS':
      return 1 / (beatSec * beatsPerMeasure * 2);
    case '1MEAS':
      return 1 / (beatSec * beatsPerMeasure);
    case '♩.':
      return 1 / (beatSec * 1.5);
    case '♩':
      return 1 / beatSec;
    case '♪3':
      return 1 / (beatSec / 3);
    case '♪':
      return 1 / (beatSec / 2);
    case '♬':
      return 1 / (beatSec / 4);
    default: {
      const n = typeof value === 'number' ? value : Number(value);
      if (!Number.isFinite(n)) return 1;
      return 0.05 * Math.pow(400, n / 100); // 0.05 Hz .. 20 Hz, exponential
    }
  }
}

/** Period in seconds for a RATE-style value (inverse of {@link rateToHz}). */
export function rateToSeconds(value: number | string, tempo: number, beatsPerMeasure: number): number {
  return 1 / rateToHz(value, tempo, beatsPerMeasure);
}
