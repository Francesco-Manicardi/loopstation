/**
 * Audio engine: builds the whole RC-505mkII signal path in Web Audio and keeps
 * it in sync with the current memory and system settings.
 *
 * Signal flow (matching the block diagram in the Owner's Manual):
 *
 *   MIC 1/2, INST 1/2, USB ─▶ per-channel gain ▶ EQ ▶ dynamics ─┬─▶ INPUT FX (A–D)
 *                                                               │
 *   INPUT FX ─┬─▶ input monitor ─────────────────────────────────┴─▶ MIX BUS
 *             └─▶ per-track record source ─▶ LOOPER (5 tracks)
 *
 *   LOOPER track n ─┬─▶ TRACK FX (A–D) ─▶ MIX BUS
 *                   └─▶ MIX BUS
 *   RHYTHM ─────────────────────────────▶ MIX BUS (and to the record source)
 *   MIX BUS ─▶ master comp ─▶ master reverb ─▶ MAIN EQ ─▶ MAIN level ─▶ output
 */

import looperUrl from './worklets/looper-processor.js?url';
import fxUrl from './worklets/fx-processor.js?url';
import { RhythmEngine } from './rhythm';
import { applySlot, createFxUnit, type FxContext, type FxUnit } from './fx-chain';
import { fxType, knobParam } from '../data/fx-list';
import { parseBeat } from '../data/rhythm-data';
import {
  NUM_TRACKS,
  type FxBank,
  type FxSectionSettings,
  type FxSlot,
  type Memory,
  type SystemSettings,
  type TrackSettings,
  type TransportStatus,
} from '../types';

export type LooperCommand =
  | 'rec'
  | 'play'
  | 'dub'
  | 'stop'
  | 'clear'
  | 'undo'
  | 'redo'
  | 'markSet'
  | 'markClear'
  | 'markBack'
  | 'retrig';

export interface EngineHooks {
  onStatus?(status: TransportStatus): void;
  onTempoDetected?(tempo: number): void;
  onRecEnd?(track: number, measures: number): void;
  onMessage?(text: string): void;
}

interface Channel {
  input: GainNode;
  gain: GainNode;
  eqLow: BiquadFilterNode;
  eqMid: BiquadFilterNode;
  eqHigh: BiquadFilterNode;
  eqLevel: GainNode;
  comp: DynamicsCompressorNode;
  gate: GainNode;
  out: GainNode;
  reverbSend: GainNode;
}

type ChannelName = 'mic1' | 'mic2' | 'inst1' | 'inst2' | 'usb';
const CHANNELS: ChannelName[] = ['mic1', 'mic2', 'inst1', 'inst2', 'usb'];

const FX_SLOT_IDS: FxSlot[] = ['A', 'B', 'C', 'D'];

export class Engine {
  readonly ctx: AudioContext;
  private looper!: AudioWorkletNode;
  rhythm!: RhythmEngine;

  private channels = new Map<ChannelName, Channel>();
  private inputSum!: GainNode;
  private inputPost!: GainNode;
  private inputMonitor!: GainNode;
  private mixBus!: GainNode;
  private masterComp!: DynamicsCompressorNode;
  private masterReverb!: ConvolverNode;
  private masterReverbSend!: GainNode;
  private masterReverbReturn!: GainNode;
  private mainEqLow!: BiquadFilterNode;
  private mainEqMid!: BiquadFilterNode;
  private mainEqHigh!: BiquadFilterNode;
  private mainLevel!: GainNode;
  private meterNode: AudioWorkletNode | null = null;

  private trackOut: GainNode[] = [];
  private trackDirect: GainNode[] = [];
  private trackFxSend: GainNode[] = [];
  private recSource: GainNode[] = [];
  private recInputGate: GainNode[] = [];
  private recRhythmGate: GainNode[] = [];
  private bounceTap!: GainNode;
  private rhythmOutLevel!: GainNode;

  private inputFxIn!: GainNode;
  private inputFxOut!: GainNode;
  private trackFxIn!: GainNode;
  private trackFxOut!: GainNode;
  private inputFxUnits: FxUnit[] = [];
  private trackFxUnits: FxUnit[] = [];
  private inputFxBank: FxBank = 'A';
  private trackFxBank: FxBank = 'A';

  private micStream: MediaStream | null = null;
  private micSource: MediaStreamAudioSourceNode | null = null;

  private memory!: Memory;
  private workletsReady = false;
  private fxTimer: number | null = null;
  private outputPeak: [number, number] = [0, 0];
  private hooks: EngineHooks;

  constructor(hooks: EngineHooks = {}) {
    this.hooks = hooks;
    const Ctor: typeof AudioContext =
      window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new Ctor({ latencyHint: 'interactive' });
  }

  get info(): FxContext {
    const { num, den } = parseBeat(this.memory?.rhythm.beat ?? '4/4');
    return { tempo: this.memory?.tempo ?? 120, beatsPerMeasure: den === 8 ? num / 2 : num };
  }

  // -----------------------------------------------------------------------
  // Setup
  // -----------------------------------------------------------------------

  async init(memory: Memory, system: SystemSettings): Promise<void> {
    this.memory = memory;

    try {
      await this.ctx.audioWorklet.addModule(looperUrl);
      await this.ctx.audioWorklet.addModule(fxUrl);
      this.workletsReady = true;
    } catch (err) {
      console.error('AudioWorklet modules failed to load', err);
      this.hooks.onMessage?.('AUDIO ENGINE ERROR');
    }

    const ctx = this.ctx;
    this.mixBus = ctx.createGain();
    this.inputSum = ctx.createGain();
    this.inputPost = ctx.createGain();
    this.inputMonitor = ctx.createGain();
    this.inputFxIn = ctx.createGain();
    this.inputFxOut = ctx.createGain();
    this.trackFxIn = ctx.createGain();
    this.trackFxOut = ctx.createGain();
    this.bounceTap = ctx.createGain();

    // --- master chain -----------------------------------------------------
    this.masterComp = ctx.createDynamicsCompressor();
    this.masterReverb = ctx.createConvolver();
    this.masterReverbSend = ctx.createGain();
    this.masterReverbReturn = ctx.createGain();
    this.mainEqLow = ctx.createBiquadFilter();
    this.mainEqLow.type = 'lowshelf';
    this.mainEqLow.frequency.value = 200;
    this.mainEqMid = ctx.createBiquadFilter();
    this.mainEqMid.type = 'peaking';
    this.mainEqMid.frequency.value = 1000;
    this.mainEqHigh = ctx.createBiquadFilter();
    this.mainEqHigh.type = 'highshelf';
    this.mainEqHigh.frequency.value = 4000;
    this.mainLevel = ctx.createGain();

    this.mixBus.connect(this.masterComp);
    this.masterComp.connect(this.mainEqLow);
    this.masterComp.connect(this.masterReverbSend);
    this.masterReverbSend.connect(this.masterReverb).connect(this.masterReverbReturn);
    this.masterReverbReturn.connect(this.mainEqLow);
    this.mainEqLow.connect(this.mainEqMid).connect(this.mainEqHigh).connect(this.mainLevel);
    this.mainLevel.connect(ctx.destination);
    this.masterReverb.buffer = this.makeReverbIr(2.2);
    this.masterReverbSend.gain.value = 0;

    if (this.workletsReady) {
      this.meterNode = new AudioWorkletNode(ctx, 'meter', { numberOfInputs: 1, numberOfOutputs: 0 });
      this.meterNode.port.onmessage = (e) => {
        this.outputPeak = e.data as [number, number];
      };
      this.mainLevel.connect(this.meterNode);
    }

    // --- input channels ---------------------------------------------------
    for (const name of CHANNELS) this.channels.set(name, this.makeChannel());
    for (const ch of this.channels.values()) {
      ch.out.connect(this.inputSum);
      ch.reverbSend.connect(this.masterReverbSend);
    }

    // Input FX is inserted on the summed input; the post-FX signal is what the
    // looper records and what the monitor path hears.
    this.inputSum.connect(this.inputFxIn);
    this.inputFxOut.connect(this.inputPost);
    this.inputPost.connect(this.inputMonitor).connect(this.mixBus);

    // --- looper -----------------------------------------------------------
    if (this.workletsReady) {
      this.looper = new AudioWorkletNode(ctx, 'looper-processor', {
        numberOfInputs: NUM_TRACKS + 1,
        numberOfOutputs: NUM_TRACKS,
        outputChannelCount: Array.from({ length: NUM_TRACKS }, () => 2),
        channelCount: 2,
        channelCountMode: 'explicit',
        channelInterpretation: 'speakers',
      });
      this.looper.port.onmessage = (e) => this.onLooperMessage(e.data);
    }

    for (let i = 0; i < NUM_TRACKS; i++) {
      const out = ctx.createGain();
      const direct = ctx.createGain();
      const send = ctx.createGain();
      send.gain.value = 0;
      out.connect(direct).connect(this.mixBus);
      out.connect(send).connect(this.trackFxIn);
      this.trackOut.push(out);
      this.trackDirect.push(direct);
      this.trackFxSend.push(send);
      if (this.workletsReady) this.looper.connect(out, i, 0);

      const rec = ctx.createGain();
      const inGate = ctx.createGain();
      const rhyGate = ctx.createGain();
      this.inputPost.connect(inGate).connect(rec);
      rhyGate.connect(rec);
      if (this.workletsReady) rec.connect(this.looper, 0, i);
      this.recSource.push(rec);
      this.recInputGate.push(inGate);
      this.recRhythmGate.push(rhyGate);
    }
    this.trackFxOut.connect(this.mixBus);

    // Bounce path. A one-block delay breaks the graph cycle that Web Audio
    // would otherwise mute (mix bus → looper → track out → mix bus).
    const bounceDelay = ctx.createDelay(0.05);
    bounceDelay.delayTime.value = 128 / ctx.sampleRate;
    this.mixBus.connect(bounceDelay).connect(this.bounceTap);
    if (this.workletsReady) this.bounceTap.connect(this.looper, 0, NUM_TRACKS);

    // --- rhythm -----------------------------------------------------------
    this.rhythm = new RhythmEngine(ctx, memory.rhythm, {
      onStopped: () => {
        this.looper.port.postMessage({ t: 'global', params: { rhythmRunning: false } });
      },
    });
    this.rhythm.setTempo(memory.tempo);
    this.rhythmOutLevel = ctx.createGain();
    this.rhythm.output.connect(this.rhythmOutLevel).connect(this.mixBus);
    // The record path taps the rhythm before the output mixer level.
    for (const gate of this.recRhythmGate) this.rhythm.output.connect(gate);

    // --- FX ---------------------------------------------------------------
    this.rebuildFxSection('input');
    this.rebuildFxSection('track');

    this.applySystem(system);
    this.applyMemory(memory);

    this.fxTimer = window.setInterval(() => this.tickFx(), 40);
  }

  private makeChannel(): Channel {
    const ctx = this.ctx;
    const ch: Channel = {
      input: ctx.createGain(),
      gain: ctx.createGain(),
      eqLow: ctx.createBiquadFilter(),
      eqMid: ctx.createBiquadFilter(),
      eqHigh: ctx.createBiquadFilter(),
      eqLevel: ctx.createGain(),
      comp: ctx.createDynamicsCompressor(),
      gate: ctx.createGain(),
      out: ctx.createGain(),
      reverbSend: ctx.createGain(),
    };
    ch.eqLow.type = 'lowshelf';
    ch.eqLow.frequency.value = 200;
    ch.eqMid.type = 'peaking';
    ch.eqMid.frequency.value = 1000;
    ch.eqHigh.type = 'highshelf';
    ch.eqHigh.frequency.value = 4000;
    ch.reverbSend.gain.value = 0;
    ch.input
      .connect(ch.gain)
      .connect(ch.eqLow)
      .connect(ch.eqMid)
      .connect(ch.eqHigh)
      .connect(ch.eqLevel)
      .connect(ch.comp)
      .connect(ch.gate)
      .connect(ch.out);
    ch.out.connect(ch.reverbSend);
    return ch;
  }

  private makeReverbIr(seconds: number): AudioBuffer {
    const sr = this.ctx.sampleRate;
    const len = Math.ceil(seconds * sr);
    const buf = this.ctx.createBuffer(2, len, sr);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) {
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.2);
      }
    }
    return buf;
  }

  async resume(): Promise<void> {
    if (this.ctx.state !== 'running') await this.ctx.resume();
  }

  // -----------------------------------------------------------------------
  // Microphone
  // -----------------------------------------------------------------------

  get micEnabled(): boolean {
    return this.micStream !== null;
  }

  async enableMic(): Promise<boolean> {
    if (this.micStream) return true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: 2,
        },
        video: false,
      });
      this.micStream = stream;
      this.micSource = this.ctx.createMediaStreamSource(stream);
      const mic1 = this.channels.get('mic1');
      if (mic1) this.micSource.connect(mic1.input);
      return true;
    } catch (err) {
      console.warn('Microphone unavailable', err);
      this.hooks.onMessage?.('NO INPUT DEVICE');
      return false;
    }
  }

  disableMic(): void {
    this.micSource?.disconnect();
    this.micStream?.getTracks().forEach((t) => t.stop());
    this.micSource = null;
    this.micStream = null;
  }

  /** Routes an arbitrary audio element (e.g. a dropped file) into INST 1. */
  connectElement(el: HTMLMediaElement): MediaElementAudioSourceNode {
    const src = this.ctx.createMediaElementSource(el);
    const inst1 = this.channels.get('inst1');
    if (inst1) src.connect(inst1.input);
    return src;
  }

  // -----------------------------------------------------------------------
  // Memory / settings
  // -----------------------------------------------------------------------

  applyMemory(memory: Memory): void {
    this.memory = memory;
    if (!this.workletsReady) return;
    this.looper.port.postMessage({ t: 'tempo', tempo: memory.tempo });
    const { num, den } = parseBeat(memory.rhythm.beat);
    this.looper.port.postMessage({
      t: 'beat',
      beatsPerMeasure: den === 8 ? num / 2 : num,
      beatUnit: den,
    });
    this.looper.port.postMessage({
      t: 'global',
      params: {
        quantize: memory.rec.quantize,
        recAction: memory.rec.recAction,
        autoRecSw: memory.rec.autoRecSw,
        autoRecSens: memory.rec.autoRecSens,
        bounceSw: memory.rec.bounceSw,
        bounceTracks: memory.rec.bounceTrack,
        singleTrackChange: memory.play.singleTrackChange,
        fadeInMeasures: memory.play.fadeTimeIn,
        fadeOutMeasures: memory.play.fadeTimeOut,
        allStartTrack: memory.play.allStartTrack,
        allStopTrack: memory.play.allStopTrack,
      },
    });
    for (let i = 0; i < NUM_TRACKS; i++) this.applyTrack(i, memory.tracks[i], memory.trackLevels[i]);
    this.rhythm.setTempo(memory.tempo);
    this.rhythm.update(memory.rhythm);
    this.applyFxSection('input', memory.inputFx);
    this.applyFxSection('track', memory.trackFx);
  }

  applyTrack(i: number, t: TrackSettings, fader: number): void {
    if (!this.workletsReady) return;
    this.looper.port.postMessage({
      t: 'track',
      track: i,
      params: {
        reverse: t.reverse,
        oneShot: t.oneShot,
        pan: t.pan,
        playLevel: t.playLevel,
        fader,
        startMode: t.startMode,
        stopMode: t.stopMode,
        dubMode: t.dubMode,
        playMode: t.playMode,
        measureSetting: t.measure,
        loopSyncSw: t.loopSyncSw,
        loopSyncMode: t.loopSyncMode,
        tempoSyncSw: t.tempoSyncSw,
        tempoSyncMode: t.tempoSyncMode,
        speed: t.tempoSyncSpeed,
        bounceIn: t.bounceIn,
      },
    });
    // Track FX routing for this track.
    const insert = this.currentTrackFxInsert();
    const routed = t.fx && (insert === 'ALL' || insert === `TRACK${i + 1}`);
    const now = this.ctx.currentTime;
    this.trackFxSend[i].gain.setTargetAtTime(routed ? 1 : 0, now, 0.01);
    this.trackDirect[i].gain.setTargetAtTime(routed ? 0 : 1, now, 0.01);
    // Record source assignment.
    const anyInput =
      t.input.mic1 || t.input.mic2 || t.input.inst1L || t.input.inst1R || t.input.inst2L || t.input.inst2R;
    this.recInputGate[i].gain.value = anyInput ? 1 : 0;
    this.recRhythmGate[i].gain.value = t.input.rhythm ? 1 : 0;
  }

  setTempo(tempo: number): void {
    this.memory.tempo = tempo;
    this.looper?.port.postMessage({ t: 'tempo', tempo });
    this.rhythm.setTempo(tempo);
    this.applyFxSection('input', this.memory.inputFx);
    this.applyFxSection('track', this.memory.trackFx);
  }

  setTrackFader(i: number, value: number): void {
    this.looper?.port.postMessage({ t: 'track', track: i, params: { fader: value } });
  }

  applySystem(system: SystemSettings): void {
    const now = this.ctx.currentTime;
    for (const name of CHANNELS) {
      const ch = this.channels.get(name);
      const s = system.input.channels[name];
      if (!ch || !s) continue;
      const gain = (s.gain ?? 50) / 50;
      ch.gain.gain.setTargetAtTime(s.mute ? 0 : (s.level / 100) * gain, now, 0.01);
      ch.eqLow.gain.value = s.eq.sw ? s.eq.low : 0;
      ch.eqMid.gain.value = s.eq.sw ? s.eq.mid : 0;
      ch.eqMid.frequency.value = s.eq.midFreq;
      ch.eqHigh.gain.value = s.eq.sw ? s.eq.high : 0;
      ch.eqLevel.gain.value = s.eq.sw ? Math.pow(10, s.eq.level / 20) : 1;
      ch.comp.threshold.value = s.dynamics.compSw ? -40 + (s.dynamics.compThreshold / 100) * 30 : 0;
      ch.comp.ratio.value = s.dynamics.compSw ? 4 : 1;
      // The noise suppressor is approximated with a downward expander pedal-style gate.
      ch.gate.gain.value = 1;
      ch.reverbSend.gain.setTargetAtTime((s.reverb / 100) * 0.7, now, 0.02);
    }
    const main = system.output.main;
    // MIXER screen levels: LOOP OUT scales the phrase tracks, RHYTHM OUT the
    // rhythm, MASTER OUT everything.
    for (const out of this.trackOut) out.gain.setTargetAtTime(system.output.loopLevel / 100, now, 0.02);
    this.rhythmOutLevel.gain.setTargetAtTime(system.output.rhythmLevel / 100, now, 0.02);
    this.mainEqLow.gain.value = main.eq.sw ? main.eq.low : 0;
    this.mainEqMid.gain.value = main.eq.sw ? main.eq.mid : 0;
    this.mainEqMid.frequency.value = main.eq.midFreq;
    this.mainEqHigh.gain.value = main.eq.sw ? main.eq.high : 0;
    const rv = system.output.masterFx.reverb;
    this.masterReverbSend.gain.setTargetAtTime(rv.sw ? (rv.level / 100) * 0.5 : 0, now, 0.05);
    this.masterReverbReturn.gain.value = 1;
    const cp = system.output.masterFx.comp;
    this.masterComp.threshold.value = cp.sw ? -40 + (cp.threshold / 100) * 35 : 0;
    this.masterComp.ratio.value = cp.sw ? Number(cp.ratio.split(':')[0]) || 4 : 1;
    this.masterComp.knee.value = 8;
    this.mainLevel.gain.setTargetAtTime(
      (main.level / 100) * (system.output.masterLevel / 100) * (cp.sw ? Math.pow(10, cp.gain / 20) : 1),
      now,
      0.02,
    );
  }

  // -----------------------------------------------------------------------
  // FX
  // -----------------------------------------------------------------------

  private currentTrackFxInsert(): string {
    const bank = this.memory?.trackFx.banks[this.trackFxBank];
    if (!bank) return 'ALL';
    return bank.slots[bank.fxTarget].insert || 'ALL';
  }

  private rebuildFxSection(section: 'input' | 'track'): void {
    const units = section === 'input' ? this.inputFxUnits : this.trackFxUnits;
    for (const u of units) u.dispose();
    units.length = 0;
    const inNode = section === 'input' ? this.inputFxIn : this.trackFxIn;
    const outNode = section === 'input' ? this.inputFxOut : this.trackFxOut;
    inNode.disconnect();
    const bankId = section === 'input' ? this.inputFxBank : this.trackFxBank;
    const bank = this.memory?.[section === 'input' ? 'inputFx' : 'trackFx'].banks[bankId];
    if (!bank) {
      inNode.connect(outNode);
      return;
    }
    let prev: AudioNode = inNode;
    for (const slotId of FX_SLOT_IDS) {
      const slot = bank.slots[slotId];
      const unit = createFxUnit(this.ctx, slot.type, this.workletsReady);
      prev.connect(unit.input);
      prev = unit.output;
      units.push(unit);
    }
    prev.connect(outNode);
  }

  applyFxSection(section: 'input' | 'track', settings: FxSectionSettings): void {
    const bankId = settings.bank;
    const current = section === 'input' ? this.inputFxBank : this.trackFxBank;
    const bank = settings.banks[bankId];
    const units = section === 'input' ? this.inputFxUnits : this.trackFxUnits;
    const typesChanged =
      bankId !== current ||
      units.length !== FX_SLOT_IDS.length ||
      FX_SLOT_IDS.some((id, i) => units[i]?.type !== bank.slots[id].type);
    if (section === 'input') this.inputFxBank = bankId;
    else this.trackFxBank = bankId;
    if (typesChanged) this.rebuildFxSection(section);
    const list = section === 'input' ? this.inputFxUnits : this.trackFxUnits;
    const now = this.ctx.currentTime;
    FX_SLOT_IDS.forEach((id, i) => {
      const unit = list[i];
      if (!unit) return;
      const slot = bank.slots[id];
      // In SINGLE mode only the target slot can be on at a time.
      const on = bank.sw && slot.sw && (bank.mode === 'MULTI' || id === bank.fxTarget);
      applySlot(unit, { ...slot, sw: on }, this.info, now);
    });
    if (section === 'track') {
      for (let i = 0; i < NUM_TRACKS; i++) this.applyTrack(i, this.memory.tracks[i], this.memory.trackLevels[i]);
    }
  }

  /** Live control from the big INPUT FX / TRACK FX knob (0..100). */
  setFxKnob(section: 'input' | 'track', value: number): void {
    const settings = section === 'input' ? this.memory.inputFx : this.memory.trackFx;
    const bank = settings.banks[settings.bank];
    const slot = bank.slots[bank.fxTarget];
    const param = knobParam(slot.type);
    if (!param) return;
    if (param.kind === 'num') {
      const min = param.min ?? 0;
      const max = param.max ?? 100;
      slot.params[param.id] = Math.round(min + ((max - min) * value) / 100);
    } else if (param.values) {
      const idx = Math.min(param.values.length - 1, Math.round((value / 100) * (param.values.length - 1)));
      slot.params[param.id] = param.values[idx];
    }
    const units = section === 'input' ? this.inputFxUnits : this.trackFxUnits;
    const i = FX_SLOT_IDS.indexOf(bank.fxTarget);
    units[i]?.setParams(slot.params, this.info);
  }

  /** Writes a single FX parameter live (used by the FX SEQUENCE step sequencer). */
  setFxParam(section: 'input' | 'track', slot: FxSlot, id: string, value: number | string): void {
    const settings = section === 'input' ? this.memory.inputFx : this.memory.trackFx;
    const bank = settings.banks[settings.bank];
    bank.slots[slot].params[id] = value;
    const units = section === 'input' ? this.inputFxUnits : this.trackFxUnits;
    units[FX_SLOT_IDS.indexOf(slot)]?.setParams(bank.slots[slot].params, this.info);
  }

  /** Returns the label + value the LCD shows while the FX knob is moving. */
  fxKnobLabel(section: 'input' | 'track'): { name: string; label: string; value: string } | null {
    const settings = section === 'input' ? this.memory.inputFx : this.memory.trackFx;
    const bank = settings.banks[settings.bank];
    const slot = bank.slots[bank.fxTarget];
    const param = knobParam(slot.type);
    if (!param) return null;
    return { name: fxType(slot.type).name, label: param.label, value: String(slot.params[param.id]) };
  }

  private tickFx(): void {
    const now = this.ctx.currentTime;
    const info = this.info;
    for (const u of this.inputFxUnits) u.tick?.(now, info);
    for (const u of this.trackFxUnits) u.tick?.(now, info);
  }

  // -----------------------------------------------------------------------
  // Transport
  // -----------------------------------------------------------------------

  command(track: number, cmd: LooperCommand, arg?: unknown): void {
    void this.resume();
    this.looper?.port.postMessage({ t: 'cmd', track, cmd, arg });
    if (cmd === 'rec' || cmd === 'play') this.maybeStartRhythm(track, cmd);
  }

  allStart(): void {
    void this.resume();
    this.looper?.port.postMessage({ t: 'allStart' });
    if (this.memory.rhythm.startTrig === 'LOOP START' && !this.rhythm.running) this.startRhythm();
  }

  allStop(): void {
    this.looper?.port.postMessage({ t: 'allStop' });
    if (this.memory.rhythm.stopTrig === 'LOOP STOP') this.rhythm.stop(true);
  }

  /** RHYTHM ON/OFF button. */
  toggleRhythm(): void {
    void this.resume();
    if (this.rhythm.running) this.rhythm.stop(true);
    else this.startRhythm();
  }

  startRhythm(introMeasures = 0): void {
    void this.resume();
    void this.rhythm.prepare().then(() => {
      const origin = this.rhythm.start(undefined, introMeasures);
      this.looper?.port.postMessage({ t: 'global', params: { rhythmRunning: true } });
      this.looper?.port.postMessage({ t: 'clockStart', atFrame: origin * this.ctx.sampleRate });
    });
  }

  private maybeStartRhythm(track: number, cmd: LooperCommand): void {
    const r = this.memory.rhythm;
    if (this.rhythm.running) return;
    if (r.startTrig === 'BEFORE LOOP' && cmd === 'rec') {
      this.startRhythm(r.introRec ? 1 : 0);
    } else if (r.startTrig === 'LOOP START' && (cmd === 'play' || cmd === 'rec')) {
      const status = this.lastStatus?.tracks[track];
      if (cmd === 'play' || status?.hasPhrase) this.startRhythm();
    }
  }

  setVariation(v: 'A' | 'B' | 'C' | 'D'): void {
    this.memory.rhythm.variation = v;
    this.rhythm.setVariation(v);
  }

  fillIn(): void {
    this.rhythm.fillIn();
  }

  clearTrack(track: number): void {
    this.command(track, 'clear');
  }

  private lastStatus: TransportStatus | null = null;

  get status(): TransportStatus | null {
    return this.lastStatus;
  }

  private onLooperMessage(msg: Record<string, unknown>): void {
    switch (msg['t']) {
      case 'status': {
        const status = msg as unknown as TransportStatus;
        status.outputPeak = this.outputPeak;
        this.lastStatus = status;
        // Keep the rhythm's loop-end reference in step with track 1's length.
        const measures = status.tracks.find((t) => t.hasPhrase)?.measures ?? 0;
        this.rhythm.loopMeasures = measures;
        this.hooks.onStatus?.(status);
        break;
      }
      case 'tempoDetected':
        this.memory.tempo = msg['tempo'] as number;
        this.rhythm.setTempo(this.memory.tempo);
        this.hooks.onTempoDetected?.(this.memory.tempo);
        break;
      case 'recEnd': {
        const track = msg['track'] as number;
        const measures = msg['measures'] as number;
        this.hooks.onRecEnd?.(track, measures);
        const r = this.memory.rhythm;
        if (r.startTrig === 'REC END' && !this.rhythm.running) this.startRhythm();
        if (r.stopTrig === 'REC END') this.rhythm.stop(true);
        break;
      }
      case 'recStart': {
        const r = this.memory.rhythm;
        if (r.startTrig === 'BEFORE LOOP' && !this.rhythm.running) this.startRhythm();
        break;
      }
      case 'phrase':
        this.phraseResolvers.get(msg['id'] as number)?.(msg);
        this.phraseResolvers.delete(msg['id'] as number);
        break;
      default:
        break;
    }
  }

  // -----------------------------------------------------------------------
  // Phrase transfer (used by memory save / load)
  // -----------------------------------------------------------------------

  private phraseId = 0;
  private phraseResolvers = new Map<number, (msg: Record<string, unknown>) => void>();

  exportPhrase(track: number): Promise<{ length: number; left?: ArrayBuffer; right?: ArrayBuffer; tempo?: number; measures?: number }> {
    return new Promise((resolve) => {
      const id = ++this.phraseId;
      this.phraseResolvers.set(id, (msg) => resolve(msg as never));
      this.looper.port.postMessage({ t: 'exportPhrase', track, id });
    });
  }

  loadPhrase(track: number, left: ArrayBuffer, right: ArrayBuffer, length: number, tempo: number, measures: number): void {
    this.looper.port.postMessage({ t: 'loadPhrase', track, left, right, length, tempo, measures }, [left, right]);
  }

  dispose(): void {
    if (this.fxTimer !== null) window.clearInterval(this.fxTimer);
    this.rhythm.dispose();
    this.disableMic();
    void this.ctx.close();
  }
}
