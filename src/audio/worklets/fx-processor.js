/**
 * DSP worklets for the Input FX / Track FX types that cannot be built from
 * native Web Audio nodes: granular pitch shifting, bit/rate reduction, ring
 * modulation, slow gear, the beat-loop family (ROLL, BEAT REPEAT/SCATTER/SHIFT,
 * FREEZE, REVERSE DELAY) and the vocoder / oscillator voices.
 *
 * All of them accept parameter updates as `port.postMessage({...})`.
 */

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

class Biquad {
  constructor() {
    this.b0 = 1;
    this.b1 = 0;
    this.b2 = 0;
    this.a1 = 0;
    this.a2 = 0;
    this.x1 = 0;
    this.x2 = 0;
    this.y1 = 0;
    this.y2 = 0;
  }

  bandpass(f, q, sr) {
    const w = (2 * Math.PI * Math.min(f, sr * 0.45)) / sr;
    const alpha = Math.sin(w) / (2 * Math.max(0.05, q));
    const cosw = Math.cos(w);
    const a0 = 1 + alpha;
    this.b0 = alpha / a0;
    this.b1 = 0;
    this.b2 = -alpha / a0;
    this.a1 = (-2 * cosw) / a0;
    this.a2 = (1 - alpha) / a0;
  }

  lowpass(f, q, sr) {
    const w = (2 * Math.PI * Math.min(f, sr * 0.45)) / sr;
    const alpha = Math.sin(w) / (2 * Math.max(0.05, q));
    const cosw = Math.cos(w);
    const a0 = 1 + alpha;
    this.b0 = ((1 - cosw) / 2) / a0;
    this.b1 = (1 - cosw) / a0;
    this.b2 = this.b0;
    this.a1 = (-2 * cosw) / a0;
    this.a2 = (1 - alpha) / a0;
  }

  process(x) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

const hann = (x) => 0.5 - 0.5 * Math.cos(2 * Math.PI * x);

// ---------------------------------------------------------------------------
// Granular pitch shifter — OCTAVE, TRANSPOSE, PITCH BEND, ROBOT, ELECTRIC,
// G2B, HRM MANUAL, GRANULAR DELAY.
// ---------------------------------------------------------------------------

class PitchShiftProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'semitones', defaultValue: 0, minValue: -48, maxValue: 48, automationRate: 'k-rate' },
      { name: 'mix', defaultValue: 1, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    ];
  }

  constructor(options) {
    super();
    const opt = options?.processorOptions ?? {};
    this.grain = opt.grain ?? 3072;
    this.size = 1 << 16;
    this.mask = this.size - 1;
    this.buf = [new Float32Array(this.size), new Float32Array(this.size)];
    this.w = 0;
    this.phase = 0;
    this.smooth = 0;
    this.target = 0;
    this.glide = opt.glide ?? 0; // seconds; ELECTRIC-style stepped glide
    this.port.onmessage = (e) => {
      if (typeof e.data.glide === 'number') this.glide = e.data.glide;
    };
  }

  process(inputs, outputs, params) {
    const inp = inputs[0];
    const out = outputs[0];
    const n = out[0].length;
    const semi = params.semitones[0];
    const mix = params.mix[0];
    const g = this.grain;
    const k = this.glide > 0 ? Math.min(1, 1 / (this.glide * sampleRate)) : 1;

    for (let c = 0; c < out.length; c++) {
      const src = inp[Math.min(c, inp.length - 1)];
      const dst = out[c];
      const buf = this.buf[c];
      let w = this.w;
      let phase = this.phase;
      let sm = this.smooth;
      for (let i = 0; i < n; i++) {
        const x = src ? src[i] : 0;
        buf[w & this.mask] = x;
        sm += (semi - sm) * k;
        const rate = Math.pow(2, sm / 12);
        const d1 = phase;
        const d2 = (phase + g / 2) % g;
        const r1 = w - d1;
        const r2 = w - d2;
        const i1 = Math.floor(r1);
        const f1 = r1 - i1;
        const i2 = Math.floor(r2);
        const f2 = r2 - i2;
        const s1 =
          buf[i1 & this.mask] * (1 - f1) + buf[(i1 + 1) & this.mask] * f1;
        const s2 =
          buf[i2 & this.mask] * (1 - f2) + buf[(i2 + 1) & this.mask] * f2;
        const wet = s1 * hann(d1 / g) + s2 * hann(d2 / g);
        dst[i] = wet * mix + x * (1 - mix);
        phase += 1 - rate;
        while (phase < 0) phase += g;
        while (phase >= g) phase -= g;
        w++;
      }
      if (c === out.length - 1) {
        this.w = w;
        this.phase = phase;
        this.smooth = sm;
      }
    }
    return true;
  }
}

// ---------------------------------------------------------------------------
// LO-FI / RADIO — bit depth and sample-rate reduction plus radio-style noise.
// ---------------------------------------------------------------------------

class LofiProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = options?.processorOptions ?? {};
    this.bits = o.bits ?? 8;
    this.divide = o.divide ?? 4;
    this.noise = o.noise ?? 0;
    this.hold = [0, 0];
    this.count = 0;
    this.port.onmessage = (e) => Object.assign(this, e.data);
  }

  process(inputs, outputs) {
    const inp = inputs[0];
    const out = outputs[0];
    const n = out[0].length;
    const div = Math.max(1, Math.round(this.divide));
    const levels = this.bits > 0 ? Math.pow(2, this.bits - 1) : 0;
    for (let i = 0; i < n; i++) {
      const sample = this.count % div === 0;
      for (let c = 0; c < out.length; c++) {
        const src = inp[Math.min(c, inp.length - 1)];
        let x = src ? src[i] : 0;
        if (sample) {
          if (levels > 0) x = Math.round(x * levels) / levels;
          this.hold[c] = x;
        }
        let y = this.hold[c];
        if (this.noise > 0) y += (Math.random() * 2 - 1) * this.noise * 0.03;
        out[c][i] = y;
      }
      this.count++;
    }
    return true;
  }
}

// ---------------------------------------------------------------------------
// RING.MOD
// ---------------------------------------------------------------------------

class RingModProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'frequency', defaultValue: 400, minValue: 1, maxValue: 8000, automationRate: 'k-rate' },
      { name: 'balance', defaultValue: 0.5, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    ];
  }

  constructor(options) {
    super();
    this.phase = 0;
    this.mode = options?.processorOptions?.mode ?? 1;
    this.port.onmessage = (e) => Object.assign(this, e.data);
  }

  process(inputs, outputs, params) {
    const inp = inputs[0];
    const out = outputs[0];
    const n = out[0].length;
    const f = params.frequency[0];
    const bal = params.balance[0];
    const inc = (2 * Math.PI * f) / sampleRate;
    for (let i = 0; i < n; i++) {
      const carrier = this.mode === 2 ? Math.sign(Math.sin(this.phase)) : Math.sin(this.phase);
      for (let c = 0; c < out.length; c++) {
        const src = inp[Math.min(c, inp.length - 1)];
        const x = src ? src[i] : 0;
        out[c][i] = x * (1 - bal) + x * carrier * bal * 1.4;
      }
      this.phase += inc;
      if (this.phase > 2 * Math.PI) this.phase -= 2 * Math.PI;
    }
    return true;
  }
}

// ---------------------------------------------------------------------------
// SLOW GEAR — volume swell driven by the input envelope.
// ---------------------------------------------------------------------------

class SlowGearProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = options?.processorOptions ?? {};
    this.sens = o.sens ?? 0.5;
    this.riseTime = o.riseTime ?? 0.15;
    this.level = o.level ?? 1;
    this.env = 0;
    this.gain = 0;
    this.gate = false;
    this.port.onmessage = (e) => Object.assign(this, e.data);
  }

  process(inputs, outputs) {
    const inp = inputs[0];
    const out = outputs[0];
    const n = out[0].length;
    const rel = Math.exp(-1 / (0.05 * sampleRate));
    const riseInc = 1 / Math.max(1, this.riseTime * sampleRate);
    const thresh = 0.02 + (1 - this.sens) * 0.2;
    for (let i = 0; i < n; i++) {
      const src = inp[0];
      const x = src ? Math.abs(src[i]) : 0;
      this.env = Math.max(x, this.env * rel);
      if (!this.gate && this.env > thresh) {
        this.gate = true;
        this.gain = 0;
      } else if (this.gate && this.env < thresh * 0.4) {
        this.gate = false;
      }
      if (this.gate) this.gain = Math.min(1, this.gain + riseInc);
      else this.gain *= 0.999;
      const g = this.gain * this.level;
      for (let c = 0; c < out.length; c++) {
        const s = inp[Math.min(c, inp.length - 1)];
        out[c][i] = (s ? s[i] : 0) * g;
      }
    }
    return true;
  }
}

// ---------------------------------------------------------------------------
// Beat loop family: ROLL1/2, BEAT REPEAT, BEAT SCATTER, BEAT SHIFT, FREEZE,
// WARP, REVERSE DELAY. One circular capture buffer, several read strategies.
// ---------------------------------------------------------------------------

const SCATTER_PATTERNS = {
  P1: [0, 1, 2, 3, 2, 3, 0, 1],
  P2: [0, 0, 2, 2, 1, 1, 3, 3],
  P3: [3, 2, 1, 0, 3, 2, 1, 0],
  P4: [0, 2, 1, 3, 1, 0, 3, 2],
};

class BeatFxProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = options?.processorOptions ?? {};
    this.size = Math.ceil((o.maxSeconds ?? 8) * sampleRate);
    this.buf = [new Float32Array(this.size), new Float32Array(this.size)];
    this.w = 0;
    this.mode = o.mode ?? 'roll'; // roll | roll2 | repeat | scatter | shift | freeze | reverse
    this.active = false;
    this.lengthSamples = Math.round(0.25 * sampleRate);
    this.feedback = 0.8;
    this.balance = 1;
    this.pattern = 'P1';
    this.level = 0.8;
    this.slice = 0;
    this.readPhase = 0;
    this.repeats = 0;
    this.captureStart = 0;
    this.captured = 0;
    this.fade = 0;
    this.port.onmessage = (e) => {
      const d = e.data;
      if (d.active !== undefined && d.active !== this.active) {
        this.active = d.active;
        if (this.active) this.trigger();
      }
      for (const key of ['lengthSamples', 'feedback', 'balance', 'pattern', 'level', 'mode']) {
        if (d[key] !== undefined) this[key] = d[key];
      }
    };
  }

  trigger() {
    this.captureStart = this.w;
    this.captured = 0;
    this.readPhase = 0;
    this.repeats = 0;
    this.slice = 0;
    this.fade = 0;
  }

  read(c, index) {
    const buf = this.buf[c];
    let idx = index % this.size;
    if (idx < 0) idx += this.size;
    const i0 = Math.floor(idx);
    const f = idx - i0;
    const i1 = (i0 + 1) % this.size;
    return buf[i0] * (1 - f) + buf[i1] * f;
  }

  process(inputs, outputs) {
    const inp = inputs[0];
    const out = outputs[0];
    const n = out[0].length;
    const len = Math.max(64, Math.min(this.size - 1, Math.round(this.lengthSamples)));
    const channels = out.length;

    for (let i = 0; i < n; i++) {
      for (let c = 0; c < channels; c++) {
        const src = inp[Math.min(c, inp.length - 1)];
        this.buf[c][this.w] = src ? src[i] : 0;
      }

      if (!this.active) {
        for (let c = 0; c < channels; c++) out[c][i] = this.buf[c][this.w];
        this.w = (this.w + 1) % this.size;
        this.fade = 0;
        continue;
      }

      // Fill the capture window before looping it.
      if (this.captured < len) this.captured++;
      const filled = this.captured >= len;
      const decay = Math.pow(this.feedback, this.repeats * 0.35);

      for (let c = 0; c < channels; c++) {
        let wet;
        if (!filled) {
          wet = this.buf[c][this.w];
        } else {
          let idx;
          switch (this.mode) {
            case 'reverse':
              idx = this.captureStart + len - 1 - this.readPhase;
              break;
            case 'roll2':
              // Alternating forward / backward slices.
              idx =
                this.repeats % 2 === 0
                  ? this.captureStart + this.readPhase
                  : this.captureStart + len - 1 - this.readPhase;
              break;
            case 'scatter': {
              const pat = SCATTER_PATTERNS[this.pattern] ?? SCATTER_PATTERNS.P1;
              const slot = pat[this.repeats % pat.length];
              idx = this.captureStart + slot * len + this.readPhase;
              break;
            }
            case 'shift':
              idx = this.w - len;
              break;
            case 'freeze':
            case 'warp': {
              // Crossfaded loop of the captured grain, so it sustains cleanly.
              const half = len / 2;
              const p = this.readPhase;
              const a = this.read(c, this.captureStart + p);
              const b = this.read(c, this.captureStart + ((p + half) % len));
              const wf = hann(((p + half) % len) / len);
              out[c][i] = (a * (1 - wf) + b * wf) * this.level;
              continue;
            }
            default:
              idx = this.captureStart + this.readPhase;
          }
          wet = this.read(c, idx) * decay;
        }
        const dry = this.buf[c][this.w];
        out[c][i] = wet * this.balance + dry * (1 - this.balance);
      }

      if (filled) {
        this.readPhase++;
        if (this.readPhase >= len) {
          this.readPhase = 0;
          this.repeats++;
        }
      }
      this.w = (this.w + 1) % this.size;
    }
    return true;
  }
}

// ---------------------------------------------------------------------------
// VOCODER / OSC VOC / OSC BOT / SYNTH — filter-bank vocoder with an internal
// carrier oscillator.
// ---------------------------------------------------------------------------

const BANDS = [180, 250, 350, 480, 660, 900, 1250, 1700, 2300, 3200, 4400, 6000];

class VocoderProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = options?.processorOptions ?? {};
    this.carrierType = o.carrier ?? 'SAW';
    this.frequency = o.frequency ?? 110;
    this.balance = o.balance ?? 1;
    this.tone = o.tone ?? 0;
    this.attack = o.attack ?? 0.02;
    this.release = o.release ?? 0.05;
    this.modSens = o.modSens ?? 0.5;
    this.carrierThru = false;
    this.follow = !!o.follow; // track the input pitch (SYNTH / ROBOT style)
    this.phase = 0;
    this.modFilters = BANDS.map(() => new Biquad());
    this.carFilters = BANDS.map(() => new Biquad());
    this.envs = new Float32Array(BANDS.length);
    this.prev = 0;
    this.zcCount = 0;
    this.zcFrames = 0;
    this.detected = 110;
    this.updateFilters();
    this.port.onmessage = (e) => {
      Object.assign(this, e.data);
      if (e.data.tone !== undefined) this.updateFilters();
    };
  }

  updateFilters() {
    const tilt = 1 + this.tone / 100;
    for (let b = 0; b < BANDS.length; b++) {
      const f = BANDS[b] * tilt;
      this.modFilters[b].bandpass(f, 4, sampleRate);
      this.carFilters[b].bandpass(f, 4, sampleRate);
    }
  }

  carrier(phase) {
    switch (this.carrierType) {
      case 'SQR':
        return phase < Math.PI ? 1 : -1;
      case 'PULSE':
        return phase < Math.PI * 0.25 ? 1 : -1;
      case 'NOISE':
        return Math.random() * 2 - 1;
      case 'SYNTH': {
        const t = phase / (2 * Math.PI);
        return 2 * (t < 0.5 ? t * 2 : 2 - t * 2) - 1;
      }
      default: {
        // SAW
        return 1 - phase / Math.PI;
      }
    }
  }

  process(inputs, outputs) {
    const inp = inputs[0];
    const out = outputs[0];
    const n = out[0].length;
    const src = inp[0];
    const atk = Math.exp(-1 / Math.max(1, this.attack * sampleRate));
    const rel = Math.exp(-1 / Math.max(1, this.release * sampleRate));
    const gain = 1 + this.modSens * 2;

    for (let i = 0; i < n; i++) {
      const x = src ? src[i] : 0;

      // Cheap zero-crossing pitch tracking for the pitch-following modes.
      if (this.follow) {
        if (this.prev <= 0 && x > 0) this.zcCount++;
        this.prev = x;
        this.zcFrames++;
        if (this.zcFrames >= sampleRate / 20) {
          const f = (this.zcCount * sampleRate) / this.zcFrames / 2;
          if (f > 50 && f < 1200) this.detected += (f - this.detected) * 0.5;
          this.zcCount = 0;
          this.zcFrames = 0;
        }
      }

      const freq = this.follow ? this.detected : this.frequency;
      this.phase += (2 * Math.PI * freq) / sampleRate;
      if (this.phase > 2 * Math.PI) this.phase -= 2 * Math.PI;
      const car = this.carrier(this.phase);

      let wet = 0;
      for (let b = 0; b < BANDS.length; b++) {
        const m = Math.abs(this.modFilters[b].process(x));
        const e = this.envs[b];
        this.envs[b] = m > e ? m + (e - m) * atk : m + (e - m) * rel;
        wet += this.carFilters[b].process(car) * this.envs[b] * gain;
      }
      if (this.carrierThru) wet += car * 0.15;
      const y = wet * this.balance + x * (1 - this.balance);
      for (let c = 0; c < out.length; c++) out[c][i] = y;
    }
    return true;
  }
}

// ---------------------------------------------------------------------------
// SYNTH — monophonic saw/square voice that tracks the input pitch, with a
// resonant filter and its own decay envelope.
// ---------------------------------------------------------------------------

class SynthProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = options?.processorOptions ?? {};
    this.frequency = o.frequency ?? 0.5; // filter frequency 0..1
    this.resonance = o.resonance ?? 0.5;
    this.decay = o.decay ?? 0.5;
    this.balance = o.balance ?? 0.5;
    this.phase = 0;
    this.env = 0;
    this.detected = 110;
    this.prev = 0;
    this.zcCount = 0;
    this.zcFrames = 0;
    this.filter = new Biquad();
    this.gate = false;
    this.port.onmessage = (e) => Object.assign(this, e.data);
  }

  process(inputs, outputs) {
    const inp = inputs[0];
    const out = outputs[0];
    const n = out[0].length;
    const src = inp[0];
    const cutoff = 120 * Math.pow(60, this.frequency);
    this.filter.lowpass(cutoff, 0.5 + this.resonance * 12, sampleRate);
    const decayCoef = Math.exp(-1 / Math.max(1, (0.03 + this.decay * 1.5) * sampleRate));

    for (let i = 0; i < n; i++) {
      const x = src ? src[i] : 0;
      if (this.prev <= 0 && x > 0) this.zcCount++;
      this.prev = x;
      this.zcFrames++;
      if (this.zcFrames >= sampleRate / 25) {
        const f = (this.zcCount * sampleRate) / this.zcFrames / 2;
        if (f > 40 && f < 1500) this.detected += (f - this.detected) * 0.6;
        this.zcCount = 0;
        this.zcFrames = 0;
      }
      const amp = Math.abs(x);
      if (amp > 0.03 && !this.gate) {
        this.gate = true;
        this.env = 1;
      } else if (amp < 0.01) {
        this.gate = false;
      }
      this.env *= decayCoef;
      this.phase += (2 * Math.PI * this.detected) / sampleRate;
      if (this.phase > 2 * Math.PI) this.phase -= 2 * Math.PI;
      const saw = 1 - this.phase / Math.PI;
      const wet = this.filter.process(saw * this.env) * 0.8;
      const y = wet * this.balance + x * (1 - this.balance);
      for (let c = 0; c < out.length; c++) out[c][i] = y;
    }
    return true;
  }
}

// ---------------------------------------------------------------------------
// Peak meter — taps a bus and reports L/R peaks to the main thread.
// ---------------------------------------------------------------------------

class MeterProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.peakL = 0;
    this.peakR = 0;
    this.count = 0;
  }

  process(inputs) {
    const inp = inputs[0];
    if (inp && inp[0]) {
      const l = inp[0];
      const r = inp[1] ?? inp[0];
      for (let i = 0; i < l.length; i += 4) {
        const a = Math.abs(l[i]);
        const b = Math.abs(r[i]);
        if (a > this.peakL) this.peakL = a;
        if (b > this.peakR) this.peakR = b;
      }
    }
    if (++this.count % 8 === 0) {
      this.port.postMessage([this.peakL, this.peakR]);
      this.peakL *= 0.6;
      this.peakR *= 0.6;
    }
    return true;
  }
}

registerProcessor('pitch-shift', PitchShiftProcessor);
registerProcessor('lofi-fx', LofiProcessor);
registerProcessor('ringmod-fx', RingModProcessor);
registerProcessor('slowgear-fx', SlowGearProcessor);
registerProcessor('beat-fx', BeatFxProcessor);
registerProcessor('vocoder-fx', VocoderProcessor);
registerProcessor('synth-fx', SynthProcessor);
registerProcessor('meter', MeterProcessor);
