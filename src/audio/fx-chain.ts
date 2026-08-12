/**
 * FX instantiation. Every type in the Input FX / Track FX list is realised as a
 * small Web Audio sub-graph with a common interface, so an FX slot can swap its
 * type at any time and the bank logic never needs to know what is inside.
 */

import { fxType, rateToHz, rateToSeconds } from '../data/fx-list';
import type { FxSlotSettings } from '../types';

export interface FxContext {
  tempo: number;
  beatsPerMeasure: number;
}

export interface FxUnit {
  readonly type: string;
  readonly input: AudioNode;
  readonly output: AudioNode;
  /** Applies a parameter set (also called when the tempo changes). */
  setParams(params: Record<string, number | string>, ctxInfo: FxContext): void;
  /** FX on/off. `time` is an AudioContext timestamp for click-free switching. */
  setActive(on: boolean, time: number): void;
  /** Called ~25×/s for units that schedule their own step automation. */
  tick?(now: number, ctxInfo: FxContext): void;
  dispose(): void;
}

type ParamMap = Record<string, number | string>;

const numOf = (p: ParamMap, id: string, def = 0): number => {
  const v = p[id];
  if (typeof v === 'number') return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
};
const strOf = (p: ParamMap, id: string, def = ''): string => {
  const v = p[id];
  return v === undefined ? def : String(v);
};

/** LOW CUT step index (0 = FLAT) → Hz. */
const LOW_CUT_HZ = [0, 20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630];
/** HIGH CUT step index (16 = FLAT) → Hz. */
const HIGH_CUT_HZ = [630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000, 20000, 0];

const lowCutHz = (i: number): number => LOW_CUT_HZ[Math.max(0, Math.min(16, Math.round(i)))] ?? 0;
const highCutHz = (i: number): number => HIGH_CUT_HZ[Math.max(0, Math.min(16, Math.round(i)))] ?? 0;

const OSC_WAVE: Record<string, OscillatorType> = {
  TRI: 'triangle',
  SQR: 'square',
  SAW1: 'sawtooth',
  SAW2: 'sawtooth',
  SINE: 'sine',
};

// ---------------------------------------------------------------------------
// Base class: dry/wet crossfade bypass shared by every unit.
// ---------------------------------------------------------------------------

abstract class BaseUnit implements FxUnit {
  readonly input: GainNode;
  readonly output: GainNode;
  protected readonly wetIn: GainNode;
  protected readonly wetOut: GainNode;
  protected readonly dry: GainNode;
  protected active = false;
  protected params: ParamMap = {};
  protected info: FxContext = { tempo: 120, beatsPerMeasure: 4 };

  constructor(
    protected ctx: AudioContext,
    readonly type: string,
  ) {
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.wetIn = ctx.createGain();
    this.wetOut = ctx.createGain();
    this.dry = ctx.createGain();
    this.input.connect(this.wetIn);
    this.input.connect(this.dry);
    this.wetOut.connect(this.output);
    this.dry.connect(this.output);
    this.wetOut.gain.value = 0;
    this.dry.gain.value = 1;
  }

  setParams(params: ParamMap, info: FxContext): void {
    this.params = params;
    this.info = info;
    this.apply(params, info);
  }

  protected abstract apply(params: ParamMap, info: FxContext): void;

  setActive(on: boolean, time: number): void {
    if (on === this.active) return;
    this.active = on;
    const t = Math.max(time, this.ctx.currentTime);
    const ramp = 0.008;
    this.wetOut.gain.cancelScheduledValues(t);
    this.dry.gain.cancelScheduledValues(t);
    this.wetOut.gain.setTargetAtTime(on ? 1 : 0, t, ramp);
    this.dry.gain.setTargetAtTime(on ? 0 : 1, t, ramp);
    this.onActive(on, t);
  }

  protected onActive(_on: boolean, _time: number): void {
    /* overridden where needed */
  }

  dispose(): void {
    this.input.disconnect();
    this.output.disconnect();
    this.wetIn.disconnect();
    this.wetOut.disconnect();
    this.dry.disconnect();
    this.teardown();
  }

  protected teardown(): void {
    /* overridden where needed */
  }
}

/** Units whose wet signal already contains the dry path (delay, reverb, EQ …). */
abstract class InsertUnit extends BaseUnit {
  constructor(ctx: AudioContext, type: string) {
    super(ctx, type);
    // Dry is only used while bypassed; the wet path carries D.LEVEL itself.
  }
}

// ---------------------------------------------------------------------------
// Filters (LPF / BPF / HPF) with tempo-synced LFO sweep
// ---------------------------------------------------------------------------

class FilterUnit extends BaseUnit {
  private filter: BiquadFilterNode;
  private lfo: OscillatorNode;
  private lfoGain: GainNode;

  constructor(ctx: AudioContext, type: string, private kind: BiquadFilterType) {
    super(ctx, type);
    this.filter = ctx.createBiquadFilter();
    this.filter.type = kind;
    this.lfo = ctx.createOscillator();
    this.lfo.type = 'triangle';
    this.lfoGain = ctx.createGain();
    this.lfo.connect(this.lfoGain).connect(this.filter.detune);
    this.lfo.start();
    this.wetIn.connect(this.filter).connect(this.wetOut);
  }

  protected apply(p: ParamMap, info: FxContext): void {
    const cutoff = numOf(p, 'cutoff', 50);
    const depth = numOf(p, 'depth', 50);
    const res = numOf(p, 'resonance', 50);
    // 0..100 maps exponentially over the audible range.
    const hz = 40 * Math.pow(400, cutoff / 100);
    this.filter.frequency.setTargetAtTime(Math.min(hz, this.ctx.sampleRate / 2.2), this.ctx.currentTime, 0.01);
    this.filter.Q.value = this.kind === 'bandpass' ? 0.7 + (res / 100) * 12 : (res / 100) * 20;
    const stepRate = strOf(p, 'stepRate', 'OFF');
    const rateVal = stepRate !== 'OFF' ? stepRate : p['rate'];
    this.lfo.frequency.value = rateToHz(rateVal as string, info.tempo, info.beatsPerMeasure);
    this.lfoGain.gain.value = (depth / 100) * 3600; // cents
  }

  protected override teardown(): void {
    this.lfo.stop();
    this.filter.disconnect();
  }
}

// ---------------------------------------------------------------------------
// ISOLATOR — 3-band split with the selected band level modulated by the LFO
// ---------------------------------------------------------------------------

class IsolatorUnit extends BaseUnit {
  private lowF: BiquadFilterNode;
  private midF: BiquadFilterNode;
  private highF: BiquadFilterNode;
  private gains: Record<'LOW' | 'MID' | 'HIGH', GainNode>;
  private lfo: OscillatorNode;
  private lfoGain: GainNode;

  constructor(ctx: AudioContext) {
    super(ctx, 'ISOLATOR');
    this.lowF = ctx.createBiquadFilter();
    this.lowF.type = 'lowpass';
    this.lowF.frequency.value = 300;
    this.midF = ctx.createBiquadFilter();
    this.midF.type = 'bandpass';
    this.midF.frequency.value = 1200;
    this.midF.Q.value = 0.8;
    this.highF = ctx.createBiquadFilter();
    this.highF.type = 'highpass';
    this.highF.frequency.value = 4000;
    this.gains = {
      LOW: ctx.createGain(),
      MID: ctx.createGain(),
      HIGH: ctx.createGain(),
    };
    this.wetIn.connect(this.lowF).connect(this.gains.LOW).connect(this.wetOut);
    this.wetIn.connect(this.midF).connect(this.gains.MID).connect(this.wetOut);
    this.wetIn.connect(this.highF).connect(this.gains.HIGH).connect(this.wetOut);
    this.lfo = ctx.createOscillator();
    this.lfo.type = 'sawtooth';
    this.lfoGain = ctx.createGain();
    this.lfo.start();
  }

  protected apply(p: ParamMap, info: FxContext): void {
    const band = strOf(p, 'band', 'LOW') as 'LOW' | 'MID' | 'HIGH';
    const level = numOf(p, 'bandLevel', 0) / 100;
    const depth = numOf(p, 'depth', 100) / 100;
    for (const key of ['LOW', 'MID', 'HIGH'] as const) {
      this.gains[key].gain.cancelScheduledValues(this.ctx.currentTime);
      this.gains[key].gain.value = key === band ? level : 1;
    }
    this.lfoGain.disconnect();
    const wf = strOf(p, 'waveform', 'SAW');
    this.lfo.type = wf === 'SQR' ? 'square' : wf === 'TRI' ? 'triangle' : 'sawtooth';
    const stepRate = strOf(p, 'stepRate', 'OFF');
    const rateVal = stepRate !== 'OFF' ? stepRate : p['rate'];
    this.lfo.frequency.value = rateToHz(rateVal as string, info.tempo, info.beatsPerMeasure);
    this.lfoGain.gain.value = depth * (1 - level) * 0.5;
    this.lfo.connect(this.lfoGain).connect(this.gains[band].gain);
  }

  protected override teardown(): void {
    this.lfo.stop();
  }
}

// ---------------------------------------------------------------------------
// Modulation: PHASER / FLANGER / CHORUS / VIBRATO
// ---------------------------------------------------------------------------

class ModUnit extends BaseUnit {
  private delay: DelayNode;
  private feedback: GainNode;
  private lfo: OscillatorNode;
  private lfoGain: GainNode;
  private eLevel: GainNode;
  private dLevel: GainNode;
  private allpass: BiquadFilterNode[] = [];
  private lowCut: BiquadFilterNode;
  private highCut: BiquadFilterNode;

  constructor(ctx: AudioContext, type: string, private variant: 'phaser' | 'flanger' | 'chorus' | 'vibrato') {
    super(ctx, type);
    this.delay = ctx.createDelay(0.06);
    this.feedback = ctx.createGain();
    this.lfo = ctx.createOscillator();
    this.lfo.type = 'sine';
    this.lfoGain = ctx.createGain();
    this.eLevel = ctx.createGain();
    this.dLevel = ctx.createGain();
    this.lowCut = ctx.createBiquadFilter();
    this.lowCut.type = 'highpass';
    this.lowCut.frequency.value = 20;
    this.highCut = ctx.createBiquadFilter();
    this.highCut.type = 'lowpass';
    this.highCut.frequency.value = 20000;

    if (variant === 'phaser') {
      let node: AudioNode = this.wetIn;
      for (let i = 0; i < 4; i++) {
        const ap = ctx.createBiquadFilter();
        ap.type = 'allpass';
        ap.frequency.value = 500;
        this.allpass.push(ap);
        node.connect(ap);
        node = ap;
      }
      node.connect(this.eLevel);
      node.connect(this.feedback);
      this.feedback.connect(this.allpass[0]);
      for (const ap of this.allpass) this.lfoGain.connect(ap.detune);
    } else {
      this.wetIn.connect(this.lowCut).connect(this.delay).connect(this.highCut);
      this.highCut.connect(this.eLevel);
      this.highCut.connect(this.feedback);
      this.feedback.connect(this.delay);
      this.lfoGain.connect(this.delay.delayTime);
    }
    this.wetIn.connect(this.dLevel);
    this.dLevel.connect(this.wetOut);
    this.eLevel.connect(this.wetOut);
    this.lfo.connect(this.lfoGain);
    this.lfo.start();
  }

  protected apply(p: ParamMap, info: FxContext): void {
    const depth = numOf(p, 'depth', 50) / 100;
    const rateVal = (strOf(p, 'stepRate', 'OFF') !== 'OFF' ? p['stepRate'] : p['rate']) as string;
    this.lfo.frequency.value = rateToHz(rateVal, info.tempo, info.beatsPerMeasure);
    const now = this.ctx.currentTime;

    if (this.variant === 'phaser') {
      const manual = numOf(p, 'manual', 50) / 100;
      const stages = strOf(p, 'stage', '4');
      const active = stages === 'BI-PHASE' ? 4 : Math.min(4, Math.max(1, Math.round(Number(stages) / 2)));
      this.allpass.forEach((ap, i) => {
        ap.frequency.value = i < active ? 200 + manual * 1800 : 20000;
      });
      this.lfoGain.gain.value = depth * 2400;
      this.feedback.gain.value = (numOf(p, 'resonance', 50) / 100) * 0.7;
      this.dLevel.gain.value = numOf(p, 'dLevel', 100) / 100;
      this.eLevel.gain.value = numOf(p, 'eLevel', 50) / 100;
      return;
    }

    if (this.variant === 'vibrato') {
      this.delay.delayTime.setTargetAtTime(0.005, now, 0.01);
      this.lfoGain.gain.value = depth * 0.0035;
      this.feedback.gain.value = 0;
      this.dLevel.gain.value = numOf(p, 'dLevel', 0) / 100;
      this.eLevel.gain.value = numOf(p, 'eLevel', 100) / 100;
      const color = numOf(p, 'color', 50) / 100;
      this.highCut.frequency.value = 1500 + color * 16000;
      return;
    }

    if (this.variant === 'chorus') {
      this.delay.delayTime.setTargetAtTime(0.018, now, 0.01);
      this.lfoGain.gain.value = depth * 0.006;
      this.feedback.gain.value = 0;
    } else {
      // flanger
      const manual = numOf(p, 'manual', 50) / 100;
      const sep = numOf(p, 'separation', 100) / 100;
      this.delay.delayTime.setTargetAtTime(0.0006 + manual * 0.008, now, 0.01);
      this.lfoGain.gain.value = depth * 0.004 * (0.3 + sep * 0.7);
      this.feedback.gain.value = (numOf(p, 'resonance', 50) / 100) * 0.85;
    }
    const lc = lowCutHz(numOf(p, 'lowCut', 0));
    const hc = highCutHz(numOf(p, 'highCut', 16));
    this.lowCut.frequency.value = lc > 0 ? lc : 20;
    this.highCut.frequency.value = hc > 0 ? hc : 20000;
    this.dLevel.gain.value = numOf(p, 'dLevel', 100) / 100;
    this.eLevel.gain.value = numOf(p, 'eLevel', 50) / 100;
  }

  protected override teardown(): void {
    this.lfo.stop();
  }
}

// ---------------------------------------------------------------------------
// TREMOLO / AUTO PAN / MANUAL PAN / STEREO ENHANCE
// ---------------------------------------------------------------------------

class TremoloUnit extends BaseUnit {
  private vca: GainNode;
  private lfo: OscillatorNode;
  private lfoGain: GainNode;

  constructor(ctx: AudioContext) {
    super(ctx, 'TREMOLO');
    this.vca = ctx.createGain();
    this.lfo = ctx.createOscillator();
    this.lfoGain = ctx.createGain();
    this.wetIn.connect(this.vca).connect(this.wetOut);
    this.lfo.connect(this.lfoGain).connect(this.vca.gain);
    this.lfo.start();
  }

  protected apply(p: ParamMap, info: FxContext): void {
    const depth = numOf(p, 'depth', 50) / 100;
    this.lfo.type = OSC_WAVE[strOf(p, 'waveform', 'TRI')] ?? 'triangle';
    this.lfo.frequency.value = rateToHz(p['rate'] as string, info.tempo, info.beatsPerMeasure);
    this.vca.gain.value = 1 - depth / 2;
    this.lfoGain.gain.value = depth / 2;
  }

  protected override teardown(): void {
    this.lfo.stop();
  }
}

class PanUnit extends BaseUnit {
  private panner: StereoPannerNode;
  private lfo: OscillatorNode | null = null;
  private lfoGain: GainNode | null = null;

  constructor(ctx: AudioContext, type: string, private auto: boolean) {
    super(ctx, type);
    this.panner = ctx.createStereoPanner();
    this.wetIn.connect(this.panner).connect(this.wetOut);
    if (auto) {
      this.lfo = ctx.createOscillator();
      this.lfoGain = ctx.createGain();
      this.lfo.connect(this.lfoGain).connect(this.panner.pan);
      this.lfo.start();
    }
  }

  protected apply(p: ParamMap, info: FxContext): void {
    if (this.auto && this.lfo && this.lfoGain) {
      this.lfo.type = OSC_WAVE[strOf(p, 'waveform', 'TRI')] ?? 'triangle';
      const rateVal = (strOf(p, 'stepRate', 'OFF') !== 'OFF' ? p['stepRate'] : p['rate']) as string;
      this.lfo.frequency.value = rateToHz(rateVal, info.tempo, info.beatsPerMeasure);
      this.lfoGain.gain.value = numOf(p, 'depth', 100) / 100;
      this.panner.pan.value = 0;
    } else {
      this.panner.pan.setTargetAtTime(numOf(p, 'position', 0) / 50, this.ctx.currentTime, 0.01);
    }
  }

  protected override teardown(): void {
    this.lfo?.stop();
  }
}

class StereoEnhanceUnit extends BaseUnit {
  private splitter: ChannelSplitterNode;
  private merger: ChannelMergerNode;
  private side: GainNode;
  private delayR: DelayNode;
  private band: BiquadFilterNode;

  constructor(ctx: AudioContext) {
    super(ctx, 'STEREO ENHANCE');
    this.splitter = ctx.createChannelSplitter(2);
    this.merger = ctx.createChannelMerger(2);
    this.side = ctx.createGain();
    this.delayR = ctx.createDelay(0.02);
    this.delayR.delayTime.value = 0.012;
    this.band = ctx.createBiquadFilter();
    this.band.type = 'highpass';
    this.band.frequency.value = 400;
    this.wetIn.connect(this.splitter);
    this.splitter.connect(this.merger, 0, 0);
    this.splitter.connect(this.merger, 1, 1);
    // A short, filtered Haas delay on the opposite channel widens the image.
    this.splitter.connect(this.band, 0);
    this.band.connect(this.delayR).connect(this.side);
    this.side.connect(this.merger, 0, 1);
    this.merger.connect(this.wetOut);
  }

  protected apply(p: ParamMap): void {
    const enhance = numOf(p, 'enhance', 50) / 100;
    this.side.gain.value = enhance * 0.7;
    const lc = lowCutHz(numOf(p, 'lowCut', 0));
    this.band.frequency.value = lc > 0 ? lc : 200;
    if (strOf(p, 'flat', 'OFF') === 'ON') this.band.frequency.value = 20;
  }
}

// ---------------------------------------------------------------------------
// EQ / DYNAMICS / PREAMP / DIST / SUSTAINER
// ---------------------------------------------------------------------------

class EqUnit extends InsertUnit {
  private lo: BiquadFilterNode;
  private loMid: BiquadFilterNode;
  private hiMid: BiquadFilterNode;
  private hi: BiquadFilterNode;
  private level: GainNode;

  constructor(ctx: AudioContext) {
    super(ctx, 'EQ');
    this.lo = ctx.createBiquadFilter();
    this.lo.type = 'lowshelf';
    this.lo.frequency.value = 200;
    this.loMid = ctx.createBiquadFilter();
    this.loMid.type = 'peaking';
    this.hiMid = ctx.createBiquadFilter();
    this.hiMid.type = 'peaking';
    this.hi = ctx.createBiquadFilter();
    this.hi.type = 'highshelf';
    this.hi.frequency.value = 4000;
    this.level = ctx.createGain();
    this.wetIn.connect(this.lo).connect(this.loMid).connect(this.hiMid).connect(this.hi).connect(this.level);
    this.level.connect(this.wetOut);
  }

  protected apply(p: ParamMap): void {
    this.lo.gain.value = numOf(p, 'lo', 0);
    this.loMid.gain.value = numOf(p, 'loMid', 0);
    this.loMid.frequency.value = numOf(p, 'loMidFreq', 400);
    this.loMid.Q.value = Math.max(0.3, numOf(p, 'loMidQ', 1));
    this.hiMid.gain.value = numOf(p, 'hiMid', 0);
    this.hiMid.frequency.value = numOf(p, 'hiMidFreq', 1600);
    this.hiMid.Q.value = Math.max(0.3, numOf(p, 'hiMidQ', 1));
    this.hi.gain.value = numOf(p, 'high', 0);
    this.level.gain.value = Math.pow(10, numOf(p, 'level', 0) / 20);
  }
}

const COMP_PRESETS: Record<string, { threshold: number; ratio: number; attack: number; release: number; gain: number }> = {
  'NATURAL COMP': { threshold: -22, ratio: 3, attack: 0.01, release: 0.15, gain: 1.4 },
  'MIXER COMP': { threshold: -18, ratio: 4, attack: 0.006, release: 0.12, gain: 1.5 },
  'LIVE COMP': { threshold: -20, ratio: 3.5, attack: 0.012, release: 0.2, gain: 1.4 },
  'HARD COMP': { threshold: -28, ratio: 8, attack: 0.003, release: 0.1, gain: 2.2 },
  'SOFT COMP': { threshold: -16, ratio: 2, attack: 0.02, release: 0.25, gain: 1.2 },
  'CLEAN COMP': { threshold: -14, ratio: 2.5, attack: 0.015, release: 0.18, gain: 1.25 },
  'DANCE COMP': { threshold: -24, ratio: 6, attack: 0.004, release: 0.08, gain: 1.9 },
  'ORCH COMP': { threshold: -12, ratio: 1.8, attack: 0.03, release: 0.3, gain: 1.15 },
  VOX: { threshold: -24, ratio: 4, attack: 0.008, release: 0.16, gain: 1.7 },
};

class DynamicsUnit extends InsertUnit {
  private comp: DynamicsCompressorNode;
  private makeup: GainNode;

  constructor(ctx: AudioContext) {
    super(ctx, 'DYNAMICS');
    this.comp = ctx.createDynamicsCompressor();
    this.makeup = ctx.createGain();
    this.wetIn.connect(this.comp).connect(this.makeup).connect(this.wetOut);
  }

  protected apply(p: ParamMap): void {
    const preset = COMP_PRESETS[strOf(p, 'type', 'NATURAL COMP')] ?? COMP_PRESETS['NATURAL COMP'];
    const amount = numOf(p, 'dynamics', 0) / 50; // -1 .. +1
    this.comp.threshold.value = preset.threshold - amount * 12;
    this.comp.ratio.value = Math.max(1, preset.ratio + amount * 4);
    this.comp.attack.value = preset.attack;
    this.comp.release.value = preset.release;
    this.comp.knee.value = 6;
    this.makeup.gain.value = preset.gain * (1 + amount * 0.4);
  }
}

class SustainerUnit extends InsertUnit {
  private comp: DynamicsCompressorNode;
  private low: BiquadFilterNode;
  private high: BiquadFilterNode;
  private level: GainNode;

  constructor(ctx: AudioContext) {
    super(ctx, 'SUSTAINER');
    this.comp = ctx.createDynamicsCompressor();
    this.low = ctx.createBiquadFilter();
    this.low.type = 'lowshelf';
    this.low.frequency.value = 200;
    this.high = ctx.createBiquadFilter();
    this.high.type = 'highshelf';
    this.high.frequency.value = 4000;
    this.level = ctx.createGain();
    this.wetIn.connect(this.comp).connect(this.low).connect(this.high).connect(this.level).connect(this.wetOut);
  }

  protected apply(p: ParamMap): void {
    const sustain = numOf(p, 'sustain', 50) / 100;
    this.comp.threshold.value = -12 - sustain * 36;
    this.comp.ratio.value = 2 + sustain * 14;
    this.comp.attack.value = 0.001 + (numOf(p, 'attack', 50) / 100) * 0.05;
    this.comp.release.value = 0.05 + (numOf(p, 'release', 50) / 100) * 0.5;
    this.low.gain.value = numOf(p, 'lowGain', 0);
    this.high.gain.value = numOf(p, 'hiGain', 0);
    this.level.gain.value = 0.4 + (numOf(p, 'level', 50) / 100) * 1.6;
  }
}

function makeCurve(shape: (x: number) => number, n = 2048): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(new ArrayBuffer(n * 4));
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.max(-1, Math.min(1, shape(x)));
  }
  return curve;
}

const DIST_SHAPES: Record<string, (drive: number) => (x: number) => number> = {
  'MILD DS': (d) => (x) => Math.tanh(x * (1 + d * 8)),
  'NATURAL DS': (d) => (x) => Math.tanh(x * (1 + d * 14)) * 0.9,
  'HARD DS': (d) => (x) => Math.max(-0.8, Math.min(0.8, x * (1 + d * 25))),
  'TURBO DS': (d) => (x) => Math.tanh(x * (1 + d * 40)) * 0.95,
  'FAT DS': (d) => (x) => Math.tanh(x * (1 + d * 18)) + 0.1 * Math.tanh(x * 3),
  FUZZ: (d) => (x) => Math.sign(x) * Math.pow(Math.abs(Math.tanh(x * (1 + d * 60))), 0.7),
  'OCT FUZZ': (d) => (x) => Math.sign(x) * Math.pow(Math.abs(Math.tanh(x * (1 + d * 45))), 0.6) * 0.8 + Math.abs(x) * 0.4,
};

class DistUnit extends BaseUnit {
  private pre: BiquadFilterNode;
  private shaper: WaveShaperNode;
  private tone: BiquadFilterNode;
  private eLevel: GainNode;
  private dLevel: GainNode;

  constructor(ctx: AudioContext, type = 'DIST') {
    super(ctx, type);
    this.pre = ctx.createBiquadFilter();
    this.pre.type = 'highpass';
    this.pre.frequency.value = 60;
    this.shaper = ctx.createWaveShaper();
    this.shaper.oversample = '4x';
    this.tone = ctx.createBiquadFilter();
    this.tone.type = 'lowpass';
    this.tone.frequency.value = 4000;
    this.eLevel = ctx.createGain();
    this.dLevel = ctx.createGain();
    this.wetIn.connect(this.pre).connect(this.shaper).connect(this.tone).connect(this.eLevel).connect(this.wetOut);
    this.wetIn.connect(this.dLevel).connect(this.wetOut);
  }

  protected apply(p: ParamMap): void {
    const drive = numOf(p, 'dist', 50) / 100;
    const shape = DIST_SHAPES[strOf(p, 'type', 'MILD DS')] ?? DIST_SHAPES['MILD DS'];
    this.shaper.curve = makeCurve(shape(drive));
    const tone = numOf(p, 'tone', 0);
    this.tone.frequency.value = 1200 * Math.pow(2, tone / 18);
    this.eLevel.gain.value = numOf(p, 'eLevel', 50) / 100;
    this.dLevel.gain.value = numOf(p, 'dLevel', 0) / 100;
  }
}

const AMP_VOICING: Record<string, { drive: number; low: number; mid: number; high: number; cab: number }> = {
  NATURAL: { drive: 4, low: 0, mid: 0, high: 0, cab: 6000 },
  BOUTIQUE: { drive: 8, low: 1, mid: 2, high: 1, cab: 5500 },
  STACK: { drive: 14, low: 3, mid: -2, high: 3, cab: 5000 },
  HiGAIN: { drive: 26, low: 4, mid: -4, high: 4, cab: 4600 },
  'POWER DRIVE': { drive: 20, low: 3, mid: 1, high: 2, cab: 4800 },
  EXTREME: { drive: 40, low: 5, mid: -6, high: 5, cab: 4200 },
  'CORE METAL': { drive: 55, low: 6, mid: -8, high: 6, cab: 4000 },
};

class PreampUnit extends BaseUnit {
  private shaper: WaveShaperNode;
  private bass: BiquadFilterNode;
  private mid: BiquadFilterNode;
  private treble: BiquadFilterNode;
  private presence: BiquadFilterNode;
  private cab: BiquadFilterNode;
  private level: GainNode;
  private drive: GainNode;

  constructor(ctx: AudioContext) {
    super(ctx, 'PREAMP');
    this.drive = ctx.createGain();
    this.shaper = ctx.createWaveShaper();
    this.shaper.oversample = '4x';
    this.bass = ctx.createBiquadFilter();
    this.bass.type = 'lowshelf';
    this.bass.frequency.value = 150;
    this.mid = ctx.createBiquadFilter();
    this.mid.type = 'peaking';
    this.mid.frequency.value = 800;
    this.mid.Q.value = 0.8;
    this.treble = ctx.createBiquadFilter();
    this.treble.type = 'highshelf';
    this.treble.frequency.value = 3000;
    this.presence = ctx.createBiquadFilter();
    this.presence.type = 'peaking';
    this.presence.frequency.value = 5000;
    this.presence.Q.value = 1.2;
    this.cab = ctx.createBiquadFilter();
    this.cab.type = 'lowpass';
    this.cab.frequency.value = 5000;
    this.level = ctx.createGain();
    this.wetIn
      .connect(this.drive)
      .connect(this.shaper)
      .connect(this.bass)
      .connect(this.mid)
      .connect(this.treble)
      .connect(this.presence)
      .connect(this.cab)
      .connect(this.level)
      .connect(this.wetOut);
  }

  protected apply(p: ParamMap): void {
    const amp = AMP_VOICING[strOf(p, 'ampType', 'NATURAL')] ?? AMP_VOICING.NATURAL;
    const gain = numOf(p, 'gain', 50) / 120;
    this.drive.gain.value = 1 + gain * amp.drive;
    this.shaper.curve = makeCurve((x) => Math.tanh(x * 1.6) * 0.9);
    this.bass.gain.value = amp.low + (numOf(p, 'bass', 50) - 50) / 4;
    this.mid.gain.value = amp.mid + (numOf(p, 'middle', 50) - 50) / 4;
    this.treble.gain.value = amp.high + (numOf(p, 'treble', 50) - 50) / 4;
    this.presence.gain.value = (numOf(p, 'presence', 50) - 50) / 5;
    const spk = strOf(p, 'spkType', 'ORIGIN');
    this.cab.frequency.value = spk === 'OFF' ? 20000 : amp.cab * (spk.startsWith('1x8') ? 0.7 : 1);
    this.level.gain.value = (numOf(p, 'eLevel', 50) / 100) * 0.9;
  }
}

// ---------------------------------------------------------------------------
// Delays
// ---------------------------------------------------------------------------

class DelayUnit extends BaseUnit {
  private delay: DelayNode;
  private fb: GainNode;
  private eLevel: GainNode;
  private dLevel: GainNode;
  private lowCut: BiquadFilterNode;
  private highCut: BiquadFilterNode;
  private panL: StereoPannerNode | null = null;
  private mod: OscillatorNode | null = null;
  private modGain: GainNode | null = null;
  private wow: OscillatorNode | null = null;
  private wowGain: GainNode | null = null;
  private taps: { delay: DelayNode; gain: GainNode }[] = [];
  private shifter: AudioWorkletNode | null = null;

  constructor(
    ctx: AudioContext,
    type: string,
    private variant: 'delay' | 'panning' | 'mod' | 'tape' | 'tape2' | 'granular',
    shifter?: AudioWorkletNode,
  ) {
    super(ctx, type);
    this.delay = ctx.createDelay(2.2);
    this.fb = ctx.createGain();
    this.eLevel = ctx.createGain();
    this.dLevel = ctx.createGain();
    this.lowCut = ctx.createBiquadFilter();
    this.lowCut.type = 'highpass';
    this.lowCut.frequency.value = 20;
    this.highCut = ctx.createBiquadFilter();
    this.highCut.type = 'lowpass';
    this.highCut.frequency.value = 20000;

    this.wetIn.connect(this.dLevel).connect(this.wetOut);
    this.wetIn.connect(this.delay);
    this.delay.connect(this.lowCut).connect(this.highCut);

    let tail: AudioNode = this.highCut;
    if (variant === 'granular' && shifter) {
      this.shifter = shifter;
      this.highCut.connect(shifter);
      tail = shifter;
    }

    if (variant === 'panning') {
      this.panL = ctx.createStereoPanner();
      this.panL.pan.value = -0.8;
      tail.connect(this.panL).connect(this.eLevel);
      const alt = ctx.createStereoPanner();
      alt.pan.value = 0.8;
      const alt2 = ctx.createDelay(2.2);
      tail.connect(alt2);
      alt2.connect(alt).connect(this.eLevel);
      this.taps.push({ delay: alt2, gain: this.eLevel });
    } else if (variant === 'tape2') {
      // Multi-head tape echo: three taps at 1×, 2× and 3× the base time.
      for (let i = 0; i < 3; i++) {
        const d = ctx.createDelay(2.2);
        const g = ctx.createGain();
        tail.connect(d).connect(g).connect(this.eLevel);
        this.taps.push({ delay: d, gain: g });
      }
    } else {
      tail.connect(this.eLevel);
    }
    this.eLevel.connect(this.wetOut);
    tail.connect(this.fb).connect(this.delay);

    if (variant === 'mod') {
      this.mod = ctx.createOscillator();
      this.modGain = ctx.createGain();
      this.mod.connect(this.modGain).connect(this.delay.delayTime);
      this.mod.start();
    }
    if (variant === 'tape' || variant === 'tape2') {
      this.wow = ctx.createOscillator();
      this.wow.frequency.value = 4.2;
      this.wowGain = ctx.createGain();
      this.wow.connect(this.wowGain).connect(this.delay.delayTime);
      this.wow.start();
    }
  }

  protected apply(p: ParamMap, info: FxContext): void {
    const now = this.ctx.currentTime;
    const timeMs = numOf(p, 'time', 500);
    const time = Math.min(2, timeMs / 1000);
    this.delay.delayTime.setTargetAtTime(time, now, 0.02);
    this.fb.gain.value = Math.min(0.95, (numOf(p, 'feedback', 50) / 100) * 0.95);
    this.dLevel.gain.value = numOf(p, 'dLevel', 100) / 100;
    this.eLevel.gain.value = numOf(p, 'eLevel', 50) / 100;

    if (this.variant === 'tape' || this.variant === 'tape2') {
      const bass = numOf(p, 'bass', 0);
      const treble = numOf(p, 'treble', -10);
      this.lowCut.frequency.value = 120 * Math.pow(2, -bass / 25);
      this.highCut.frequency.value = 3500 * Math.pow(2, treble / 25);
      if (this.wowGain) this.wowGain.gain.value = (numOf(p, 'wow', 20) / 100) * 0.004;
      if (this.variant === 'tape2') {
        const head = strOf(p, 'head', 'S+M');
        const on = [head.includes('S'), head.includes('M'), head.includes('L')];
        this.taps.forEach((t, i) => {
          t.delay.delayTime.setTargetAtTime(time * (i + 1) * 0.5, now, 0.02);
          t.gain.gain.value = on[i] ? 1 / (i + 1.2) : 0;
        });
      }
    } else {
      const lc = lowCutHz(numOf(p, 'lowCut', 0));
      const hc = highCutHz(numOf(p, 'highCut', 12));
      this.lowCut.frequency.value = lc > 0 ? lc : 20;
      this.highCut.frequency.value = hc > 0 ? hc : 20000;
    }

    if (this.variant === 'panning' && this.taps[0]) {
      this.taps[0].delay.delayTime.setTargetAtTime(time / 2, now, 0.02);
    }
    if (this.variant === 'mod' && this.mod && this.modGain) {
      this.mod.frequency.value = rateToHz(p['modRate'] as string, info.tempo, info.beatsPerMeasure);
      this.modGain.gain.value = (numOf(p, 'modDepth', 40) / 100) * 0.003;
    }
    if (this.variant === 'granular' && this.shifter) {
      this.shifter.parameters.get('semitones')!.value = numOf(p, 'pitch', 12);
    }
  }

  protected override teardown(): void {
    this.mod?.stop();
    this.wow?.stop();
  }
}

// ---------------------------------------------------------------------------
// Reverbs
// ---------------------------------------------------------------------------

function reverbImpulse(
  ctx: AudioContext,
  seconds: number,
  density: number,
  kind: 'hall' | 'gate' | 'reverse',
): AudioBuffer {
  const sr = ctx.sampleRate;
  const len = Math.max(1, Math.ceil(seconds * sr));
  const buf = ctx.createBuffer(2, len, sr);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) {
      const t = i / len;
      let env: number;
      if (kind === 'gate') env = t < 0.85 ? 1 : Math.max(0, 1 - (t - 0.85) / 0.15);
      else if (kind === 'reverse') env = t;
      else env = Math.pow(1 - t, 1.8 + (1 - density) * 2);
      // Sparser early reflections at low density.
      const thin = density < 0.9 && i > sr * 0.01 ? (Math.random() < 0.3 + density * 0.7 ? 1 : 0) : 1;
      d[i] = (Math.random() * 2 - 1) * env * thin;
    }
  }
  return buf;
}

class ReverbUnit extends BaseUnit {
  private conv: ConvolverNode;
  private preDelay: DelayNode;
  private eLevel: GainNode;
  private dLevel: GainNode;
  private lowCut: BiquadFilterNode;
  private highCut: BiquadFilterNode;
  private lastKey = '';

  constructor(ctx: AudioContext, type: string, private kind: 'hall' | 'gate' | 'reverse') {
    super(ctx, type);
    this.conv = ctx.createConvolver();
    this.preDelay = ctx.createDelay(0.5);
    this.eLevel = ctx.createGain();
    this.dLevel = ctx.createGain();
    this.lowCut = ctx.createBiquadFilter();
    this.lowCut.type = 'highpass';
    this.lowCut.frequency.value = 20;
    this.highCut = ctx.createBiquadFilter();
    this.highCut.type = 'lowpass';
    this.highCut.frequency.value = 20000;
    this.wetIn.connect(this.dLevel).connect(this.wetOut);
    this.wetIn.connect(this.preDelay).connect(this.lowCut).connect(this.highCut).connect(this.conv);
    this.conv.connect(this.eLevel).connect(this.wetOut);
  }

  protected apply(p: ParamMap): void {
    const time = numOf(p, 'time', 40);
    const density = numOf(p, 'density', 5) / 10;
    const seconds = 0.15 + (time / 100) * 4.5;
    const key = `${Math.round(seconds * 20)}|${Math.round(density * 10)}`;
    if (key !== this.lastKey) {
      this.conv.buffer = reverbImpulse(this.ctx, seconds, density, this.kind);
      this.lastKey = key;
    }
    this.preDelay.delayTime.value = Math.min(0.4, numOf(p, 'preDelay', 0) / 1000);
    const lc = lowCutHz(numOf(p, 'lowCut', 0));
    const hc = highCutHz(numOf(p, 'highCut', 14));
    this.lowCut.frequency.value = lc > 0 ? lc : 20;
    this.highCut.frequency.value = hc > 0 ? hc : 20000;
    this.dLevel.gain.value = numOf(p, 'dLevel', 100) / 100;
    this.eLevel.gain.value = (numOf(p, 'eLevel', 50) / 100) * 1.6;
  }
}

// ---------------------------------------------------------------------------
// Slicers — 16-step gate patterns scheduled a cycle ahead
// ---------------------------------------------------------------------------

const SLICER_PATTERNS: number[][] = [
  [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0],
  [1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0],
  [1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 1, 0],
  [1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 0],
  [1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 1, 1, 0, 1, 0, 1],
  [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
  [1, 1, 0, 1, 1, 0, 1, 1, 0, 1, 1, 0, 1, 0, 1, 0],
  [1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1],
  [1, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0],
  [1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1],
  [1, 1, 0, 0, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 1, 0],
  [1, 0, 1, 0, 1, 1, 0, 0, 1, 0, 1, 0, 1, 1, 0, 0],
  [0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1],
  [1, 1, 1, 0, 0, 1, 1, 0, 1, 0, 1, 1, 0, 0, 1, 0],
  [1, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0],
  [1, 1, 0, 1, 0, 1, 1, 0, 1, 1, 0, 1, 0, 1, 1, 0],
  [1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1],
  [1, 1, 1, 1, 1, 0, 1, 0, 1, 1, 1, 1, 1, 0, 1, 0],
  [1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1],
  [1, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0],
];

class SlicerUnit extends BaseUnit {
  private vca: GainNode;
  private comp: DynamicsCompressorNode;
  private nextCycle = 0;
  private steps: number[] = SLICER_PATTERNS[0];
  private stepCount = 16;

  constructor(ctx: AudioContext, type: string, private stepMode: boolean) {
    super(ctx, type);
    this.vca = ctx.createGain();
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = 0;
    this.wetIn.connect(this.comp).connect(this.vca).connect(this.wetOut);
  }

  protected apply(p: ParamMap): void {
    if (this.stepMode) {
      this.stepCount = Math.max(1, Math.round(numOf(p, 'stepMax', 8)));
      const on = Math.max(1, Math.round(numOf(p, 'stepLength', 8)));
      const lvl = numOf(p, 'stepLevel', 100) / 100;
      this.steps = Array.from({ length: this.stepCount }, (_, i) => (i < on ? 1 : lvl));
    } else {
      const idx = Math.max(1, Math.min(20, Math.round(numOf(p, 'pattern', 1)))) - 1;
      this.steps = SLICER_PATTERNS[idx];
      this.stepCount = 16;
    }
    const thr = numOf(p, 'compThreshold', 0);
    this.comp.threshold.value = -thr / 2;
    this.comp.ratio.value = 1 + (thr / 100) * 8;
  }

  protected override onActive(on: boolean, time: number): void {
    if (on) this.nextCycle = Math.max(time, this.ctx.currentTime);
    else {
      this.vca.gain.cancelScheduledValues(this.ctx.currentTime);
      this.vca.gain.setTargetAtTime(1, this.ctx.currentTime, 0.005);
    }
  }

  tick(now: number, info: FxContext): void {
    if (!this.active) return;
    const cycle = rateToSeconds(this.params['rate'] as string, info.tempo, info.beatsPerMeasure);
    const depth = numOf(this.params, 'depth', 100) / 100;
    const duty = this.stepMode ? 0.5 : numOf(this.params, 'duty', 50) / 100;
    const attack = 0.0005 + (numOf(this.params, 'attack', 20) / 100) * 0.02;
    if (this.nextCycle < now) this.nextCycle = now;
    let guard = 0;
    while (this.nextCycle < now + 0.3 && guard++ < 8) {
      const stepDur = cycle / this.stepCount;
      for (let s = 0; s < this.stepCount; s++) {
        const t = this.nextCycle + s * stepDur;
        if (t < this.ctx.currentTime) continue;
        const level = this.steps[s] ?? 1;
        const openTo = 1 - depth * (1 - level);
        this.vca.gain.setTargetAtTime(openTo, t, attack);
        if (level > 0 && duty < 0.98) {
          this.vca.gain.setTargetAtTime(1 - depth, t + stepDur * duty, attack);
        }
      }
      this.nextCycle += cycle;
    }
  }
}

// ---------------------------------------------------------------------------
// Worklet-backed units
// ---------------------------------------------------------------------------

class WorkletUnit extends BaseUnit {
  constructor(
    ctx: AudioContext,
    type: string,
    protected node: AudioWorkletNode,
    private applyFn: (node: AudioWorkletNode, p: ParamMap, info: FxContext, ctx: AudioContext) => void,
    private onActiveFn?: (node: AudioWorkletNode, on: boolean) => void,
  ) {
    super(ctx, type);
    this.wetIn.connect(this.node).connect(this.wetOut);
  }

  protected apply(p: ParamMap, info: FxContext): void {
    this.applyFn(this.node, p, info, this.ctx);
  }

  protected override onActive(on: boolean): void {
    this.onActiveFn?.(this.node, on);
  }

  protected override teardown(): void {
    this.node.disconnect();
  }
}

/** PITCH-shift based units (OCTAVE, TRANSPOSE, ROBOT, G2B, HRM MANUAL …). */
class PitchUnit extends BaseUnit {
  private shifter: AudioWorkletNode;
  private wet: GainNode;
  private dry2: GainNode;
  private panner: StereoPannerNode;

  constructor(ctx: AudioContext, type: string, shifter: AudioWorkletNode, private mode: string) {
    super(ctx, type);
    this.shifter = shifter;
    this.wet = ctx.createGain();
    this.dry2 = ctx.createGain();
    this.panner = ctx.createStereoPanner();
    this.wetIn.connect(this.shifter).connect(this.panner).connect(this.wet).connect(this.wetOut);
    this.wetIn.connect(this.dry2).connect(this.wetOut);
    this.shifter.parameters.get('mix')!.value = 1;
  }

  protected apply(p: ParamMap): void {
    const semi = this.shifter.parameters.get('semitones')!;
    const now = this.ctx.currentTime;
    let value = 0;
    let dry = 0;
    let wet = 1;
    switch (this.mode) {
      case 'octave':
        value = strOf(p, 'octave', '-1OCT') === '-2OCT' ? -24 : -12;
        dry = 1;
        wet = numOf(p, 'octLevel', 50) / 100;
        break;
      case 'transpose':
        value = numOf(p, 'trans', 0);
        break;
      case 'pitchbend': {
        const target = { '-3OCT': -36, '-2OCT': -24, '-1OCT': -12, '+1OCT': 12, '+2OCT': 24, '+3OCT': 36, '+4OCT': 48 }[
          strOf(p, 'pitch', '+1OCT')
        ] ?? 12;
        value = (target * numOf(p, 'bend', 50)) / 100;
        break;
      }
      case 'g2b':
        value = -12;
        dry = 1 - numOf(p, 'balance', 50) / 100;
        wet = numOf(p, 'balance', 50) / 100;
        break;
      case 'electric':
        value = numOf(p, 'shift', 0);
        break;
      case 'robot':
        // Fixed-pitch robot voice: pull everything to the selected note.
        value = 0;
        break;
      case 'harmony': {
        const v = strOf(p, 'voice', '+3RD');
        value =
          { 'OCT-': -12, '-6TH': -9, '-5TH': -7, '-4TH': -5, '-3RD': -4, UNISON: 0, '+3RD': 4, '+4TH': 5, '+5TH': 7, '+6TH': 9, 'OCT+': 12 }[
            v
          ] ?? 4;
        dry = numOf(p, 'dLevel', 100) / 100;
        wet = numOf(p, 'hrmLevel', 80) / 100;
        this.panner.pan.value = numOf(p, 'pan', 0) / 50;
        break;
      }
      default:
        value = 0;
    }
    semi.setTargetAtTime(value, now, 0.01);
    this.dry2.gain.value = dry;
    this.wet.gain.value = wet;
  }

  protected override teardown(): void {
    this.shifter.disconnect();
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createFxUnit(ctx: AudioContext, typeName: string, workletsReady: boolean): FxUnit {
  const t = fxType(typeName);
  const wl = (name: string, options?: AudioWorkletNodeOptions): AudioWorkletNode =>
    new AudioWorkletNode(ctx, name, { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], ...options });

  if (!workletsReady) {
    // Fall back to a transparent unit if the worklet module failed to load.
    return new (class extends BaseUnit {
      constructor() {
        super(ctx, typeName);
        this.wetIn.connect(this.wetOut);
      }
      protected apply(): void {}
    })();
  }

  switch (t.dsp) {
    case 'lpf':
      return new FilterUnit(ctx, t.name, 'lowpass');
    case 'bpf':
      return new FilterUnit(ctx, t.name, 'bandpass');
    case 'hpf':
      return new FilterUnit(ctx, t.name, 'highpass');
    case 'isolator':
      return new IsolatorUnit(ctx);
    case 'phaser':
      return new ModUnit(ctx, t.name, 'phaser');
    case 'flanger':
      return new ModUnit(ctx, t.name, 'flanger');
    case 'chorus':
      return new ModUnit(ctx, t.name, 'chorus');
    case 'vibrato':
      return new ModUnit(ctx, t.name, 'vibrato');
    case 'tremolo':
      return new TremoloUnit(ctx);
    case 'autopan':
      return new PanUnit(ctx, t.name, true);
    case 'manualpan':
      return new PanUnit(ctx, t.name, false);
    case 'stereoenhance':
      return new StereoEnhanceUnit(ctx);
    case 'eq':
      return new EqUnit(ctx);
    case 'dynamics':
      return new DynamicsUnit(ctx);
    case 'sustainer':
      return new SustainerUnit(ctx);
    case 'dist':
      return new DistUnit(ctx, t.name);
    case 'preamp':
      return new PreampUnit(ctx);
    case 'delay':
      return new DelayUnit(ctx, t.name, 'delay');
    case 'panningdelay':
      return new DelayUnit(ctx, t.name, 'panning');
    case 'moddelay':
      return new DelayUnit(ctx, t.name, 'mod');
    case 'tapeecho':
      return new DelayUnit(ctx, t.name, 'tape');
    case 'tapeecho2':
      return new DelayUnit(ctx, t.name, 'tape2');
    case 'granulardelay':
      return new DelayUnit(ctx, t.name, 'granular', wl('pitch-shift', { processorOptions: { grain: 1536 } }));
    case 'reverb':
      return new ReverbUnit(ctx, t.name, 'hall');
    case 'gatereverb':
      return new ReverbUnit(ctx, t.name, 'gate');
    case 'reversereverb':
      return new ReverbUnit(ctx, t.name, 'reverse');
    case 'patternslicer':
      return new SlicerUnit(ctx, t.name, false);
    case 'stepslicer':
      return new SlicerUnit(ctx, t.name, true);
    case 'octave':
    case 'transpose':
    case 'pitchbend':
    case 'g2b':
    case 'electric':
    case 'robot':
    case 'harmony':
    case 'harmony-midi':
      return new PitchUnit(ctx, t.name, wl('pitch-shift'), t.dsp === 'harmony-midi' ? 'harmony' : t.dsp);
    case 'lofi':
      return new WorkletUnit(ctx, t.name, wl('lofi-fx'), (node, p) => {
        const bitStr = strOf(p, 'bitDepth', '8');
        const bits = bitStr === 'OFF' ? 0 : Number(bitStr);
        const srStr = strOf(p, 'sampleRate', '1/4');
        const divide = srStr === 'OFF' ? 1 : Number(srStr.split('/')[1] ?? 1);
        node.port.postMessage({ bits, divide, noise: 0 });
      });
    case 'radio':
      return new WorkletUnit(ctx, t.name, wl('lofi-fx'), (node, p) => {
        const lofi = numOf(p, 'lofi', 5);
        node.port.postMessage({ bits: 12 - lofi, divide: 1 + Math.round(lofi / 2), noise: lofi / 10 });
      });
    case 'ringmod':
      return new WorkletUnit(ctx, t.name, wl('ringmod-fx'), (node, p) => {
        node.parameters.get('frequency')!.value = 20 * Math.pow(200, numOf(p, 'frequency', 50) / 100);
        node.parameters.get('balance')!.value = numOf(p, 'balance', 50) / 100;
        node.port.postMessage({ mode: Number(strOf(p, 'mode', '2')) });
      });
    case 'slowgear':
      return new WorkletUnit(ctx, t.name, wl('slowgear-fx'), (node, p) => {
        node.port.postMessage({
          sens: numOf(p, 'sens', 50) / 100,
          riseTime: 0.02 + (numOf(p, 'riseTime', 50) / 100) * 1.2,
          level: 0.5 + (numOf(p, 'level', 50) / 100) * 1.2,
        });
      });
    case 'vocoder':
    case 'oscvoc':
    case 'oscbot': {
      const follow = t.dsp === 'vocoder';
      return new WorkletUnit(ctx, t.name, wl('vocoder-fx', { processorOptions: { follow } }), (node, p) => {
        const noteIdx = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'].indexOf(strOf(p, 'note', 'C'));
        const octave = numOf(p, 'octave', 0);
        node.port.postMessage({
          carrierType: strOf(p, 'carrier', strOf(p, 'osc', 'SAW')),
          tone: numOf(p, 'tone', 0),
          attack: 0.002 + (numOf(p, 'attack', 20) / 100) * 0.08,
          release: 0.02 + (numOf(p, 'release', 30) / 100) * 0.3,
          modSens: numOf(p, 'modSens', 50) / 100,
          balance: numOf(p, 'balance', 100) / 100,
          carrierThru: strOf(p, 'carrierThru', 'OFF') === 'ON',
          frequency: 130.81 * Math.pow(2, (noteIdx >= 0 ? noteIdx : 0) / 12) * Math.pow(2, octave),
          follow,
        });
      });
    }
    case 'synth':
      return new WorkletUnit(ctx, t.name, wl('synth-fx'), (node, p) => {
        node.port.postMessage({
          frequency: numOf(p, 'frequency', 50) / 100,
          resonance: numOf(p, 'resonance', 50) / 100,
          decay: numOf(p, 'decay', 50) / 100,
          balance: numOf(p, 'balance', 50) / 100,
        });
      });
    case 'autoriff':
      // Riff generation follows the input pitch through the synth voice.
      return new WorkletUnit(ctx, t.name, wl('synth-fx'), (node, p) => {
        node.port.postMessage({
          frequency: 0.5,
          resonance: 0.4,
          decay: 0.2 + (numOf(p, 'attack', 50) / 100) * 0.4,
          balance: numOf(p, 'balance', 50) / 100,
        });
      });
    case 'roll':
    case 'roll2':
    case 'beatrepeat':
    case 'beatscatter':
    case 'beatshift':
    case 'freeze':
    case 'warp':
    case 'reversedelay': {
      const mode =
        t.dsp === 'beatrepeat'
          ? 'roll'
          : t.dsp === 'beatscatter'
            ? 'scatter'
            : t.dsp === 'beatshift'
              ? 'shift'
              : t.dsp === 'reversedelay'
                ? 'reverse'
                : t.dsp;
      return new WorkletUnit(
        ctx,
        t.name,
        wl('beat-fx', { processorOptions: { mode } }),
        (node, p, info) => {
          const rateVal = (p['time'] ?? p['length'] ?? p['shift'] ?? '♬') as string;
          const seconds =
            t.dsp === 'reversedelay'
              ? Math.min(2, numOf(p, 'time', 500) / 1000)
              : t.dsp === 'freeze' || t.dsp === 'warp'
                ? 0.12
                : rateToSeconds(rateVal, info.tempo, info.beatsPerMeasure);
          node.port.postMessage({
            lengthSamples: Math.round(seconds * ctx.sampleRate),
            feedback: numOf(p, 'feedback', 80) / 100,
            balance: numOf(p, 'balance', 100) / 100,
            pattern: strOf(p, 'type', 'P1'),
            level: numOf(p, 'level', 80) / 100,
          });
        },
        (node, on) => node.port.postMessage({ active: on }),
      );
    }
    case 'twist':
      return new (class extends BaseUnit {
        private vca = ctx.createGain();
        private comp = ctx.createDynamicsCompressor();
        constructor() {
          super(ctx, t.name);
          this.wetIn.connect(this.comp).connect(this.vca).connect(this.wetOut);
        }
        protected apply(p: ParamMap): void {
          this.comp.threshold.value = -30 - (numOf(p, 'level', 50) / 100) * 20;
          this.comp.ratio.value = 12;
        }
        protected override onActive(on: boolean, time: number): void {
          // Squeeze on, then burst out — the TWIST gesture.
          const rise = 0.05 + (numOf(this.params, 'rise', 50) / 100) * 1.2;
          const fall = 0.05 + (numOf(this.params, 'fall', 50) / 100) * 1.2;
          const g = this.vca.gain;
          g.cancelScheduledValues(time);
          if (on) {
            g.setValueAtTime(1, time);
            g.linearRampToValueAtTime(0.05, time + rise);
            g.linearRampToValueAtTime(1.6, time + rise + 0.02);
            g.linearRampToValueAtTime(1, time + rise + 0.12);
          } else {
            g.setTargetAtTime(1, time, fall / 3);
          }
        }
      })();
    case 'vinylflick':
      return new (class extends BaseUnit {
        private noise = ctx.createGain();
        constructor() {
          super(ctx, t.name);
          this.wetIn.connect(this.wetOut);
          // Needle-flick clicks are generated as short filtered noise bursts.
          this.noise.connect(this.wetOut);
        }
        protected apply(): void {}
        protected override onActive(on: boolean, time: number): void {
          if (!on) return;
          const amount = numOf(this.params, 'flick', 50) / 100;
          const count = 1 + Math.round(amount * 4);
          for (let i = 0; i < count; i++) {
            const src = ctx.createBufferSource();
            const b = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * 0.02), ctx.sampleRate);
            const d = b.getChannelData(0);
            for (let k = 0; k < d.length; k++) d[k] = (Math.random() * 2 - 1) * Math.pow(1 - k / d.length, 4);
            src.buffer = b;
            const hp = ctx.createBiquadFilter();
            hp.type = 'bandpass';
            hp.frequency.value = 2500 + Math.random() * 3000;
            const g = ctx.createGain();
            g.gain.value = 0.25 + amount * 0.5;
            src.connect(hp).connect(g).connect(this.noise);
            src.start(time + i * 0.035 * Math.random());
          }
        }
      })();
    default:
      return new (class extends BaseUnit {
        constructor() {
          super(ctx, typeName);
          this.wetIn.connect(this.wetOut);
        }
        protected apply(): void {}
      })();
  }
}

/** Convenience: apply a whole slot definition to a unit. */
export function applySlot(unit: FxUnit, slot: FxSlotSettings, info: FxContext, time: number): void {
  unit.setParams(slot.params, info);
  unit.setActive(slot.sw, time);
}
