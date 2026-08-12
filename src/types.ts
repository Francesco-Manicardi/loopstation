/**
 * Type definitions mirroring the RC-505mkII data model as documented in the
 * BOSS RC-505mkII Owner's Manual and Parameter Guide (Ver. 1.3).
 */

export const NUM_TRACKS = 5;
export const NUM_MEMORIES = 99;
export const FX_SLOTS = ['A', 'B', 'C', 'D'] as const;
export const FX_BANKS = ['A', 'B', 'C', 'D'] as const;

export type FxSlot = (typeof FX_SLOTS)[number];
export type FxBank = (typeof FX_BANKS)[number];
export type TrackIndex = 0 | 1 | 2 | 3 | 4;

/** Runtime transport state of a phrase track. */
export type TrackState =
  | 'empty'
  | 'stopped'
  | 'playing'
  | 'recording'
  | 'overdubbing'
  | 'rec-standby' // AUTO REC armed, or waiting for quantize boundary
  | 'play-standby'
  | 'stopping'; // STOP MODE = FADE / LOOP, waiting to actually stop

// ---------------------------------------------------------------------------
// LOOP (memory) settings
// ---------------------------------------------------------------------------

export type StartMode = 'IMMEDIATE' | 'FADE';
export type StopMode = 'IMMEDIATE' | 'FADE' | 'LOOP';
export type DubMode = 'OVERDUB' | 'REPLACE1' | 'REPLACE2';
export type PlayMode = 'MULTI' | 'SINGLE';
export type LoopSyncMode = 'IMMEDIATE' | 'MEASURE' | 'LOOP LENGTH';
export type TempoSyncMode = 'PITCH' | 'XFADE';
export type TrackSpeed = 'HALF' | 'NORMAL' | 'DOUBLE';
/** `AUTO` | `FREE` | a number of measures (fractions < 1 encode note values). */
export type MeasureSetting = 'AUTO' | 'FREE' | number;

export interface TrackInputRouting {
  mic1: boolean;
  mic2: boolean;
  inst1L: boolean;
  inst1R: boolean;
  inst2L: boolean;
  inst2R: boolean;
  rhythm: boolean;
}

export interface TrackSettings {
  reverse: boolean;
  oneShot: boolean;
  pan: number; // -50..0..+50  (L50 .. CENTER .. R50)
  playLevel: number; // 0..100..200
  startMode: StartMode;
  stopMode: StopMode;
  dubMode: DubMode;
  fx: boolean;
  playMode: PlayMode;
  measure: MeasureSetting;
  loopSyncSw: boolean;
  loopSyncMode: LoopSyncMode;
  tempoSyncSw: boolean;
  tempoSyncMode: TempoSyncMode;
  tempoSyncSpeed: TrackSpeed;
  bounceIn: boolean;
  input: TrackInputRouting;
}

export type RecAction = 'REC->DUB' | 'REC->PLAY';
export type Quantize = 'OFF' | 'MEASURE';

export interface RecSettings {
  recAction: RecAction;
  quantize: Quantize;
  autoRecSw: boolean;
  autoRecSens: number; // 1..100
  bounceSw: boolean;
  bounceTrack: [boolean, boolean, boolean, boolean, boolean];
}

export type SingleTrackChange = 'IMMEDIATE' | 'LOOP END' | 'MEASURE';
export type SpeedChange = 'IMMEDIATE' | 'LOOP END';
export type SyncAdjust = 'MEASURE' | 'BEAT';

export interface PlaySettings {
  singleTrackChange: SingleTrackChange;
  currentTrack: TrackIndex;
  fadeTimeIn: number; // measures (0.25 = quarter note etc.)
  fadeTimeOut: number;
  allStartTrack: [boolean, boolean, boolean, boolean, boolean];
  allStopTrack: [boolean, boolean, boolean, boolean, boolean];
  loopLength: 'AUTO' | number;
  speedChange: SpeedChange;
  syncAdjust: SyncAdjust;
}

// ---------------------------------------------------------------------------
// FX
// ---------------------------------------------------------------------------

export type FxSwMode = 'TOGGLE' | 'MOMENT';
export type FxBankMode = 'SINGLE' | 'MULTI';
export type InputFxInsert = 'ALL' | 'MIC1' | 'MIC2' | 'INST1-L' | 'INST1-R' | 'INST2-L' | 'INST2-R';
export type TrackFxInsert = 'ALL' | 'TRACK1' | 'TRACK2' | 'TRACK3' | 'TRACK4' | 'TRACK5';

export interface FxSequence {
  sw: boolean;
  sync: boolean;
  retrig: boolean;
  target: string;
  rate: number | string;
  max: number; // 1..16
  values: number[]; // 16 entries, 1..16
}

export interface FxSlotSettings {
  /** Name from the Input FX / Track FX List (e.g. `LPF`). */
  type: string;
  sw: boolean;
  swMode: FxSwMode;
  insert: string;
  /** Parameter values keyed by parameter id, per FX type. */
  params: Record<string, number | string>;
  sequence: FxSequence;
}

export interface FxBankSettings {
  sw: boolean;
  mode: FxBankMode;
  /** Which slot the big INPUT FX / TRACK FX knob controls. */
  fxTarget: FxSlot;
  slots: Record<FxSlot, FxSlotSettings>;
}

export interface FxSectionSettings {
  bank: FxBank;
  banks: Record<FxBank, FxBankSettings>;
}

// ---------------------------------------------------------------------------
// Rhythm
// ---------------------------------------------------------------------------

export type RhythmStartTrig = 'LOOP START' | 'REC END' | 'BEFORE LOOP';
export type RhythmStopTrig = 'OFF' | 'LOOP STOP' | 'REC END';
export type VariationChange = 'MEASURE' | 'LOOP END';

export interface RhythmSettings {
  genre: string;
  pattern: string;
  variation: 'A' | 'B' | 'C' | 'D';
  kit: string;
  beat: string; // e.g. '4/4'
  level: number; // 0..100
  startTrig: RhythmStartTrig;
  stopTrig: RhythmStopTrig;
  introRec: boolean;
  introPlay: boolean;
  ending: boolean;
  fill: boolean;
  variationChange: VariationChange;
}

// ---------------------------------------------------------------------------
// Memory
// ---------------------------------------------------------------------------

export interface Memory {
  name: string; // max 12 chars
  tempo: number; // 40.0 .. 300.0
  tracks: TrackSettings[];
  trackLevels: number[]; // fader positions 0..100
  rec: RecSettings;
  play: PlaySettings;
  inputFx: FxSectionSettings;
  trackFx: FxSectionSettings;
  rhythm: RhythmSettings;
}

// ---------------------------------------------------------------------------
// System settings (MENU)
// ---------------------------------------------------------------------------

export interface InputChannelSettings {
  level: number; // 0..100..200
  mute: boolean;
  reverb: number;
  phantom?: boolean;
  gain?: number;
  eq: { sw: boolean; low: number; mid: number; midFreq: number; high: number; level: number };
  dynamics: { compSw: boolean; compThreshold: number; nsSw: boolean; nsThreshold: number };
}

export interface OutputBusSettings {
  level: number;
  eq: { sw: boolean; low: number; mid: number; midFreq: number; high: number; level: number };
  routing: { tracks: boolean[]; inputs: boolean[]; rhythm: boolean };
}

export interface SystemSettings {
  input: {
    stereoLink: { mic: boolean; inst1: boolean; inst2: boolean };
    channels: Record<'mic1' | 'mic2' | 'inst1' | 'inst2' | 'usb', InputChannelSettings>;
  };
  output: {
    main: OutputBusSettings;
    sub1: OutputBusSettings;
    sub2: OutputBusSettings;
    masterFx: {
      reverb: { sw: boolean; type: string; time: number; level: number };
      comp: { sw: boolean; threshold: number; ratio: string; gain: number };
    };
    phonesMix: { tracks: boolean[]; rhythm: boolean; inputs: boolean };
    /** MIXER screen levels (0..100..200). */
    loopLevel: number;
    rhythmLevel: number;
    masterLevel: number;
  };
  ctlFunc: {
    panelPlay: { trackButton: string; fxButton: string };
    panelUndo: { fxButton: string; trackButton: string; stopButton: string; recButton: string };
  };
  setup: {
    displayContrast: number; // 1..10
    autoOff: 'OFF' | '10min' | '30min' | '60min' | '240min';
    knobLock: boolean;
    playScreen: number; // startup play-screen variation
    ledDimmer: number; // 1..10
    /** Double-click [q] to clear every track. */
    quickClear: boolean;
    /** Long-press [ALL START/STOP] to clear every track. */
    allClear: boolean;
  };
  midi: {
    rxChCtl: number | 'OFF';
    rxChRhythm: number | 'OFF';
    rxChVoice: number | 'OFF';
    txCh: number | 'OFF';
    syncClock: 'AUTO' | 'INTERNAL' | 'MIDI' | 'USB';
    syncOut: boolean;
    syncStart: 'OFF' | 'ALL START' | 'RHYTHM';
    pcOut: boolean;
  };
  usb: {
    audioRouting: 'LOOP IN' | 'SUB MIX' | 'MAIN OUT';
    inputLevel: number;
    outputLevel: number;
  };
}

// ---------------------------------------------------------------------------
// Runtime status pushed from the audio worklet
// ---------------------------------------------------------------------------

export interface TrackStatus {
  state: TrackState;
  /** 0..1 progress through the loop. */
  position: number;
  lengthSeconds: number;
  measures: number;
  /** Post-fader peak level 0..1, for the loop indicator brightness. */
  level: number;
  undoAvailable: boolean;
  redoAvailable: boolean;
  markSet: boolean;
  hasPhrase: boolean;
}

export interface TransportStatus {
  /** Absolute beat position of the master clock (whole beats). */
  beat: number;
  /** Fractional part of the current beat, 0..1 — used for beat flashes. */
  beatPhase: number;
  measure: number;
  beatInMeasure: number;
  running: boolean;
  tempo: number;
  loopLengthSeconds: number;
  tracks: TrackStatus[];
  inputPeak: number;
  outputPeak: [number, number];
}
