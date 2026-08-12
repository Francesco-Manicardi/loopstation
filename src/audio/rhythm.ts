/**
 * Rhythm sequencer — schedules the generated drum patterns with the same
 * lookahead technique the hardware's sequencer uses internally: one measure is
 * queued at a time, a little ahead of the play position, so VARIATION changes,
 * FILL and ENDING all take effect on musical boundaries.
 */

import { getDrumBank, type DrumBank } from './drum-kit';
import {
  buildEnding,
  buildFill,
  buildIntro,
  buildPattern,
  STEPS_PER_BEAT,
  type GeneratedPattern,
  type Inst,
} from '../data/rhythm-patterns';
import { parseBeat } from '../data/rhythm-data';
import type { RhythmSettings } from '../types';

/** Static stereo placement of the kit, mirroring a drum-room mix. */
const PAN: Partial<Record<Inst, number>> = {
  chh: 0.25,
  ohh: 0.25,
  phh: 0.2,
  ride: -0.3,
  bell: -0.3,
  crash: -0.35,
  tom1: -0.2,
  tom2: 0.05,
  tom3: 0.3,
  shaker: 0.4,
  tamb: -0.4,
  cowbell: 0.15,
  claves: -0.2,
  congaH: -0.25,
  congaL: 0.25,
  cajonH: 0.1,
  cajonL: 0,
};

const LOOKAHEAD = 0.25; // seconds of scheduled audio kept ahead of the clock
const TICK_MS = 40;

export type RhythmMode = 'idle' | 'intro' | 'pattern' | 'ending';

export interface RhythmEngineHooks {
  /** Called (from the timer) when a measure has just been queued. */
  onMeasure?(measureIndex: number): void;
  /** Called after the ending measure has finished and the rhythm stopped. */
  onStopped?(): void;
}

export class RhythmEngine {
  readonly output: GainNode;
  private readonly gain: GainNode;
  private bank: DrumBank | null = null;
  private bankKit = '';
  private settings: RhythmSettings;
  private tempo = 120;

  private mode: RhythmMode = 'idle';
  private timer: number | null = null;
  /** Context time of measure 0, step 0. */
  private originTime = 0;
  private nextMeasureTime = 0;
  private measureIndex = 0;
  private pendingVariation: RhythmSettings['variation'] | null = null;
  private fillQueued = false;
  private endQueued = false;
  /** Loop length in measures, used by VARIATION CHANGE = LOOP END. */
  loopMeasures = 0;
  private patternCache = new Map<string, GeneratedPattern>();
  private hooks: RhythmEngineHooks;

  constructor(private ctx: AudioContext, settings: RhythmSettings, hooks: RhythmEngineHooks = {}) {
    this.settings = settings;
    this.hooks = hooks;
    this.gain = ctx.createGain();
    this.output = ctx.createGain();
    this.gain.connect(this.output);
    this.setLevel(settings.level);
    void this.loadKit(settings.kit);
  }

  // -- configuration --------------------------------------------------------

  get running(): boolean {
    return this.mode !== 'idle';
  }

  get beatsPerMeasure(): number {
    const { num, den } = parseBeat(this.settings.beat);
    return den === 8 ? num / 2 : num;
  }

  get secondsPerBeat(): number {
    return 60 / this.tempo;
  }

  get secondsPerMeasure(): number {
    return this.secondsPerBeat * this.beatsPerMeasure;
  }

  update(settings: RhythmSettings): void {
    const kitChanged = settings.kit !== this.settings.kit;
    const patternChanged =
      settings.genre !== this.settings.genre ||
      settings.pattern !== this.settings.pattern ||
      settings.beat !== this.settings.beat;
    const variationChanged = settings.variation !== this.settings.variation;
    const prevVariation = this.settings.variation;
    this.settings = settings;
    this.setLevel(settings.level);
    if (kitChanged) void this.loadKit(settings.kit);
    if (patternChanged) this.patternCache.clear();
    if (variationChanged && this.running) {
      // The change is queued; it lands on the next measure or the next loop end.
      this.settings = { ...settings, variation: prevVariation };
      this.pendingVariation = settings.variation;
      if (this.settings.variationChange === 'MEASURE') this.applyPendingVariation();
    }
  }

  setTempo(tempo: number): void {
    this.tempo = tempo;
  }

  setLevel(level: number): void {
    this.gain.gain.value = Math.pow(level / 100, 1.4) * 1.1;
  }

  private async loadKit(kit: string): Promise<void> {
    const bank = await getDrumBank(kit, this.ctx.sampleRate);
    // Ignore a stale load if the kit changed again while rendering.
    if (this.settings.kit === kit) {
      this.bank = bank;
      this.bankKit = kit;
    }
  }

  /** Renders the current kit up front so the first beat is never late. */
  async prepare(): Promise<void> {
    if (this.bankKit !== this.settings.kit || !this.bank) await this.loadKit(this.settings.kit);
  }

  // -- transport ------------------------------------------------------------

  /**
   * Starts the sequencer.
   * @param atTime  context time of the first downbeat (defaults to "now")
   * @param introMeasures  count-in measures played before measure 0
   */
  start(atTime?: number, introMeasures = 0): number {
    const now = this.ctx.currentTime;
    const t0 = Math.max(now + 0.02, atTime ?? now + 0.02);
    this.originTime = t0 + introMeasures * this.secondsPerMeasure;
    this.nextMeasureTime = t0;
    this.measureIndex = introMeasures > 0 ? -introMeasures : 0;
    this.mode = introMeasures > 0 ? 'intro' : 'pattern';
    this.fillQueued = false;
    this.endQueued = false;
    this.pendingVariation = null;
    this.tick();
    if (this.timer === null) this.timer = window.setInterval(() => this.tick(), TICK_MS);
    return this.originTime;
  }

  /** Immediate stop (or, with ENDING on, after the ending measure). */
  stop(withEnding = false): void {
    if (this.mode === 'idle') return;
    if (withEnding && this.settings.ending && this.mode === 'pattern') {
      this.endQueued = true;
      return;
    }
    this.halt();
  }

  private halt(): void {
    this.mode = 'idle';
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
    this.hooks.onStopped?.();
  }

  /** Queues a one-measure fill-in on the next measure. */
  fillIn(): void {
    if (this.mode === 'pattern') this.fillQueued = true;
  }

  setVariation(v: RhythmSettings['variation']): void {
    if (!this.running || this.settings.variationChange === 'MEASURE') {
      this.settings = { ...this.settings, variation: v };
      this.pendingVariation = null;
      return;
    }
    this.pendingVariation = v;
  }

  get variation(): RhythmSettings['variation'] {
    return this.settings.variation;
  }

  get pendingVariationValue(): RhythmSettings['variation'] | null {
    return this.pendingVariation;
  }

  /** Context time of the next measure boundary at or after `time`. */
  measureBoundaryAfter(time: number): number {
    const spm = this.secondsPerMeasure;
    const n = Math.ceil((time - this.originTime) / spm);
    return this.originTime + n * spm;
  }

  private applyPendingVariation(): void {
    if (this.pendingVariation) {
      this.settings = { ...this.settings, variation: this.pendingVariation };
      this.pendingVariation = null;
    }
  }

  // -- scheduling -----------------------------------------------------------

  private tick(): void {
    const horizon = this.ctx.currentTime + LOOKAHEAD;
    let guard = 0;
    while (this.mode !== 'idle' && this.nextMeasureTime < horizon && guard++ < 8) {
      this.scheduleMeasure(this.nextMeasureTime, this.measureIndex);
      this.nextMeasureTime += this.secondsPerMeasure;
      this.measureIndex++;
    }
  }

  private scheduleMeasure(time: number, index: number): void {
    const bpm = this.beatsPerMeasure;
    const stepDur = this.secondsPerBeat / STEPS_PER_BEAT;
    const measureSteps = Math.round(bpm * STEPS_PER_BEAT);

    if (index < 0) {
      // Count-in measure.
      this.emit(buildIntro(bpm), time, stepDur, 0, measureSteps);
      if (index === -1) this.mode = 'pattern';
      return;
    }

    if (this.endQueued) {
      this.emit(buildEnding(bpm), time, stepDur, 0, measureSteps);
      this.endQueued = false;
      this.mode = 'ending';
      // Stop once the ending measure has played out.
      window.setTimeout(() => this.halt(), Math.max(0, (time - this.ctx.currentTime + this.secondsPerMeasure) * 1000));
      return;
    }

    if (index > 0 && this.pendingVariation) {
      const atLoopEnd = this.loopMeasures > 0 ? index % this.loopMeasures === 0 : true;
      if (this.settings.variationChange === 'MEASURE' || atLoopEnd) this.applyPendingVariation();
    }

    if (this.fillQueued) {
      this.emit(buildFill(this.settings.genre, bpm, `${this.settings.pattern}${index}`), time, stepDur, 0, measureSteps);
      this.fillQueued = false;
      this.hooks.onMeasure?.(index);
      return;
    }

    const pat = this.currentPattern();
    const half = index % pat.measures;
    this.emit(pat, time, stepDur, half * measureSteps, measureSteps);
    this.hooks.onMeasure?.(index);
  }

  private currentPattern(): GeneratedPattern {
    const s = this.settings;
    const key = `${s.genre}|${s.pattern}|${s.variation}|${s.beat}`;
    let pat = this.patternCache.get(key);
    if (!pat) {
      pat = buildPattern(s.genre, s.pattern, s.beat, s.variation, 2);
      this.patternCache.set(key, pat);
    }
    return pat;
  }

  private emit(pat: GeneratedPattern, time: number, stepDur: number, offset: number, span: number): void {
    const bank = this.bank;
    if (!bank) return;
    for (const h of pat.hits) {
      if (h.step < offset || h.step >= offset + span) continue;
      const when = time + (h.step - offset) * stepDur;
      if (when < this.ctx.currentTime - 0.02) continue;
      this.voice(bank, h.inst, when, h.vel);
    }
  }

  private voice(bank: DrumBank, inst: Inst, when: number, vel: number): void {
    const buf = bank[inst];
    if (!buf) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    // Tiny per-hit detune keeps repeated hits from sounding machine-gunned.
    src.playbackRate.value = 1 + (vel - 0.75) * 0.02;
    const g = this.ctx.createGain();
    g.gain.value = vel * vel * 0.9;
    const pan = PAN[inst];
    if (pan) {
      const p = this.ctx.createStereoPanner();
      p.pan.value = pan;
      src.connect(g).connect(p).connect(this.gain);
    } else {
      src.connect(g).connect(this.gain);
    }
    src.start(when);
    src.stop(when + buf.duration + 0.01);
  }

  dispose(): void {
    this.halt();
    this.output.disconnect();
  }
}
