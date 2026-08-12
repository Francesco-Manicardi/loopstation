/**
 * Factory defaults. Values follow the "Initial value" column of the RC-505mkII
 * Parameter Guide; the FX type assigned to each of the 16 slots per section is a
 * usable starting set (the hardware ships with factory memories, not a single
 * documented default), chosen so every FX family is one bank away.
 */

import { defaultFxParams } from '../data/fx-list';
import {
  FX_BANKS,
  FX_SLOTS,
  NUM_MEMORIES,
  NUM_TRACKS,
  type FxBank,
  type FxBankSettings,
  type FxSectionSettings,
  type FxSlot,
  type FxSlotSettings,
  type Memory,
  type SystemSettings,
  type TrackSettings,
} from '../types';

const INPUT_FX_LAYOUT: Record<FxBank, Record<FxSlot, string>> = {
  A: { A: 'LPF', B: 'DELAY', C: 'REVERB', D: 'DIST' },
  B: { A: 'FLANGER', B: 'PHASER', C: 'CHORUS', D: 'TREMOLO' },
  C: { A: 'TRANSPOSE', B: 'OCTAVE', C: 'ROBOT', D: 'VOCODER' },
  D: { A: 'ISOLATOR', B: 'PATTERN SLICER', C: 'ROLL1', D: 'FREEZE' },
};

const TRACK_FX_LAYOUT: Record<FxBank, Record<FxSlot, string>> = {
  A: { A: 'BEAT REPEAT', B: 'BEAT SCATTER', C: 'VINYL FLICK', D: 'BEAT SHIFT' },
  B: { A: 'LPF', B: 'BPF', C: 'HPF', D: 'ISOLATOR' },
  C: { A: 'DELAY', B: 'TAPE ECHO1', C: 'REVERB', D: 'GATE REVERB' },
  D: { A: 'PATTERN SLICER', B: 'STEP SLICER', C: 'ROLL1', D: 'FREEZE' },
};

function defaultSlot(type: string): FxSlotSettings {
  return {
    type,
    sw: false,
    swMode: 'TOGGLE',
    insert: 'ALL',
    params: defaultFxParams(type),
    sequence: {
      sw: false,
      sync: true,
      retrig: false,
      target: '',
      rate: '1MEAS',
      max: 16,
      values: Array.from({ length: 16 }, (_, i) => 1 + (i % 16)),
    },
  };
}

function defaultFxSection(layout: Record<FxBank, Record<FxSlot, string>>): FxSectionSettings {
  const banks = {} as Record<FxBank, FxBankSettings>;
  for (const b of FX_BANKS) {
    const slots = {} as Record<FxSlot, FxSlotSettings>;
    for (const s of FX_SLOTS) slots[s] = defaultSlot(layout[b][s]);
    banks[b] = { sw: true, mode: 'SINGLE', fxTarget: 'A', slots };
  }
  return { bank: 'A', banks };
}

export function defaultTrack(): TrackSettings {
  return {
    reverse: false,
    oneShot: false,
    pan: 0,
    playLevel: 100,
    startMode: 'IMMEDIATE',
    stopMode: 'IMMEDIATE',
    dubMode: 'OVERDUB',
    fx: true,
    playMode: 'MULTI',
    measure: 'AUTO',
    loopSyncSw: true,
    loopSyncMode: 'MEASURE',
    tempoSyncSw: true,
    tempoSyncMode: 'PITCH',
    tempoSyncSpeed: 'NORMAL',
    bounceIn: false,
    input: { mic1: true, mic2: true, inst1L: true, inst1R: true, inst2L: true, inst2R: true, rhythm: false },
  };
}

export function defaultMemory(index: number): Memory {
  return {
    name: index === 0 ? 'RC-505mkII' : `MEMORY ${String(index + 1).padStart(2, '0')}`,
    tempo: 120,
    tracks: Array.from({ length: NUM_TRACKS }, () => defaultTrack()),
    trackLevels: Array.from({ length: NUM_TRACKS }, () => 100),
    rec: {
      recAction: 'REC->DUB',
      quantize: 'OFF',
      autoRecSw: false,
      autoRecSens: 50,
      bounceSw: false,
      bounceTrack: [false, false, false, false, false],
    },
    play: {
      singleTrackChange: 'IMMEDIATE',
      currentTrack: 0,
      fadeTimeIn: 2,
      fadeTimeOut: 2,
      allStartTrack: [true, true, true, true, true],
      allStopTrack: [true, true, true, true, true],
      loopLength: 'AUTO',
      speedChange: 'IMMEDIATE',
      syncAdjust: 'MEASURE',
    },
    inputFx: defaultFxSection(INPUT_FX_LAYOUT),
    trackFx: defaultFxSection(TRACK_FX_LAYOUT),
    rhythm: {
      genre: 'POP',
      pattern: '8BEAT1',
      variation: 'A',
      kit: 'STUDIO',
      beat: '4/4',
      level: 50,
      startTrig: 'LOOP START',
      stopTrig: 'LOOP STOP',
      introRec: false,
      introPlay: false,
      ending: false,
      fill: true,
      variationChange: 'MEASURE',
    },
  };
}

export function defaultMemories(): Memory[] {
  return Array.from({ length: NUM_MEMORIES }, (_, i) => defaultMemory(i));
}

const channelDefaults = (phantom = false, gain = 50) => ({
  level: 100,
  mute: false,
  reverb: 0,
  phantom,
  gain,
  eq: { sw: false, low: 0, mid: 0, midFreq: 1000, high: 0, level: 0 },
  dynamics: { compSw: false, compThreshold: 50, nsSw: false, nsThreshold: 30 },
});

const busDefaults = () => ({
  level: 100,
  eq: { sw: false, low: 0, mid: 0, midFreq: 1000, high: 0, level: 0 },
  routing: {
    tracks: [true, true, true, true, true],
    inputs: [true, true, true, true, true],
    rhythm: true,
  },
});

export function defaultSystem(): SystemSettings {
  return {
    input: {
      stereoLink: { mic: false, inst1: true, inst2: true },
      channels: {
        mic1: channelDefaults(false, 50),
        mic2: channelDefaults(false, 50),
        inst1: channelDefaults(),
        inst2: channelDefaults(),
        usb: channelDefaults(),
      },
    },
    output: {
      main: busDefaults(),
      sub1: busDefaults(),
      sub2: busDefaults(),
      masterFx: {
        reverb: { sw: false, type: 'HALL', time: 40, level: 40 },
        comp: { sw: false, threshold: 50, ratio: '4:1', gain: 0 },
      },
      phonesMix: { tracks: [true, true, true, true, true], rhythm: true, inputs: true },
      loopLevel: 100,
      rhythmLevel: 100,
      masterLevel: 100,
    },
    ctlFunc: {
      panelPlay: { trackButton: 'TRACK SELECT', fxButton: 'FX ON/OFF' },
      // Factory assignment printed in the Owner's Manual (Top Panel, TRACK 1-5).
      panelUndo: { fxButton: 'MARK CLEAR', trackButton: 'MARK SET', stopButton: 'MARK BACK', recButton: 'UNDO/REDO' },
    },
    setup: {
      displayContrast: 5,
      autoOff: 'OFF',
      knobLock: false,
      playScreen: 1,
      ledDimmer: 10,
      quickClear: false,
      allClear: false,
    },
    midi: {
      rxChCtl: 1,
      rxChRhythm: 1,
      rxChVoice: 1,
      txCh: 1,
      syncClock: 'AUTO',
      syncOut: false,
      syncStart: 'OFF',
      pcOut: false,
    },
    usb: { audioRouting: 'LOOP IN', inputLevel: 100, outputLevel: 100 },
  };
}
