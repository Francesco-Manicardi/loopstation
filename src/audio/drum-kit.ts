/**
 * Drum kit synthesis. The 16 kits named in LOOP/RHYTHM/KIT are each rendered
 * once into a small bank of AudioBuffers via an OfflineAudioContext, then played
 * back by the rhythm sequencer with sample-accurate scheduling.
 */

import type { Inst } from '../data/rhythm-patterns';

export interface KitProfile {
  /** Pitch multiplier applied to tonal voices. */
  tune: number;
  /** Decay multiplier. */
  decay: number;
  /** Noise-vs-tone balance for snare/hats, 0..1. */
  noise: number;
  /** Brightness (high shelf) 0..1. */
  bright: number;
  /** Analog / electronic voicing (808-909 style long-tail kick, clap snare). */
  electronic: number;
  /** Brushed / soft transient character. */
  brush: number;
}

const KIT_PROFILES: Record<string, KitProfile> = {
  STUDIO: { tune: 1.0, decay: 1.0, noise: 0.5, bright: 0.55, electronic: 0, brush: 0 },
  LIVE: { tune: 0.98, decay: 1.25, noise: 0.55, bright: 0.6, electronic: 0, brush: 0 },
  LIGHT: { tune: 1.08, decay: 0.85, noise: 0.45, bright: 0.65, electronic: 0, brush: 0.15 },
  HEAVY: { tune: 0.88, decay: 1.15, noise: 0.6, bright: 0.45, electronic: 0, brush: 0 },
  ROCK: { tune: 0.94, decay: 1.1, noise: 0.6, bright: 0.6, electronic: 0, brush: 0 },
  METAL: { tune: 0.84, decay: 0.9, noise: 0.7, bright: 0.75, electronic: 0, brush: 0 },
  JAZZ: { tune: 1.06, decay: 0.9, noise: 0.4, bright: 0.5, electronic: 0, brush: 0.1 },
  BRUSH: { tune: 1.04, decay: 0.95, noise: 0.35, bright: 0.4, electronic: 0, brush: 0.8 },
  CAJON: { tune: 0.96, decay: 0.7, noise: 0.3, bright: 0.45, electronic: 0, brush: 0.35 },
  'DRUM&BASS': { tune: 0.9, decay: 0.7, noise: 0.75, bright: 0.8, electronic: 0.6, brush: 0 },
  'R&B': { tune: 1.0, decay: 0.85, noise: 0.5, bright: 0.5, electronic: 0.35, brush: 0 },
  DANCE: { tune: 0.95, decay: 0.9, noise: 0.6, bright: 0.7, electronic: 0.75, brush: 0 },
  TECHNO: { tune: 0.88, decay: 1.0, noise: 0.65, bright: 0.75, electronic: 0.9, brush: 0 },
  'DANCE BEATS': { tune: 0.92, decay: 0.8, noise: 0.6, bright: 0.72, electronic: 0.8, brush: 0 },
  HIPHOP: { tune: 0.86, decay: 1.1, noise: 0.55, bright: 0.5, electronic: 0.7, brush: 0 },
  '808+909': { tune: 0.8, decay: 1.6, noise: 0.5, bright: 0.6, electronic: 1, brush: 0 },
};

export function kitProfile(name: string): KitProfile {
  return KIT_PROFILES[name] ?? KIT_PROFILES.STUDIO;
}

const ALL_INSTS: Inst[] = [
  'bd',
  'sd',
  'ss',
  'chh',
  'ohh',
  'phh',
  'ride',
  'bell',
  'crash',
  'tom1',
  'tom2',
  'tom3',
  'clap',
  'shaker',
  'tamb',
  'cowbell',
  'claves',
  'congaH',
  'congaL',
  'cajonH',
  'cajonL',
  'surdo',
];

/** Longest voice per instrument, in seconds (before kit decay scaling). */
const VOICE_LENGTH: Record<Inst, number> = {
  bd: 0.9,
  sd: 0.45,
  ss: 0.15,
  chh: 0.1,
  ohh: 0.5,
  phh: 0.2,
  ride: 1.6,
  bell: 1.6,
  crash: 2.2,
  tom1: 0.55,
  tom2: 0.6,
  tom3: 0.7,
  clap: 0.4,
  shaker: 0.14,
  tamb: 0.35,
  cowbell: 0.4,
  claves: 0.12,
  congaH: 0.35,
  congaL: 0.45,
  cajonH: 0.22,
  cajonL: 0.4,
  surdo: 0.9,
};

export type DrumBank = Record<Inst, AudioBuffer>;

const cache = new Map<string, Promise<DrumBank>>();

export function getDrumBank(kit: string, sampleRate: number): Promise<DrumBank> {
  const key = `${kit}@${sampleRate}`;
  let entry = cache.get(key);
  if (!entry) {
    entry = renderBank(kit, sampleRate);
    cache.set(key, entry);
  }
  return entry;
}

async function renderBank(kit: string, sampleRate: number): Promise<DrumBank> {
  const prof = kitProfile(kit);
  const bank: Partial<DrumBank> = {};
  await Promise.all(
    ALL_INSTS.map(async (inst) => {
      const seconds = Math.max(0.05, VOICE_LENGTH[inst] * (0.6 + 0.6 * prof.decay));
      const ctx = new OfflineAudioContext(2, Math.ceil(seconds * sampleRate), sampleRate);
      renderVoice(ctx, inst, prof);
      bank[inst] = await ctx.startRendering();
    }),
  );
  return bank as DrumBank;
}

// ---------------------------------------------------------------------------
// Voice construction helpers
// ---------------------------------------------------------------------------

function noiseBuffer(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const len = Math.max(1, Math.ceil(seconds * ctx.sampleRate));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    // Slightly pink-tinted noise sounds more like a drum shell than pure white.
    const w = Math.random() * 2 - 1;
    last = 0.72 * last + 0.28 * w;
    d[i] = w * 0.75 + last * 0.6;
  }
  return buf;
}

interface VoiceEnv {
  attack?: number;
  decay: number;
  curve?: number;
}

function envGain(ctx: BaseAudioContext, peak: number, env: VoiceEnv): GainNode {
  const g = ctx.createGain();
  const a = env.attack ?? 0.001;
  g.gain.setValueAtTime(0, 0);
  g.gain.linearRampToValueAtTime(peak, a);
  g.gain.exponentialRampToValueAtTime(Math.max(1e-4, peak * 0.001), a + env.decay);
  g.gain.linearRampToValueAtTime(0, a + env.decay + 0.005);
  return g;
}

function osc(
  ctx: BaseAudioContext,
  type: OscillatorType,
  f0: number,
  f1: number,
  glide: number,
): OscillatorNode {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, 0);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), glide);
  o.start(0);
  return o;
}

function noise(ctx: BaseAudioContext, seconds: number): AudioBufferSourceNode {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx, seconds);
  src.start(0);
  return src;
}

function bp(ctx: BaseAudioContext, freq: number, q: number): BiquadFilterNode {
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = freq;
  f.Q.value = q;
  return f;
}

function hp(ctx: BaseAudioContext, freq: number): BiquadFilterNode {
  const f = ctx.createBiquadFilter();
  f.type = 'highpass';
  f.frequency.value = freq;
  return f;
}

function lp(ctx: BaseAudioContext, freq: number): BiquadFilterNode {
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = freq;
  return f;
}

function chain(dest: AudioNode, ...nodes: AudioNode[]): void {
  for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]);
  nodes[nodes.length - 1].connect(dest);
}

/** Metallic cluster of inharmonic partials, used for cymbals and tambourine. */
function metal(ctx: BaseAudioContext, base: number, ratios: number[], gain: number, decay: number): AudioNode {
  const sum = ctx.createGain();
  sum.gain.value = gain / ratios.length;
  for (const r of ratios) {
    const o = osc(ctx, 'square', base * r, base * r, 0.001);
    const g = envGain(ctx, 1, { decay });
    o.connect(g).connect(sum);
  }
  return sum;
}

function renderVoice(ctx: OfflineAudioContext, inst: Inst, k: KitProfile): void {
  const out = ctx.destination;
  const d = k.decay;
  const t = k.tune;
  const bright = 0.6 + k.bright;

  switch (inst) {
    case 'bd': {
      const f0 = 120 * t * (1 + 0.3 * k.electronic);
      const f1 = 42 * t;
      const body = osc(ctx, 'sine', f0, f1, 0.06 + 0.05 * k.electronic);
      const bodyEnv = envGain(ctx, 1.0, { decay: (0.28 + 0.5 * k.electronic) * d });
      chain(out, body, bodyEnv);
      const click = noise(ctx, 0.02);
      const clickEnv = envGain(ctx, 0.5 * (1 - 0.6 * k.electronic) * (1 - k.brush), { decay: 0.015 });
      chain(out, click, hp(ctx, 1200), clickEnv);
      break;
    }
    case 'sd': {
      const tone1 = osc(ctx, 'triangle', 188 * t, 176 * t, 0.08);
      const tone2 = osc(ctx, 'triangle', 331 * t, 310 * t, 0.08);
      const toneEnv = envGain(ctx, 0.55 * (1 - k.noise * 0.4), { decay: 0.11 * d });
      tone1.connect(toneEnv);
      tone2.connect(toneEnv);
      toneEnv.connect(out);
      const n = noise(ctx, 0.4 * d);
      const nEnv = envGain(ctx, 0.85 * (0.5 + k.noise), {
        attack: k.brush ? 0.012 : 0.001,
        decay: (k.brush ? 0.22 : 0.13) * d,
      });
      chain(out, n, bp(ctx, 1900 * bright, 0.9), nEnv);
      if (k.electronic > 0.5) {
        const clapN = noise(ctx, 0.2);
        chain(out, clapN, hp(ctx, 1400), envGain(ctx, 0.35 * k.electronic, { decay: 0.08 }));
      }
      break;
    }
    case 'ss': {
      const n = noise(ctx, 0.1);
      chain(out, n, bp(ctx, 2600 * bright, 2.2), envGain(ctx, 0.75, { decay: 0.035 }));
      const tick = osc(ctx, 'triangle', 480 * t, 380 * t, 0.02);
      chain(out, tick, envGain(ctx, 0.3, { decay: 0.03 }));
      break;
    }
    case 'chh': {
      const n = noise(ctx, 0.09);
      chain(out, n, hp(ctx, 6500 * bright), bp(ctx, 9000 * bright, 0.6), envGain(ctx, 0.6, { decay: 0.035 * d }));
      break;
    }
    case 'phh': {
      const n = noise(ctx, 0.18);
      chain(out, n, hp(ctx, 5200 * bright), envGain(ctx, 0.5, { decay: 0.075 * d }));
      break;
    }
    case 'ohh': {
      const n = noise(ctx, 0.5 * d);
      chain(out, n, hp(ctx, 5800 * bright), envGain(ctx, 0.5, { decay: 0.3 * d }));
      break;
    }
    case 'ride': {
      const m = metal(ctx, 420 * t, [1, 1.41, 1.87, 2.34, 3.11, 4.13], 0.24, 1.3 * d);
      chain(out, m, hp(ctx, 3000));
      const n = noise(ctx, 1.4 * d);
      chain(out, n, hp(ctx, 7000 * bright), envGain(ctx, 0.16, { decay: 0.9 * d }));
      const ping = osc(ctx, 'triangle', 1050 * t, 1050 * t, 0.001);
      chain(out, ping, envGain(ctx, 0.18, { decay: 0.09 }));
      break;
    }
    case 'bell': {
      const m = metal(ctx, 620 * t, [1, 1.5, 2.2, 3.1, 4.4], 0.3, 1.4 * d);
      chain(out, m, hp(ctx, 2500));
      break;
    }
    case 'crash': {
      const m = metal(ctx, 300 * t, [1, 1.32, 1.78, 2.21, 2.91, 3.6, 4.7, 5.9], 0.22, 2.0 * d);
      chain(out, m, hp(ctx, 2000));
      const n = noise(ctx, 2.1 * d);
      chain(out, n, hp(ctx, 4500 * bright), envGain(ctx, 0.45, { attack: 0.004, decay: 1.6 * d }));
      break;
    }
    case 'tom1':
    case 'tom2':
    case 'tom3': {
      const f = { tom1: 260, tom2: 190, tom3: 140 }[inst] * t;
      const o = osc(ctx, 'sine', f * 1.25, f * 0.85, 0.12);
      chain(out, o, envGain(ctx, 0.85, { decay: 0.3 * d }));
      const n = noise(ctx, 0.2);
      chain(out, n, bp(ctx, f * 6, 1.2), envGain(ctx, 0.22 * (0.4 + k.noise), { decay: 0.07 }));
      break;
    }
    case 'clap': {
      const bursts = [0, 0.011, 0.023, 0.035];
      for (const off of bursts) {
        const n = noise(ctx, 0.05);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, off);
        g.gain.linearRampToValueAtTime(0.5, off + 0.001);
        g.gain.exponentialRampToValueAtTime(0.0005, off + 0.03);
        chain(out, n, bp(ctx, 1400 * bright, 1.1), g);
      }
      const tail = noise(ctx, 0.35);
      chain(out, tail, bp(ctx, 1150 * bright, 1.4), envGain(ctx, 0.3, { attack: 0.04, decay: 0.16 * d }));
      break;
    }
    case 'shaker': {
      const n = noise(ctx, 0.13);
      chain(out, n, hp(ctx, 7000 * bright), envGain(ctx, 0.42, { attack: 0.008, decay: 0.045 }));
      break;
    }
    case 'tamb': {
      const m = metal(ctx, 1800 * t, [1, 1.27, 1.66, 2.1], 0.16, 0.16 * d);
      chain(out, m, hp(ctx, 4000));
      const n = noise(ctx, 0.3);
      chain(out, n, hp(ctx, 5500 * bright), envGain(ctx, 0.3, { decay: 0.11 * d }));
      break;
    }
    case 'cowbell': {
      const a = osc(ctx, 'square', 835 * t, 835 * t, 0.001);
      const b = osc(ctx, 'square', 555 * t, 555 * t, 0.001);
      const g = envGain(ctx, 0.28, { decay: 0.22 * d });
      a.connect(g);
      b.connect(g);
      chain(out, g, bp(ctx, 2000, 0.6));
      break;
    }
    case 'claves': {
      const o = osc(ctx, 'sine', 2400 * t, 2400 * t, 0.001);
      chain(out, o, envGain(ctx, 0.6, { decay: 0.035 }));
      const n = noise(ctx, 0.03);
      chain(out, n, hp(ctx, 3000), envGain(ctx, 0.2, { decay: 0.012 }));
      break;
    }
    case 'congaH':
    case 'congaL': {
      const f = (inst === 'congaH' ? 330 : 210) * t;
      const o = osc(ctx, 'sine', f * 1.1, f * 0.95, 0.1);
      chain(out, o, envGain(ctx, 0.7, { decay: (inst === 'congaH' ? 0.16 : 0.26) * d }));
      const n = noise(ctx, 0.06);
      chain(out, n, bp(ctx, f * 8, 1.5), envGain(ctx, 0.18, { decay: 0.03 }));
      break;
    }
    case 'cajonH': {
      const n = noise(ctx, 0.2);
      chain(out, n, bp(ctx, 2200 * bright, 1.0), envGain(ctx, 0.55, { decay: 0.06 * d }));
      const o = osc(ctx, 'triangle', 320 * t, 260 * t, 0.05);
      chain(out, o, envGain(ctx, 0.25, { decay: 0.05 }));
      break;
    }
    case 'cajonL': {
      const o = osc(ctx, 'sine', 105 * t, 78 * t, 0.07);
      chain(out, o, envGain(ctx, 0.95, { decay: 0.22 * d }));
      const n = noise(ctx, 0.08);
      chain(out, n, lp(ctx, 900), envGain(ctx, 0.28, { decay: 0.035 }));
      break;
    }
    case 'surdo': {
      const o = osc(ctx, 'sine', 92 * t, 68 * t, 0.14);
      chain(out, o, envGain(ctx, 1.0, { decay: 0.5 * d }));
      break;
    }
  }
}
