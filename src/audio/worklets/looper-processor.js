/**
 * RC-505mkII looper engine — AudioWorkletProcessor.
 *
 * Owns all five stereo phrase tracks and the master transport clock so that
 * LOOP SYNC, QUANTIZE, MEASURE and TEMPO SYNC behave sample-accurately, exactly
 * as they do on the hardware.
 *
 * inputs  : [0..4] per-track record source (stereo, post Input FX / input assign)
 *           [5]    bounce source (stereo, master mix — used by BOUNCE IN / BOUNCE REC)
 * outputs : one stereo output per track (5 total)
 */

const NUM_TRACKS = 5;
const INITIAL_SECONDS = 8;
const MAX_SECONDS = 180;
const GRAIN = 2048; // OLA grain size for pitch-independent speed change

class Track {
  constructor(sampleRate) {
    this.sampleRate = sampleRate;
    /** @type {Float32Array[] | null} */
    this.buf = null;
    this.capacity = 0;
    this.length = 0; // valid loop length in samples
    this.state = 'empty';
    this.recPos = 0;
    this.playPos = 0; // used when loop sync is off
    this.measures = 0;
    this.recordedTempo = 120;

    // --- settings (mirrors LOOP/TRACK parameters) ---
    this.reverse = false;
    this.oneShot = false;
    this.pan = 0; // -50..50
    this.playLevel = 100; // 0..200
    this.fader = 100; // 0..100 physical slider
    this.startMode = 'IMMEDIATE';
    this.stopMode = 'IMMEDIATE';
    this.dubMode = 'OVERDUB';
    this.playMode = 'MULTI';
    this.measureSetting = 'AUTO'; // 'AUTO' | 'FREE' | number
    this.loopSyncSw = true;
    this.loopSyncMode = 'MEASURE';
    this.tempoSyncSw = true;
    this.tempoSyncMode = 'PITCH';
    this.speed = 'NORMAL';
    this.bounceIn = false;

    // --- runtime ---
    this.gain = 1;
    this.targetGain = 1;
    this.fadeSamples = 0; // remaining fade samples
    this.fadeDelta = 0;
    this.pendingStop = null; // 'immediate' | 'loop' | 'fade'
    this.pending = null; // queued quantized command
    this.undo = null; // {buf, length}
    this.redo = null;
    /** true when `undo` holds the state from before the last undo (i.e. a redo). */
    this.undoIsRedo = false;
    this.mark = null;
    this.peak = 0;
    this.olaPhase = 0;
    this.olaRead = 0;
    this.retrigOffset = 0; // frame offset for unsynced playback
    this.dubStartedAt = -1;
  }

  ensureCapacity(samples) {
    const max = Math.ceil(MAX_SECONDS * this.sampleRate);
    const want = Math.min(max, samples);
    if (this.buf && this.capacity >= want) return this.capacity >= samples;
    let cap = this.capacity || Math.ceil(INITIAL_SECONDS * this.sampleRate);
    while (cap < want) cap = Math.min(max, cap * 2);
    const next = [new Float32Array(cap), new Float32Array(cap)];
    if (this.buf) {
      next[0].set(this.buf[0].subarray(0, Math.min(this.capacity, cap)));
      next[1].set(this.buf[1].subarray(0, Math.min(this.capacity, cap)));
    }
    this.buf = next;
    this.capacity = cap;
    return cap >= samples;
  }

  clear() {
    this.buf = null;
    this.capacity = 0;
    this.length = 0;
    this.state = 'empty';
    this.recPos = 0;
    this.playPos = 0;
    this.measures = 0;
    this.undo = null;
    this.redo = null;
    this.undoIsRedo = false;
    this.mark = null;
    this.pending = null;
    this.pendingStop = null;
    this.gain = 1;
    this.fadeSamples = 0;
  }

  snapshot() {
    if (!this.buf || !this.length) return null;
    return {
      buf: [this.buf[0].slice(0, this.length), this.buf[1].slice(0, this.length)],
      length: this.length,
    };
  }

  restore(snap) {
    if (!snap) return;
    this.ensureCapacity(snap.length);
    this.buf[0].set(snap.buf[0]);
    this.buf[1].set(snap.buf[1]);
    this.length = snap.length;
  }

  get hasPhrase() {
    return this.length > 0;
  }

  /** Playback rate multiplier from SPEED + TEMPO SYNC. */
  rate(memoryTempo) {
    let r = this.speed === 'HALF' ? 0.5 : this.speed === 'DOUBLE' ? 2 : 1;
    if (this.tempoSyncSw && this.recordedTempo > 0) r *= memoryTempo / this.recordedTempo;
    return r;
  }
}

class LooperProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.sr = sampleRate;
    this.tracks = Array.from({ length: NUM_TRACKS }, () => new Track(this.sr));

    this.tempo = 120;
    this.beatsPerMeasure = 4;
    this.beatUnit = 4;

    this.clockRunning = false;
    this.rhythmRunning = false;
    this.clockOrigin = 0; // frame index where beat 0 sits
    this.loopOrigin = 0; // frame index where the master loop phase is 0
    this.baseLoopLength = 0; // samples, from the first loop-sync recording

    this.quantize = 'OFF';
    this.recAction = 'REC->DUB';
    this.autoRecSw = false;
    this.autoRecSens = 50;
    this.bounceSw = false;
    this.bounceTracks = [false, false, false, false, false];
    this.singleTrackChange = 'IMMEDIATE';
    this.fadeInMeasures = 2;
    this.fadeOutMeasures = 2;
    this.loopLengthSetting = 'AUTO';
    this.allStartTrack = [true, true, true, true, true];
    this.allStopTrack = [true, true, true, true, true];

    this.blockCount = 0;
    this.inputPeak = 0;
    this.armedAutoRec = new Set();

    this.port.onmessage = (e) => this.handle(e.data);
  }

  // -------------------------------------------------------------------------
  // Messaging
  // -------------------------------------------------------------------------

  handle(msg) {
    switch (msg.t) {
      case 'cmd':
        this.command(msg.track, msg.cmd, msg.arg);
        break;
      case 'track': {
        const tr = this.tracks[msg.track];
        if (!tr) break;
        Object.assign(tr, msg.params);
        break;
      }
      case 'global':
        Object.assign(this, msg.params);
        break;
      case 'tempo':
        this.setTempo(msg.tempo);
        break;
      case 'beat':
        this.beatsPerMeasure = msg.beatsPerMeasure;
        this.beatUnit = msg.beatUnit ?? 4;
        break;
      case 'allStart':
        this.allStart();
        break;
      case 'allStop':
        this.allStop(msg.mode);
        break;
      case 'clockStart':
        this.startClock(msg.atFrame ?? currentFrame);
        break;
      case 'clockStop':
        this.clockRunning = false;
        break;
      case 'resetLoop':
        this.baseLoopLength = 0;
        break;
      case 'loadPhrase':
        this.loadPhrase(msg.track, msg.left, msg.right, msg.length, msg.tempo, msg.measures);
        break;
      case 'exportPhrase':
        this.exportPhrase(msg.track, msg.id);
        break;
      default:
        break;
    }
  }

  post(m) {
    this.port.postMessage(m);
  }

  loadPhrase(i, left, right, length, tempo, measures) {
    const tr = this.tracks[i];
    if (!tr) return;
    tr.clear();
    if (!length) return;
    tr.ensureCapacity(length);
    tr.buf[0].set(new Float32Array(left).subarray(0, length));
    tr.buf[1].set(new Float32Array(right).subarray(0, length));
    tr.length = length;
    tr.recordedTempo = tempo || this.tempo;
    tr.measures = measures || this.measuresFor(length, tr.recordedTempo);
    tr.state = 'stopped';
    if (!this.baseLoopLength && tr.loopSyncSw) this.baseLoopLength = length;
  }

  exportPhrase(i, id) {
    const tr = this.tracks[i];
    if (!tr || !tr.length) {
      this.post({ t: 'phrase', track: i, id, length: 0 });
      return;
    }
    const l = tr.buf[0].slice(0, tr.length);
    const r = tr.buf[1].slice(0, tr.length);
    this.post(
      {
        t: 'phrase',
        track: i,
        id,
        length: tr.length,
        tempo: tr.recordedTempo,
        measures: tr.measures,
        left: l.buffer,
        right: r.buffer,
      },
      [l.buffer, r.buffer],
    );
  }

  // -------------------------------------------------------------------------
  // Clock helpers
  // -------------------------------------------------------------------------

  get samplesPerBeat() {
    return (60 / this.tempo) * this.sr;
  }

  get samplesPerMeasure() {
    return this.samplesPerBeat * this.beatsPerMeasure;
  }

  setTempo(t) {
    if (!this.clockRunning) {
      this.tempo = t;
      return;
    }
    // Keep the current beat phase continuous when the tempo changes.
    const beats = (currentFrame - this.clockOrigin) / this.samplesPerBeat;
    this.tempo = t;
    this.clockOrigin = currentFrame - beats * this.samplesPerBeat;
  }

  startClock(atFrame) {
    this.clockRunning = true;
    this.clockOrigin = atFrame;
    this.loopOrigin = atFrame;
  }

  beatPosition(frame) {
    if (!this.clockRunning) return 0;
    return (frame - this.clockOrigin) / this.samplesPerBeat;
  }

  /** Next measure boundary at or after `frame`. */
  nextMeasureFrame(frame) {
    const spm = this.samplesPerMeasure;
    const rel = frame - this.clockOrigin;
    return this.clockOrigin + Math.ceil(rel / spm) * spm;
  }

  measuresFor(samples, tempo) {
    const spm = (60 / (tempo || this.tempo)) * this.sr * this.beatsPerMeasure;
    return Math.max(1, Math.round(samples / spm));
  }

  /** Loop length in samples implied by a track's MEASURE setting. */
  targetLength(tr) {
    const ms = tr.measureSetting;
    if (typeof ms === 'number' && ms > 0) return Math.round(ms * this.samplesPerMeasure);
    if (ms === 'AUTO' && this.baseLoopLength > 0) return this.baseLoopLength;
    return 0; // FREE, or AUTO with no reference yet
  }

  // -------------------------------------------------------------------------
  // Commands
  // -------------------------------------------------------------------------

  command(i, cmd, arg) {
    const tr = this.tracks[i];
    if (!tr) return;
    switch (cmd) {
      case 'rec':
        this.recPlayPress(i, tr);
        break;
      case 'play':
        this.startPlay(i, tr);
        break;
      case 'dub':
        this.startDub(i, tr);
        break;
      case 'stop':
        this.stopTrack(i, tr, arg?.immediate);
        break;
      case 'clear':
        tr.clear();
        this.recomputeBaseLoop();
        break;
      case 'undo':
        this.undoTrack(tr);
        break;
      case 'redo':
        this.undoTrack(tr); // undo/redo is the same swap operation
        break;
      case 'markSet':
        tr.mark = tr.snapshot();
        break;
      case 'markClear':
        tr.mark = null;
        break;
      case 'markBack':
        if (tr.mark) {
          const cur = tr.snapshot();
          tr.restore(tr.mark);
          tr.mark = cur;
          tr.undo = cur;
        } else if (tr.undo) {
          this.undoTrack(tr);
        }
        break;
      case 'retrig':
        this.retrig(i, tr);
        break;
      default:
        break;
    }
  }

  /** The [▶/●] button: cycles record → overdub/play according to REC ACTION. */
  recPlayPress(i, tr) {
    switch (tr.state) {
      case 'empty':
      case 'stopped':
        if (!tr.hasPhrase) this.startRec(i, tr);
        else this.startPlay(i, tr);
        break;
      case 'recording':
        if (this.recAction === 'REC->DUB') this.startDub(i, tr);
        else this.startPlay(i, tr);
        break;
      case 'playing':
        if (tr.oneShot || tr.reverse) this.retrig(i, tr);
        else this.startDub(i, tr);
        break;
      case 'overdubbing':
        this.startPlay(i, tr);
        break;
      case 'rec-standby':
        // cancel standby
        tr.state = tr.hasPhrase ? 'stopped' : 'empty';
        tr.pending = null;
        this.armedAutoRec.delete(i);
        break;
      case 'play-standby':
        tr.state = tr.hasPhrase ? 'stopped' : 'empty';
        tr.pending = null;
        break;
      case 'stopping':
        this.finishStop(tr);
        this.startPlay(i, tr);
        break;
      default:
        break;
    }
  }

  startRec(i, tr) {
    tr.redo = null;
    tr.pendingStop = null;
    if (this.autoRecSw) {
      tr.state = 'rec-standby';
      this.armedAutoRec.add(i);
      return;
    }
    const needQuantize = this.quantize === 'MEASURE' && this.clockRunning && this.hasSyncReference();
    if (needQuantize || (tr.loopSyncSw && tr.loopSyncMode !== 'IMMEDIATE' && this.clockRunning && this.hasSyncReference())) {
      tr.state = 'rec-standby';
      tr.pending = { cmd: 'rec', atFrame: this.nextMeasureFrame(currentFrame + 1) };
      return;
    }
    this.beginRecNow(i, tr, currentFrame);
  }

  hasSyncReference() {
    if (this.rhythmRunning) return true;
    return this.tracks.some((t) => t.loopSyncSw && t.hasPhrase);
  }

  beginRecNow(i, tr, atFrame) {
    tr.ensureCapacity(Math.ceil(INITIAL_SECONDS * this.sr));
    tr.buf[0].fill(0);
    tr.buf[1].fill(0);
    tr.recPos = 0;
    tr.length = 0;
    tr.state = 'recording';
    tr.gain = 1;
    tr.recordedTempo = this.tempo;
    tr.undo = null;
    tr.pending = null;
    if (!this.clockRunning) this.startClock(atFrame);
    if (this.baseLoopLength === 0) this.loopOrigin = atFrame;
    this.post({ t: 'recStart', track: i, clockOrigin: this.clockOrigin / this.sr });
  }

  startPlay(i, tr) {
    if (tr.state === 'recording' || tr.state === 'overdubbing') this.closeRecording(i, tr);
    if (!tr.hasPhrase) return;
    tr.pendingStop = null;
    tr.state = 'playing';
    tr.redo = null;
    if (tr.startMode === 'FADE') this.beginFade(tr, 0, 1, this.fadeInMeasures);
    else tr.gain = 1;
    if (!tr.loopSyncSw) {
      tr.playPos = 0;
      tr.retrigOffset = currentFrame;
    }
    tr.olaPhase = 0;
    tr.olaRead = 0;
    if (tr.playMode === 'SINGLE') this.applySingleMode(i);
  }

  retrig(i, tr) {
    if (!tr.hasPhrase) return;
    tr.state = 'playing';
    tr.pendingStop = null;
    tr.gain = 1;
    tr.playPos = 0;
    tr.retrigOffset = currentFrame;
    tr.olaPhase = 0;
    tr.olaRead = 0;
    if (tr.playMode === 'SINGLE') this.applySingleMode(i);
  }

  startDub(i, tr) {
    if (tr.state === 'recording') {
      this.closeRecording(i, tr);
      tr.state = 'overdubbing';
      tr.undo = tr.snapshot();
      tr.redo = null;
      tr.undoIsRedo = false;
      tr.gain = 1;
      return;
    }
    if (!tr.hasPhrase) return;
    if (tr.reverse || tr.oneShot) return; // not permitted on the hardware
    tr.undo = tr.snapshot();
    tr.redo = null;
    tr.undoIsRedo = false;
    tr.state = 'overdubbing';
    tr.pendingStop = null;
    tr.gain = 1;
    if (tr.playMode === 'SINGLE') this.applySingleMode(i);
  }

  /** Finish a first-pass recording: fix the loop length, derive tempo if needed. */
  closeRecording(i, tr) {
    if (tr.state !== 'recording') return;
    let len = tr.recPos;
    if (len < 128) {
      tr.clear();
      return;
    }
    const target = this.targetLength(tr);
    if (tr.loopSyncSw && target > 0) {
      len = target;
    } else if (tr.loopSyncSw && this.rhythmRunning) {
      const spm = this.samplesPerMeasure;
      len = Math.max(spm, Math.round(len / spm) * spm);
    } else if (tr.measureSetting === 'FREE' || !tr.loopSyncSw) {
      // keep the exact recorded length
    } else {
      // First loop-sync recording with no reference: it defines the grid.
      const spm = this.samplesPerMeasure;
      const measures = Math.max(1, Math.round(len / spm));
      let detected = (measures * this.beatsPerMeasure * 60 * this.sr) / len;
      // Keep the detected tempo in a musical band, like the hardware does: a
      // half-measure loop reads as double tempo otherwise.
      while (detected > 160) detected /= 2;
      while (detected < 80) detected *= 2;
      tr.recordedTempo = detected;
      if (tr.recordedTempo < 40 || tr.recordedTempo > 300) tr.recordedTempo = this.tempo;
      else {
        this.tempo = Math.round(tr.recordedTempo * 10) / 10;
        this.clockOrigin = this.loopOrigin;
        this.post({ t: 'tempoDetected', tempo: this.tempo });
      }
    }
    tr.ensureCapacity(len);
    if (len > tr.recPos) {
      tr.buf[0].fill(0, tr.recPos, len);
      tr.buf[1].fill(0, tr.recPos, len);
    }
    tr.length = len;
    tr.measures = this.measuresFor(len, tr.recordedTempo);
    if (tr.loopSyncSw && this.baseLoopLength === 0) {
      this.baseLoopLength = len;
      this.loopOrigin = this.clockOrigin;
    }
    tr.olaPhase = 0;
    tr.olaRead = 0;
    this.post({ t: 'recEnd', track: i, length: len, measures: tr.measures, tempo: tr.recordedTempo });
  }

  stopTrack(i, tr, immediate) {
    if (tr.state === 'empty') return;
    if (tr.state === 'recording' || tr.state === 'overdubbing') {
      const wasRec = tr.state === 'recording';
      if (wasRec) this.closeRecording(i, tr);
      if (!tr.hasPhrase) return;
    }
    if (tr.state === 'stopping' || immediate) {
      this.finishStop(tr);
      return;
    }
    if (tr.state === 'rec-standby' || tr.state === 'play-standby') {
      tr.pending = null;
      tr.state = tr.hasPhrase ? 'stopped' : 'empty';
      this.armedAutoRec.delete(i);
      return;
    }
    switch (tr.stopMode) {
      case 'FADE':
        tr.state = 'stopping';
        tr.pendingStop = 'fade';
        this.beginFade(tr, tr.gain, 0, this.fadeOutMeasures);
        break;
      case 'LOOP':
        tr.state = 'stopping';
        tr.pendingStop = 'loop';
        break;
      default:
        this.finishStop(tr);
    }
  }

  finishStop(tr) {
    tr.state = tr.hasPhrase ? 'stopped' : 'empty';
    tr.pendingStop = null;
    tr.fadeSamples = 0;
    tr.gain = 1;
    tr.playPos = 0;
  }

  beginFade(tr, from, to, measures) {
    const samples = Math.max(1, Math.round(measures * this.samplesPerMeasure));
    tr.gain = from;
    tr.targetGain = to;
    tr.fadeSamples = samples;
    tr.fadeDelta = (to - from) / samples;
  }

  undoTrack(tr) {
    if (!tr.undo) return;
    const cur = tr.snapshot();
    tr.restore(tr.undo);
    tr.undo = cur;
    tr.undoIsRedo = !tr.undoIsRedo;
  }

  applySingleMode(playing) {
    for (let j = 0; j < NUM_TRACKS; j++) {
      if (j === playing) continue;
      const o = this.tracks[j];
      if (o.state === 'playing' || o.state === 'overdubbing') {
        if (this.singleTrackChange === 'IMMEDIATE') this.finishStop(o);
        else {
          o.state = 'stopping';
          o.pendingStop = this.singleTrackChange === 'MEASURE' ? 'measure' : 'loop';
        }
      }
    }
  }

  allStart() {
    const anyActive = this.tracks.some(
      (t, i) => this.allStartTrack[i] && ['playing', 'recording', 'overdubbing'].includes(t.state),
    );
    if (anyActive) {
      this.allStop();
      return;
    }
    if (!this.clockRunning) this.startClock(currentFrame);
    this.loopOrigin = this.clockOrigin;
    for (let i = 0; i < NUM_TRACKS; i++) {
      if (!this.allStartTrack[i]) continue;
      const tr = this.tracks[i];
      if (tr.hasPhrase) this.startPlay(i, tr);
    }
    this.post({ t: 'allStart' });
  }

  allStop(mode) {
    for (let i = 0; i < NUM_TRACKS; i++) {
      if (!this.allStopTrack[i]) continue;
      const tr = this.tracks[i];
      if (tr.state === 'recording' || tr.state === 'overdubbing') this.closeRecording(i, tr);
      this.stopTrack(i, tr, mode === 'immediate');
    }
    this.post({ t: 'allStop' });
  }

  recomputeBaseLoop() {
    if (this.tracks.some((t) => t.loopSyncSw && t.hasPhrase)) return;
    this.baseLoopLength = 0;
    if (!this.tracks.some((t) => t.hasPhrase) && !this.rhythmRunning) this.clockRunning = false;
  }

  // -------------------------------------------------------------------------
  // Audio rendering
  // -------------------------------------------------------------------------

  /** Read one interpolated stereo sample from a track buffer. */
  read(tr, pos, out) {
    const len = tr.length;
    let p = pos;
    if (tr.reverse) p = len - 1 - p;
    if (p < 0) p += len;
    const i0 = Math.floor(p);
    const frac = p - i0;
    const i1 = i0 + 1 >= len ? 0 : i0 + 1;
    out[0] = tr.buf[0][i0] * (1 - frac) + tr.buf[0][i1] * frac;
    out[1] = tr.buf[1][i0] * (1 - frac) + tr.buf[1][i1] * frac;
  }

  process(inputs, outputs) {
    const bounce = inputs[NUM_TRACKS];
    const n = outputs[0][0].length;
    const frame0 = currentFrame;

    const bnL = bounce && bounce[0] ? bounce[0] : null;
    const bnR = bounce && bounce[1] ? bounce[1] : bnL;

    // Per-track input peaks (for AUTO REC and the LCD level meter).
    let ipk = 0;
    for (let i = 0; i < NUM_TRACKS; i++) {
      const s = inputs[i];
      const l = s && s[0] ? s[0] : null;
      if (!l) continue;
      let pk = 0;
      for (let k = 0; k < n; k += 2) {
        const v = Math.abs(l[k]);
        if (v > pk) pk = v;
      }
      if (pk > ipk) ipk = pk;
      // AUTO REC trigger, evaluated against this track's own input.
      if (this.armedAutoRec.has(i) && pk > this.autoRecSens / 400) {
        const tr = this.tracks[i];
        if (tr.state === 'rec-standby') this.beginRecNow(i, tr, frame0);
        this.armedAutoRec.delete(i);
      }
    }
    this.inputPeak = Math.max(this.inputPeak * 0.85, ipk);

    // Quantized command boundaries
    for (let i = 0; i < NUM_TRACKS; i++) {
      const tr = this.tracks[i];
      if (tr.pending && frame0 + n > tr.pending.atFrame) {
        const at = Math.max(frame0, Math.round(tr.pending.atFrame));
        if (tr.pending.cmd === 'rec') this.beginRecNow(i, tr, at);
        else if (tr.pending.cmd === 'play') this.startPlay(i, tr);
        tr.pending = null;
      }
    }

    const globalPos = frame0 - this.loopOrigin;
    const spm = this.samplesPerMeasure;
    const smp = [0, 0];

    for (let i = 0; i < NUM_TRACKS; i++) {
      const tr = this.tracks[i];
      const outL = outputs[i][0];
      const outR = outputs[i][1] ?? outL;
      outL.fill(0);
      if (outR !== outL) outR.fill(0);

      const src = inputs[i];
      const srcL = src && src[0] ? src[0] : null;
      const srcR = src && src[1] ? src[1] : srcL;
      const st = tr.state;

      // --- recording (first pass) -------------------------------------------
      if (st === 'recording') {
        if (!tr.ensureCapacity(tr.recPos + n)) {
          this.closeRecording(i, tr);
        } else {
          const a = tr.buf[0];
          const b = tr.buf[1];
          for (let k = 0; k < n; k++) {
            let l = srcL ? srcL[k] : 0;
            let r = srcR ? srcR[k] : 0;
            if (tr.bounceIn && bnL) {
              l += bnL[k];
              r += bnR ? bnR[k] : bnL[k];
            }
            a[tr.recPos] = l;
            b[tr.recPos] = r;
            tr.recPos++;
          }
          // Auto-close when a target length is reached (MEASURE / LOOP SYNC).
          const target = this.targetLength(tr);
          if (target > 0 && tr.recPos >= target) {
            this.closeRecording(i, tr);
            if (this.recAction === 'REC->DUB') {
              tr.state = 'overdubbing';
              tr.undo = tr.snapshot();
            } else {
              tr.state = 'playing';
            }
          }
        }
        this.meter(tr, srcL, srcR, n);
        continue;
      }

      if (!tr.hasPhrase || st === 'empty' || st === 'stopped' || st === 'rec-standby' || st === 'play-standby') {
        tr.peak *= 0.8;
        continue;
      }

      // --- playback / overdub ----------------------------------------------
      const len = tr.length;
      const rate = tr.rate(this.tempo);
      const stretch = tr.tempoSyncSw && tr.tempoSyncMode === 'XFADE' && Math.abs(rate - 1) > 1e-4;
      const levelGain = (tr.playLevel / 100) * (tr.fader / 100);
      const panRad = ((tr.pan / 50) * Math.PI) / 4 + Math.PI / 4;
      const panL = Math.cos(panRad);
      const panR = Math.sin(panRad);
      const dubbing = st === 'overdubbing';
      const replace = dubbing && tr.dubMode !== 'OVERDUB';
      const silentPlay = dubbing && tr.dubMode === 'REPLACE2';

      let wrapped = false;
      for (let k = 0; k < n; k++) {
        let pos;
        if (tr.loopSyncSw) {
          const gp = (globalPos + k) * rate;
          pos = gp % len;
          if (pos < 0) pos += len;
        } else {
          pos = tr.playPos;
          tr.playPos += rate;
          if (tr.playPos >= len) {
            tr.playPos -= len;
            wrapped = true;
          }
        }

        if (stretch) {
          // Overlap-add read for pitch-independent speed change.
          this.readOla(tr, pos, rate, smp);
        } else {
          this.read(tr, pos, smp);
        }

        // Fade envelope
        if (tr.fadeSamples > 0) {
          tr.gain += tr.fadeDelta;
          tr.fadeSamples--;
          if (tr.fadeSamples === 0) tr.gain = tr.targetGain;
        }

        const g = tr.gain * levelGain;
        if (!silentPlay) {
          outL[k] = smp[0] * g * panL * 1.4142;
          if (outR !== outL) outR[k] = smp[1] * g * panR * 1.4142;
        }

        if (dubbing) {
          const idx = Math.floor(tr.reverse ? len - 1 - pos : pos);
          let l = srcL ? srcL[k] : 0;
          let r = srcR ? srcR[k] : l;
          if (tr.bounceIn && bnL) {
            l += bnL[k];
            r += bnR ? bnR[k] : bnL[k];
          }
          if (replace) {
            tr.buf[0][idx] = l;
            tr.buf[1][idx] = r;
          } else {
            tr.buf[0][idx] = Math.max(-4, Math.min(4, tr.buf[0][idx] + l));
            tr.buf[1][idx] = Math.max(-4, Math.min(4, tr.buf[1][idx] + r));
          }
        }
      }

      this.meterOut(tr, outL, outR, n);

      // --- loop-boundary bookkeeping ---------------------------------------
      const posEnd = tr.loopSyncSw ? (((globalPos + n) * rate) % len + len) % len : tr.playPos;
      const posStart = tr.loopSyncSw ? ((globalPos * rate) % len + len) % len : posEnd;
      if (tr.loopSyncSw) wrapped = posEnd < posStart;

      if (wrapped) {
        if (tr.oneShot) {
          this.finishStop(tr);
          continue;
        }
        if (tr.pendingStop === 'loop') {
          this.finishStop(tr);
          continue;
        }
      }
      if (tr.pendingStop === 'measure' && this.clockRunning) {
        const rel = frame0 - this.clockOrigin;
        if (Math.floor((rel + n) / spm) > Math.floor(rel / spm)) {
          this.finishStop(tr);
          continue;
        }
      }
      if (tr.pendingStop === 'fade' && tr.fadeSamples === 0) {
        this.finishStop(tr);
        continue;
      }
    }

    this.blockCount++;
    if (this.blockCount % 4 === 0) this.sendStatus();
    return true;
  }

  /** Simple two-grain overlap-add reader for pitch-preserving speed change. */
  readOla(tr, pos, rate, out) {
    const len = tr.length;
    const g = GRAIN;
    const half = g / 2;
    const phase = tr.olaPhase;
    // Read pointer advances at `rate` relative to the (already rate-scaled) pos.
    const readBase = pos / rate; // undo the rate scaling so pitch is preserved
    const p1 = (readBase % len + len) % len;
    const p2 = ((readBase + half) % len + len) % len;
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * phase) / g);
    const a = [0, 0];
    const b = [0, 0];
    this.read(tr, p1, a);
    this.read(tr, p2, b);
    out[0] = a[0] * (1 - w) + b[0] * w;
    out[1] = a[1] * (1 - w) + b[1] * w;
    tr.olaPhase = (phase + 1) % g;
  }

  meter(tr, l, r, n) {
    let pk = 0;
    for (let k = 0; k < n; k++) {
      const v = Math.max(Math.abs(l ? l[k] : 0), Math.abs(r ? r[k] : 0));
      if (v > pk) pk = v;
    }
    tr.peak = Math.max(tr.peak * 0.8, pk);
  }

  meterOut(tr, l, r, n) {
    let pk = 0;
    for (let k = 0; k < n; k += 4) {
      const v = Math.max(Math.abs(l[k]), Math.abs(r[k]));
      if (v > pk) pk = v;
    }
    tr.peak = Math.max(tr.peak * 0.82, pk);
  }

  sendStatus() {
    const beat = this.beatPosition(currentFrame);
    const tracks = new Array(NUM_TRACKS);
    for (let i = 0; i < NUM_TRACKS; i++) {
      const tr = this.tracks[i];
      let position = 0;
      if (tr.length > 0) {
        if (tr.state === 'recording') {
          const target = this.targetLength(tr);
          position = target > 0 ? Math.min(1, tr.recPos / target) : 0;
        } else if (tr.loopSyncSw) {
          const rate = tr.rate(this.tempo);
          position = ((((currentFrame - this.loopOrigin) * rate) % tr.length) + tr.length) % tr.length / tr.length;
        } else {
          position = tr.playPos / tr.length;
        }
      } else if (tr.state === 'recording') {
        const target = this.targetLength(tr);
        position = target > 0 ? Math.min(1, tr.recPos / target) : (tr.recPos / this.sr / 4) % 1;
      }
      tracks[i] = {
        state: tr.state,
        position: tr.reverse && tr.state !== 'recording' ? 1 - position : position,
        lengthSeconds: (tr.length || tr.recPos) / this.sr,
        measures: tr.measures,
        level: tr.peak,
        undoAvailable: !!tr.undo && !tr.undoIsRedo,
        redoAvailable: !!tr.undo && tr.undoIsRedo,
        markSet: !!tr.mark,
        hasPhrase: tr.hasPhrase,
      };
    }
    // Integer counters: the UI compares them against beat indices.
    const beatIndex = Math.floor(beat);
    const bpm = this.beatsPerMeasure;
    this.post({
      t: 'status',
      beat: beatIndex,
      beatPhase: beat - beatIndex,
      measure: Math.floor(beatIndex / bpm),
      beatInMeasure: ((beatIndex % bpm) + bpm) % bpm,
      running: this.clockRunning,
      tempo: this.tempo,
      clockOrigin: this.clockOrigin / this.sr,
      loopLengthSeconds: this.baseLoopLength / this.sr,
      inputPeak: this.inputPeak,
      tracks,
    });
  }
}

registerProcessor('looper-processor', LooperProcessor);
