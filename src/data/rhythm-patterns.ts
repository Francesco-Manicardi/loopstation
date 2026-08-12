/**
 * Rhythm pattern generator.
 *
 * The hardware ships baked PCM patterns; here each of the 200+ named patterns is
 * realised as a step sequence derived deterministically from its genre, name and
 * time signature, with four variations (A–D) of increasing density plus intro,
 * fill-in and ending measures — matching how the RC-505mkII's INTRO/FILL/ENDING
 * and VARIATION parameters behave.
 */

import { parseBeat } from './rhythm-data';

export type Inst =
  | 'bd'
  | 'sd'
  | 'ss' // side stick / rim shot
  | 'chh'
  | 'ohh'
  | 'phh'
  | 'ride'
  | 'bell'
  | 'crash'
  | 'tom1'
  | 'tom2'
  | 'tom3'
  | 'clap'
  | 'shaker'
  | 'tamb'
  | 'cowbell'
  | 'claves'
  | 'congaH'
  | 'congaL'
  | 'cajonH'
  | 'cajonL'
  | 'surdo';

export interface Hit {
  /** Step index; {@link STEPS_PER_BEAT} steps per beat. */
  step: number;
  inst: Inst;
  vel: number; // 0..1
}

export interface GeneratedPattern {
  hits: Hit[];
  /** Length in steps. */
  length: number;
  stepsPerBeat: number;
  beatsPerMeasure: number;
  measures: number;
}

/** 12 steps per beat resolves both 16ths (×3) and triplets (×4). */
export const STEPS_PER_BEAT = 12;

type Feel = 'straight8' | 'straight16' | 'swing' | 'shuffle' | 'triplet' | 'latin' | 'bossa' | 'samba' | 'reggae';

function feelOf(genreName: string, patternName: string): Feel {
  const n = patternName.toUpperCase();
  if (/BOSSA/.test(n)) return 'bossa';
  if (/SAMBA/.test(n)) return 'samba';
  if (/REGGAE/.test(n)) return 'reggae';
  if (/SHUFFLE/.test(n)) return 'shuffle';
  if (/SWING|BOP|4BEAT|LEGATO|RIDEBEAT|JIVE|CHARLSTON|FOXTROT/.test(n)) return 'swing';
  if (/TRIPLE|6\/8|3BEAT/.test(n)) return 'triplet';
  if (/16BEAT|16 ?BEAT/.test(n)) return 'straight16';
  if (/CONGA|LATIN|MERENGUE|CUMBIA|CHACHA|BEGUINE|RHUMBA|TANGO|BOOGALOO|SURDO|PERCUS/.test(n)) return 'latin';
  if (genreName === 'JAZZ') return 'swing';
  if (genreName === 'FUSION') return 'straight16';
  return 'straight8';
}

interface Voicing {
  hat: Inst;
  openHat: Inst;
  snare: Inst;
  kick: Inst;
  ride: Inst;
  perc: Inst | null;
}

function voicingOf(genreName: string, patternName: string, feel: Feel): Voicing {
  const n = patternName.toUpperCase();
  const v: Voicing = { hat: 'chh', openHat: 'ohh', snare: 'sd', kick: 'bd', ride: 'ride', perc: null };
  if (/SIDE ?ST(IC)?K|SIDESTK/.test(n)) v.snare = 'ss';
  if (/BRUSH/.test(n)) {
    v.snare = 'sd';
    v.ride = 'ride';
  }
  if (/CAJON/.test(n)) {
    v.kick = 'cajonL';
    v.snare = 'cajonH';
    v.hat = 'shaker';
  }
  if (/CONGA/.test(n)) v.perc = 'congaH';
  if (genreName === 'ACOUSTIC') v.perc = v.perc ?? 'shaker';
  if (feel === 'swing' || genreName === 'JAZZ') v.hat = 'ride';
  if (feel === 'bossa' || feel === 'samba') {
    v.snare = 'ss';
    v.perc = 'shaker';
  }
  if (feel === 'reggae') v.perc = 'tamb';
  if (/MOTOWN/.test(n)) v.perc = 'tamb';
  if (/PERCUS/.test(n)) v.perc = 'congaL';
  if (['ELCTRO', 'DANCE'].includes(genreName)) v.perc = 'clap';
  if (genreName === 'SOUL' || genreName === 'R&B') v.perc = 'tamb';
  if (genreName === 'TRAD' && /TRAIN/.test(n)) v.hat = 'chh';
  return v;
}

/** Stable pseudo-random in [0,1) from a string + index. Keeps patterns reproducible. */
function hashRand(seed: string, i: number): number {
  let h = 2166136261 ^ i;
  for (let k = 0; k < seed.length; k++) {
    h ^= seed.charCodeAt(k);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 15;
  return ((h >>> 0) % 100000) / 100000;
}

const B = STEPS_PER_BEAT; // one beat
const E = STEPS_PER_BEAT / 2; // eighth
const S = STEPS_PER_BEAT / 4; // sixteenth
const T = STEPS_PER_BEAT / 3; // eighth triplet

export function buildPattern(
  genreName: string,
  patternName: string,
  beat: string,
  variation: 'A' | 'B' | 'C' | 'D',
  measures = 1,
): GeneratedPattern {
  const { num, den } = parseBeat(beat);
  // Compound signatures (x/8) are felt in dotted-quarter groups of three eighths.
  const beatsPerMeasure = den === 8 ? num / 2 : num;
  const feel = feelOf(genreName, patternName);
  const v = voicingOf(genreName, patternName, feel);
  const seed = `${genreName}|${patternName}|${variation}`;
  const density = { A: 0, B: 1, C: 2, D: 3 }[variation];
  const hits: Hit[] = [];
  const measureSteps = Math.round(beatsPerMeasure * B);
  const length = measureSteps * measures;

  const add = (step: number, inst: Inst, vel = 0.9) => {
    if (step < 0 || step >= length) return;
    hits.push({ step: Math.round(step), inst, vel: Math.max(0.05, Math.min(1, vel)) });
  };

  const isGuide = genreName === 'GUIDE';

  for (let m = 0; m < measures; m++) {
    const base = m * measureSteps;
    const r = (i: number) => hashRand(seed, i + m * 97);

    if (isGuide) {
      buildGuide(patternName, beatsPerMeasure, base, add, den);
      continue;
    }

    // --- Hi-hat / ride layer -------------------------------------------------
    switch (feel) {
      case 'swing': {
        for (let b = 0; b < beatsPerMeasure; b++) {
          add(base + b * B, v.hat, 0.72);
          add(base + b * B + 2 * T, v.hat, b % 2 === 1 ? 0.62 : 0.5);
        }
        // Jazz hi-hat on 2 and 4
        for (let b = 1; b < beatsPerMeasure; b += 2) add(base + b * B, 'phh', 0.5);
        break;
      }
      case 'shuffle': {
        for (let b = 0; b < beatsPerMeasure; b++) {
          add(base + b * B, v.hat, 0.8);
          add(base + b * B + 2 * T, v.hat, 0.55);
        }
        break;
      }
      case 'triplet': {
        for (let b = 0; b < beatsPerMeasure; b++)
          for (let t = 0; t < 3; t++) add(base + b * B + t * T, v.hat, t === 0 ? 0.8 : 0.5);
        break;
      }
      case 'straight16': {
        for (let b = 0; b < beatsPerMeasure; b++)
          for (let s = 0; s < 4; s++) {
            const on = s === 0 ? 0.85 : s === 2 ? 0.65 : 0.45;
            if (s % 2 === 1 && density === 0 && r(b * 4 + s) < 0.35) continue;
            add(base + b * B + s * S, v.hat, on);
          }
        break;
      }
      case 'bossa':
      case 'samba': {
        for (let b = 0; b < beatsPerMeasure; b++) {
          add(base + b * B, v.perc ?? 'shaker', 0.6);
          add(base + b * B + E, v.perc ?? 'shaker', 0.45);
          if (feel === 'samba') {
            add(base + b * B + S, 'shaker', 0.3);
            add(base + b * B + 3 * S, 'shaker', 0.35);
          }
        }
        break;
      }
      case 'reggae': {
        for (let b = 0; b < beatsPerMeasure; b++) {
          add(base + b * B + E, v.hat, 0.7);
          if (density >= 1) add(base + b * B, v.hat, 0.4);
        }
        break;
      }
      case 'latin': {
        for (let b = 0; b < beatsPerMeasure; b++) {
          add(base + b * B, v.hat, 0.6);
          add(base + b * B + E, v.hat, 0.5);
        }
        break;
      }
      default: {
        // straight 8
        for (let b = 0; b < beatsPerMeasure; b++) {
          add(base + b * B, v.hat, 0.85);
          add(base + b * B + E, v.hat, 0.55);
        }
        if (density >= 2)
          for (let b = 0; b < beatsPerMeasure; b += 2) add(base + b * B + 3 * S, v.hat, 0.35);
      }
    }

    // Open hat accent
    if (density >= 1 && (feel === 'straight8' || feel === 'straight16'))
      add(base + (beatsPerMeasure - 1) * B + E, v.openHat, 0.6);

    // --- Kick ---------------------------------------------------------------
    const n = patternName.toUpperCase();
    add(base, v.kick, 1);
    if (/2XBD/.test(n)) {
      for (let b = 0; b < beatsPerMeasure; b++) {
        add(base + b * B, v.kick, 0.95);
        add(base + b * B + E, v.kick, 0.85);
        if (density >= 2) add(base + b * B + S, v.kick, 0.7);
      }
    } else if (genreName === 'METAL' || genreName === 'HEAVY ROCK' || genreName === 'PUNK') {
      for (let b = 0; b < beatsPerMeasure; b++) {
        add(base + b * B, v.kick, 0.95);
        if (density >= 1) add(base + b * B + E, v.kick, 0.7);
      }
    } else if (feel === 'bossa' || feel === 'samba') {
      for (let b = 0; b < beatsPerMeasure; b++) {
        add(base + b * B, v.kick, b % 2 === 0 ? 1 : 0.8);
        add(base + b * B + 3 * S, v.kick, 0.6);
      }
    } else if (feel === 'reggae') {
      add(base + 2 * B, v.kick, 1);
      if (density >= 2) add(base + 2 * B + 3 * S, v.kick, 0.6);
    } else if (feel === 'swing') {
      if (density >= 2) for (let b = 0; b < beatsPerMeasure; b++) add(base + b * B, v.kick, 0.35);
      else add(base, v.kick, 0.5);
    } else if (feel === 'straight16' || genreName === 'FUNK') {
      add(base + Math.floor(beatsPerMeasure / 2) * B + 2 * S, v.kick, 0.85);
      if (density >= 1) add(base + (beatsPerMeasure - 1) * B + E, v.kick, 0.7);
      if (density >= 2) add(base + B + 3 * S, v.kick, 0.6);
      if (density >= 3) add(base + 2 * B + S, v.kick, 0.55);
    } else {
      // classic 8-beat kick: 1 and the "and" of 3
      if (beatsPerMeasure >= 4) {
        add(base + 2 * B + E, v.kick, 0.85);
        if (density >= 1) add(base + 2 * B, v.kick, 0.7);
        if (density >= 3) add(base + 3 * B + 3 * S, v.kick, 0.6);
      } else if (density >= 1) {
        add(base + (beatsPerMeasure - 1) * B, v.kick, 0.7);
      }
    }

    // --- Snare / backbeat ---------------------------------------------------
    if (feel === 'swing') {
      for (let b = 1; b < beatsPerMeasure; b += 2) add(base + b * B, v.snare, 0.55);
      if (density >= 2) add(base + Math.floor(beatsPerMeasure / 2) * B + 2 * T, v.snare, 0.35);
    } else if (feel === 'bossa' || feel === 'samba') {
      for (let b = 0; b < beatsPerMeasure; b++) add(base + b * B + E, v.snare, 0.55);
    } else if (feel === 'reggae') {
      add(base + 2 * B, v.snare, 0.85);
    } else if (feel === 'latin') {
      add(base + Math.floor(beatsPerMeasure / 2) * B, v.snare, 0.7);
      if (v.perc) {
        add(base + B + E, v.perc, 0.55);
        add(base + 3 * B, v.perc === 'congaH' ? 'congaL' : v.perc, 0.5);
      }
    } else if (beatsPerMeasure >= 4) {
      add(base + B, v.snare, 0.9);
      add(base + 3 * B, v.snare, 0.95);
      if (density >= 2) add(base + 2 * B + 3 * S, v.snare, 0.35);
      if (density >= 3) add(base + 3 * B + 2 * S, v.snare, 0.3);
    } else {
      add(base + (beatsPerMeasure > 1 ? B : 0) * (beatsPerMeasure - 1), v.snare, 0.85);
    }

    // --- Extra percussion ---------------------------------------------------
    if (v.perc && feel !== 'latin' && feel !== 'bossa' && feel !== 'samba') {
      for (let b = 0; b < beatsPerMeasure; b++)
        if (density >= 1 || b % 2 === 1) add(base + b * B + E, v.perc, 0.4);
    }
    if (/MOTOWN/.test(n)) for (let b = 0; b < beatsPerMeasure * 2; b++) add(base + b * E, 'tamb', 0.45);
    if (/COWBELL|CHACHA|MERENGUE/.test(n))
      for (let b = 0; b < beatsPerMeasure; b++) add(base + b * B, 'cowbell', 0.4);
    if (/CLAVES|BEGUINE|RHUMBA|TANGO/.test(n)) {
      add(base, 'claves', 0.5);
      add(base + B + E, 'claves', 0.45);
      add(base + 2 * B + E, 'claves', 0.45);
    }
    if (/SURDO/.test(n)) {
      add(base + B, 'surdo', 0.8);
      add(base + 3 * B, 'surdo', 0.9);
    }
    if (/12BARS|TRAIN/.test(n)) for (let b = 0; b < beatsPerMeasure; b++) add(base + b * B + 2 * T, 'ss', 0.35);
  }

  hits.sort((a, b) => a.step - b.step);
  return { hits, length, stepsPerBeat: STEPS_PER_BEAT, beatsPerMeasure, measures };
}

function buildGuide(
  patternName: string,
  beatsPerMeasure: number,
  base: number,
  add: (s: number, i: Inst, v?: number) => void,
  den: number,
): void {
  const n = patternName.toUpperCase();
  const triple = /TRIPLE/.test(n);
  if (/^BD /.test(n)) {
    const div = /16BEAT/.test(n) ? S : /SHUFFLE/.test(n) ? 2 * T : E;
    for (let s = 0; s < beatsPerMeasure * B; s += div) add(base + s, 'bd', s % B === 0 ? 1 : 0.7);
    return;
  }
  if (/^HH /.test(n)) {
    const div = /16BEAT/.test(n) ? S : E;
    if (/SWING/.test(n)) {
      for (let b = 0; b < beatsPerMeasure; b++) {
        add(base + b * B, 'chh', 0.85);
        add(base + b * B + 2 * T, 'chh', 0.55);
      }
    } else for (let s = 0; s < beatsPerMeasure * B; s += div) add(base + s, 'chh', s % B === 0 ? 0.85 : 0.5);
    return;
  }
  if (/^\d+BEAT\d?$/.test(n)) {
    for (let b = 0; b < beatsPerMeasure; b++) {
      add(base + b * B, 'chh', 0.8);
      add(base + b * B + E, 'chh', 0.5);
    }
    add(base, 'bd', 1);
    if (beatsPerMeasure >= 4) {
      add(base + B, 'sd', 0.85);
      add(base + 2 * B + E, 'bd', 0.8);
      add(base + 3 * B, 'sd', 0.9);
    }
    return;
  }
  // Pure metronome guides: click on every beat, accent on 1, subdivisions when TRIPLE.
  for (let b = 0; b < beatsPerMeasure; b++) {
    add(base + b * B, b === 0 ? 'claves' : 'ss', b === 0 ? 1 : 0.6);
    if (triple) {
      add(base + b * B + T, 'ss', 0.3);
      add(base + b * B + 2 * T, 'ss', 0.3);
    } else if (den === 8) {
      add(base + b * B + E, 'ss', 0.3);
    }
  }
}

/** One-measure count-in used when INTRO REC / INTRO PLAY is on. */
export function buildIntro(beatsPerMeasure: number): GeneratedPattern {
  const hits: Hit[] = [];
  for (let b = 0; b < beatsPerMeasure; b++)
    hits.push({ step: b * B, inst: b === 0 ? 'claves' : 'ss', vel: b === 0 ? 1 : 0.6 });
  return { hits, length: beatsPerMeasure * B, stepsPerBeat: B, beatsPerMeasure, measures: 1 };
}

/** One-measure fill-in. */
export function buildFill(genreName: string, beatsPerMeasure: number, seed: string): GeneratedPattern {
  const hits: Hit[] = [];
  const toms: Inst[] = ['tom1', 'tom1', 'tom2', 'tom2', 'tom3', 'tom3'];
  const steps = Math.round(beatsPerMeasure * B);
  const half = Math.floor(steps / 2);
  hits.push({ step: 0, inst: 'bd', vel: 1 });
  for (let b = 0; b < beatsPerMeasure / 2; b++) {
    hits.push({ step: b * B, inst: 'chh', vel: 0.6 });
    hits.push({ step: b * B + E, inst: 'sd', vel: 0.5 });
  }
  let i = 0;
  for (let s = half; s < steps; s += S) {
    const inst = genreName === 'JAZZ' ? 'sd' : toms[Math.min(toms.length - 1, i++)];
    hits.push({ step: s, inst, vel: 0.6 + 0.35 * (hashRand(seed, i) * 0.5 + i / 8) });
  }
  return { hits, length: steps, stepsPerBeat: B, beatsPerMeasure, measures: 1 };
}

/** One-measure ending. */
export function buildEnding(beatsPerMeasure: number): GeneratedPattern {
  const steps = Math.round(beatsPerMeasure * B);
  const hits: Hit[] = [
    { step: 0, inst: 'bd', vel: 1 },
    { step: 0, inst: 'crash', vel: 0.9 },
    { step: E, inst: 'sd', vel: 0.6 },
    { step: B, inst: 'tom2', vel: 0.7 },
    { step: B + E, inst: 'tom3', vel: 0.75 },
    { step: 2 * B, inst: 'bd', vel: 1 },
    { step: 2 * B, inst: 'crash', vel: 1 },
  ].filter((h) => h.step < steps) as Hit[];
  return { hits, length: steps, stepsPerBeat: B, beatsPerMeasure, measures: 1 };
}
