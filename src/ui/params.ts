/**
 * The editable parameter tree — one entry per parameter documented in the
 * RC-505mkII Parameter Guide, grouped into the same screens/pages the hardware
 * uses. Screens are generic: a page holds up to four parameters, which map onto
 * the [1]–[4] knobs, and the [K] [J] buttons page through them.
 */

import { RATE_VALUES, INPUT_FX_TYPES, TRACK_FX_TYPES, defaultFxParams, fxType } from '../data/fx-list';
import { BEAT_VALUES, GENRE_NAMES, RHYTHM_KITS, patternBeat, patternsOf } from '../data/rhythm-data';
import {
  FX_BANKS,
  FX_SLOTS,
  NUM_TRACKS,
  type FxBank,
  type FxSlot,
  type Memory,
  type MeasureSetting,
  type SystemSettings,
} from '../types';

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

export interface Param {
  label: string;
  value(): string;
  /** `delta` is in knob clicks; `coarse` is set when the knob is pushed while turned. */
  adjust(delta: number, coarse: boolean): void;
  /** Some parameters are toggled by pressing the knob (e.g. INPUT assign, MUTE). */
  press?(): void;
  /** 0..1, drawn as a small bar next to the value when present. */
  norm?(): number;
}

export interface Page {
  title?: string;
  params: Param[];
}

export interface MenuItem {
  label: string;
  hint?: () => string;
  node: Node;
  onEnter?(): void;
}

export interface MenuNode {
  kind: 'menu';
  title: string;
  items(): MenuItem[];
}

export interface ParamsNode {
  kind: 'params';
  title: string | (() => string);
  pages(): Page[];
}

export type SpecialId = 'mixer' | 'name' | 'write' | 'clear' | 'reset';

export interface SpecialNode {
  kind: 'special';
  title: string;
  id: SpecialId;
}

export type Node = MenuNode | ParamsNode | SpecialNode;

export function nodeTitle(node: Node): string {
  if (node.kind === 'params') return typeof node.title === 'function' ? node.title() : node.title;
  return node.title;
}

export interface ParamHost {
  memory(): Memory;
  system(): SystemSettings;
  editTrack(): number;
  setEditTrack(i: number): void;
  fxSection(): 'input' | 'track';
  setFxSection(s: 'input' | 'track'): void;
  fxSlot(): FxSlot;
  setFxSlot(s: FxSlot): void;
  /** Re-sends the whole working memory to the engine and flags it as edited. */
  touchMemory(): void;
  touchTrack(i: number): void;
  touchSystem(): void;
  touchFx(section: 'input' | 'track'): void;
  touchRhythm(): void;
  notify(text: string): void;
}

// ---------------------------------------------------------------------------
// Parameter constructors
// ---------------------------------------------------------------------------

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const round = (v: number, decimals = 0) => {
  const f = Math.pow(10, decimals);
  return Math.round(v * f) / f;
};

export function num(
  label: string,
  get: () => number,
  set: (v: number) => void,
  min: number,
  max: number,
  opts: { step?: number; coarse?: number; decimals?: number; fmt?: (v: number) => string } = {},
): Param {
  const step = opts.step ?? 1;
  const coarseStep = opts.coarse ?? step * 10;
  const decimals = opts.decimals ?? (Number.isInteger(step) ? 0 : 1);
  return {
    label,
    value: () => (opts.fmt ? opts.fmt(get()) : String(round(get(), decimals))),
    adjust: (d, coarse) => set(clamp(round(get() + d * (coarse ? coarseStep : step), decimals), min, max)),
    norm: () => (get() - min) / (max - min || 1),
  };
}

export function choice<T>(label: string, options: { label: string; value: T }[], get: () => T, set: (v: T) => void): Param {
  const index = () => {
    const i = options.findIndex((o) => o.value === get());
    return i < 0 ? 0 : i;
  };
  return {
    label,
    value: () => options[index()]?.label ?? '--',
    adjust: (d, coarse) => {
      const next = clamp(index() + d * (coarse ? 5 : 1), 0, options.length - 1);
      set(options[next].value);
    },
    press: () => set(options[(index() + 1) % options.length].value),
    norm: () => index() / (options.length - 1 || 1),
  };
}

export function list(
  label: string,
  values: readonly string[],
  get: () => string,
  set: (v: string) => void,
  fmt?: (v: string) => string,
): Param {
  return choice(
    label,
    values.map((v) => ({ label: fmt ? fmt(v) : v, value: v })),
    get,
    set,
  );
}

export function onOff(label: string, get: () => boolean, set: (v: boolean) => void): Param {
  return {
    label,
    value: () => (get() ? 'ON' : 'OFF'),
    adjust: (d) => set(d > 0),
    press: () => set(!get()),
    norm: () => (get() ? 1 : 0),
  };
}

export function action(label: string, text: () => string, run: () => void): Param {
  return { label, value: text, adjust: () => {}, press: run };
}

const panFmt = (v: number) => (v === 0 ? 'CENTER' : v < 0 ? `L${-v}` : `R${v}`);
const dbFmt = (v: number) => (v > 0 ? `+${v}dB` : `${v}dB`);
const hzFmt = (v: number) => (v >= 1000 ? `${round(v / 1000, 1)}kHz` : `${v}Hz`);

const page = (params: (Param | null)[], title?: string): Page => ({
  title,
  params: params.filter((p): p is Param => p !== null),
});

/** Splits a flat parameter list into pages of four, the way the hardware does. */
function paginate(params: Param[], title?: string): Page[] {
  const out: Page[] = [];
  for (let i = 0; i < params.length; i += 4) out.push({ title, params: params.slice(i, i + 4) });
  return out.length ? out : [{ title, params: [] }];
}

// ---------------------------------------------------------------------------
// Value tables
// ---------------------------------------------------------------------------

/** MEASURE: AUTO / FREE / note values / 1–99 measures (fractions encode notes). */
const MEASURE_OPTIONS: { label: string; value: MeasureSetting }[] = [
  { label: 'AUTO', value: 'AUTO' },
  { label: 'FREE', value: 'FREE' },
  { label: '♬', value: 1 / 16 },
  { label: '♪3', value: 1 / 12 },
  { label: '♪', value: 1 / 8 },
  { label: '♩3', value: 1 / 6 },
  { label: '♩.', value: 3 / 8 },
  { label: '♩', value: 1 / 4 },
  ...Array.from({ length: 99 }, (_, i) => ({ label: `${i + 1}`, value: i + 1 as MeasureSetting })),
];

const LOOP_LENGTH_OPTIONS: { label: string; value: 'AUTO' | number }[] = [
  { label: 'AUTO', value: 'AUTO' as const },
  ...Array.from({ length: 64 }, (_, i) => ({ label: `${i + 1}MEAS`, value: i + 1 })),
];

const FADE_OPTIONS: { label: string; value: number }[] = [
  { label: '♩', value: 0.25 },
  { label: '♩x2', value: 0.5 },
  ...Array.from({ length: 32 }, (_, i) => ({ label: `${i + 1}MEAS`, value: i + 1 })),
];

const MID_FREQ = [200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000];
const COMP_RATIOS = ['1.5:1', '2:1', '4:1', '8:1', '16:1', 'INF:1'];
const REVERB_TYPES = ['ROOM', 'HALL', 'PLATE'];
const AUTO_OFF = ['OFF', '10min', '30min', '60min', '240min'] as const;
const TRACK_BTN_FUNCS = ['PLAY/STOP', 'REC/PLAY', 'TRACK SELECT', 'CLEAR', 'OFF'];
const FX_BTN_FUNCS = ['FX ON/OFF', 'FX BANK', 'OFF'];
const UNDO_BTN_FUNCS = ['UNDO/REDO', 'MARK SET', 'MARK CLEAR', 'MARK BACK', 'ALL START', 'ALL STOP', 'OFF'];
const MIDI_CH = ['OFF', ...Array.from({ length: 16 }, (_, i) => String(i + 1))];

// ---------------------------------------------------------------------------
// LOOP (memory) tree
// ---------------------------------------------------------------------------

function trackNode(host: ParamHost, index: number): ParamsNode {
  const t = () => host.memory().tracks[index];
  const touch = () => host.touchTrack(index);
  const set = <K extends keyof ReturnType<typeof t>>(key: K, v: ReturnType<typeof t>[K]) => {
    t()[key] = v;
    touch();
  };
  const inputParam = (label: string, key: keyof Memory['tracks'][number]['input']): Param =>
    onOff(label, () => t().input[key], (v) => {
      t().input[key] = v;
      touch();
    });

  return {
    kind: 'params',
    title: () => `TRACK ${index + 1}`,
    pages: () => [
      page([
        onOff('REVERSE', () => t().reverse, (v) => set('reverse', v)),
        onOff('1SHOT', () => t().oneShot, (v) => set('oneShot', v)),
        num('PAN', () => t().pan, (v) => set('pan', v), -50, 50, { fmt: panFmt, coarse: 10 }),
        num('PLAY LEVEL', () => t().playLevel, (v) => set('playLevel', v), 0, 200, { coarse: 10 }),
      ]),
      page([
        list('START MODE', ['IMMEDIATE', 'FADE'], () => t().startMode, (v) => set('startMode', v as 'IMMEDIATE')),
        list('STOP MODE', ['IMMEDIATE', 'FADE', 'LOOP'], () => t().stopMode, (v) => set('stopMode', v as 'IMMEDIATE')),
        list('DUB MODE', ['OVERDUB', 'REPLACE1', 'REPLACE2'], () => t().dubMode, (v) => set('dubMode', v as 'OVERDUB')),
        onOff('FX', () => t().fx, (v) => set('fx', v)),
      ]),
      page([
        list('PLAY MODE', ['MULTI', 'SINGLE'], () => t().playMode, (v) => set('playMode', v as 'MULTI')),
        choice('MEASURE', MEASURE_OPTIONS, () => t().measure, (v) => set('measure', v)),
        onOff('LP SYNC SW', () => t().loopSyncSw, (v) => set('loopSyncSw', v)),
        list(
          'LP SYNC MOD',
          ['IMMEDIATE', 'MEASURE', 'LOOP LENGTH'],
          () => t().loopSyncMode,
          (v) => set('loopSyncMode', v as 'MEASURE'),
        ),
      ]),
      page([
        onOff('TMP SYNC', () => t().tempoSyncSw, (v) => set('tempoSyncSw', v)),
        list('TSYNC MODE', ['PITCH', 'XFADE'], () => t().tempoSyncMode, (v) => set('tempoSyncMode', v as 'PITCH')),
        list('SPEED', ['HALF', 'NORMAL', 'DOUBLE'], () => t().tempoSyncSpeed, (v) => set('tempoSyncSpeed', v as 'HALF')),
        onOff('BOUNCE IN', () => t().bounceIn, (v) => set('bounceIn', v)),
      ]),
      page([
        inputParam('IN MIC 1', 'mic1'),
        inputParam('IN MIC 2', 'mic2'),
        inputParam('IN INST1 L', 'inst1L'),
        inputParam('IN INST1 R', 'inst1R'),
      ]),
      page([inputParam('IN INST2 L', 'inst2L'), inputParam('IN INST2 R', 'inst2R'), inputParam('IN RHYTHM', 'rhythm')]),
    ],
  };
}

function recNode(host: ParamHost): ParamsNode {
  const r = () => host.memory().rec;
  const touch = () => host.touchMemory();
  return {
    kind: 'params',
    title: 'REC',
    pages: () => [
      page([
        list('REC ACTION', ['REC->DUB', 'REC->PLAY'], () => r().recAction, (v) => {
          r().recAction = v as 'REC->DUB';
          touch();
        }),
        list('QUANTIZE', ['OFF', 'MEASURE'], () => r().quantize, (v) => {
          r().quantize = v as 'OFF';
          touch();
        }),
        onOff('AUTO REC', () => r().autoRecSw, (v) => {
          r().autoRecSw = v;
          touch();
        }),
        num('A.REC SENS', () => r().autoRecSens, (v) => {
          r().autoRecSens = v;
          touch();
        }, 1, 100),
      ]),
      page([
        onOff('BOUNCE', () => r().bounceSw, (v) => {
          r().bounceSw = v;
          touch();
        }),
        ...Array.from({ length: 3 }, (_, i) =>
          onOff(`BNC TRACK${i + 1}`, () => r().bounceTrack[i], (v) => {
            r().bounceTrack[i] = v;
            touch();
          }),
        ),
      ]),
      page(
        Array.from({ length: 2 }, (_, i) =>
          onOff(`BNC TRACK${i + 4}`, () => r().bounceTrack[i + 3], (v) => {
            r().bounceTrack[i + 3] = v;
            touch();
          }),
        ),
      ),
    ],
  };
}

function playNode(host: ParamHost): ParamsNode {
  const p = () => host.memory().play;
  const touch = () => host.touchMemory();
  return {
    kind: 'params',
    title: 'PLAY',
    pages: () => [
      page([
        list('SINGL CHNG', ['IMMEDIATE', 'LOOP END', 'MEASURE'], () => p().singleTrackChange, (v) => {
          p().singleTrackChange = v as 'IMMEDIATE';
          touch();
        }),
        num('CUR TRACK', () => p().currentTrack + 1, (v) => {
          p().currentTrack = (v - 1) as 0;
          touch();
        }, 1, NUM_TRACKS, { fmt: (v) => `TRACK ${v}` }),
        choice('FADE IN', FADE_OPTIONS, () => p().fadeTimeIn, (v) => {
          p().fadeTimeIn = v;
          touch();
        }),
        choice('FADE OUT', FADE_OPTIONS, () => p().fadeTimeOut, (v) => {
          p().fadeTimeOut = v;
          touch();
        }),
      ]),
      page([
        choice('LOOP LEN', LOOP_LENGTH_OPTIONS, () => p().loopLength, (v) => {
          p().loopLength = v;
          touch();
        }),
        list('SPD CHANGE', ['IMMEDIATE', 'LOOP END'], () => p().speedChange, (v) => {
          p().speedChange = v as 'IMMEDIATE';
          touch();
        }),
        list('SYNC ADJST', ['MEASURE', 'BEAT'], () => p().syncAdjust, (v) => {
          p().syncAdjust = v as 'MEASURE';
          touch();
        }),
      ]),
      ...paginate([
        ...Array.from({ length: NUM_TRACKS }, (_, i) =>
          onOff(`A.START T${i + 1}`, () => p().allStartTrack[i], (v) => {
            p().allStartTrack[i] = v;
            touch();
          }),
        ),
        ...Array.from({ length: NUM_TRACKS }, (_, i) =>
          onOff(`A.STOP T${i + 1}`, () => p().allStopTrack[i], (v) => {
            p().allStopTrack[i] = v;
            touch();
          }),
        ),
      ]),
    ],
  };
}

function rhythmNode(host: ParamHost): ParamsNode {
  const r = () => host.memory().rhythm;
  const touch = () => host.touchRhythm();
  return {
    kind: 'params',
    title: 'RHYTHM',
    pages: () => [
      page([
        list('GENRE', GENRE_NAMES, () => r().genre, (v) => {
          r().genre = v;
          const first = patternsOf(v)[0];
          if (first) {
            r().pattern = first.name;
            r().beat = first.beat;
          }
          touch();
        }),
        list(
          'PATTERN',
          patternsOf(r().genre).map((p) => p.name),
          () => r().pattern,
          (v) => {
            r().pattern = v;
            r().beat = patternBeat(r().genre, v);
            touch();
          },
        ),
        list('VARIATION', ['A', 'B', 'C', 'D'], () => r().variation, (v) => {
          r().variation = v as 'A';
          touch();
        }),
        list('KIT', RHYTHM_KITS, () => r().kit, (v) => {
          r().kit = v;
          touch();
        }),
      ]),
      page([
        list('BEAT', BEAT_VALUES, () => r().beat, (v) => {
          r().beat = v;
          touch();
        }),
        num('LEVEL', () => r().level, (v) => {
          r().level = v;
          touch();
        }, 0, 100),
        list('START TRIG', ['LOOP START', 'REC END', 'BEFORE LOOP'], () => r().startTrig, (v) => {
          r().startTrig = v as 'LOOP START';
          touch();
        }),
        list('STOP TRIG', ['OFF', 'LOOP STOP', 'REC END'], () => r().stopTrig, (v) => {
          r().stopTrig = v as 'OFF';
          touch();
        }),
      ]),
      page([
        onOff('INTRO REC', () => r().introRec, (v) => {
          r().introRec = v;
          touch();
        }),
        onOff('INTRO PLAY', () => r().introPlay, (v) => {
          r().introPlay = v;
          touch();
        }),
        onOff('ENDING', () => r().ending, (v) => {
          r().ending = v;
          touch();
        }),
        onOff('FILL IN', () => r().fill, (v) => {
          r().fill = v;
          touch();
        }),
      ]),
      page([
        list('VARI CHNGE', ['MEASURE', 'LOOP END'], () => r().variationChange, (v) => {
          r().variationChange = v as 'MEASURE';
          touch();
        }),
      ]),
    ],
  };
}

// --- FX --------------------------------------------------------------------

function fxSlotNode(host: ParamHost, section: 'input' | 'track', slotId: FxSlot): ParamsNode {
  const sect = () => (section === 'input' ? host.memory().inputFx : host.memory().trackFx);
  const bank = () => sect().banks[sect().bank];
  const slot = () => bank().slots[slotId];
  const touch = () => host.touchFx(section);
  const types = (section === 'input' ? INPUT_FX_TYPES : TRACK_FX_TYPES).map((f) => f.name);
  const inserts =
    section === 'input'
      ? ['ALL', 'MIC1', 'MIC2', 'INST1-L', 'INST1-R', 'INST2-L', 'INST2-R']
      : ['ALL', 'TRACK1', 'TRACK2', 'TRACK3', 'TRACK4', 'TRACK5'];

  const fxParams = (): Param[] =>
    fxType(slot().type).params.map((p) => {
      if (p.kind === 'num') {
        return num(p.label, () => Number(slot().params[p.id] ?? p.def), (v) => {
          slot().params[p.id] = v;
          touch();
        }, p.min ?? 0, p.max ?? 100, { step: p.step ?? 1, fmt: p.unit ? (v) => `${v}${p.unit}` : undefined });
      }
      const values = p.kind === 'rate' ? RATE_VALUES : p.values ?? ['OFF', 'ON'];
      return list(p.label, values, () => String(slot().params[p.id] ?? p.def), (v) => {
        slot().params[p.id] = v;
        touch();
      });
    });

  const seq = () => slot().sequence;
  const seqParams = (): Param[] => [
    onOff('SEQ SW', () => seq().sw, (v) => {
      seq().sw = v;
      touch();
    }),
    onOff('SEQ SYNC', () => seq().sync, (v) => {
      seq().sync = v;
      touch();
    }),
    onOff('SEQ RETRIG', () => seq().retrig, (v) => {
      seq().retrig = v;
      touch();
    }),
    list(
      'SEQ TARGET',
      ['', ...fxType(slot().type).params.filter((p) => p.seqTarget).map((p) => p.id)],
      () => seq().target,
      (v) => {
        seq().target = v;
        touch();
      },
      (v) => (v === '' ? 'OFF' : fxType(slot().type).params.find((p) => p.id === v)?.label ?? v),
    ),
    list('SEQ RATE', RATE_VALUES, () => String(seq().rate), (v) => {
      seq().rate = v;
      touch();
    }),
    num('SEQ MAX', () => seq().max, (v) => {
      seq().max = v;
      touch();
    }, 1, 16),
    ...Array.from({ length: 16 }, (_, i) =>
      num(`STEP ${i + 1}`, () => seq().values[i] ?? 1, (v) => {
        seq().values[i] = v;
        touch();
      }, 1, 16),
    ),
  ];

  return {
    kind: 'params',
    title: () => `${section === 'input' ? 'INPUT' : 'TRACK'} FX ${slotId}`,
    pages: () => [
      page([
        list('TYPE', types, () => slot().type, (v) => {
          slot().type = v;
          slot().params = defaultFxParams(v);
          slot().sequence.target = '';
          touch();
        }),
        onOff('FX SW', () => slot().sw, (v) => {
          slot().sw = v;
          touch();
        }),
        list('SW MODE', ['TOGGLE', 'MOMENT'], () => slot().swMode, (v) => {
          slot().swMode = v as 'TOGGLE';
          touch();
        }),
        list('INSERT', inserts, () => slot().insert, (v) => {
          slot().insert = v;
          touch();
        }),
      ]),
      ...paginate(fxParams()),
      ...paginate(seqParams(), 'SEQ'),
    ],
  };
}

function fxSectionNode(host: ParamHost, section: 'input' | 'track'): MenuNode {
  const sect = () => (section === 'input' ? host.memory().inputFx : host.memory().trackFx);
  const bank = () => sect().banks[sect().bank];
  const touch = () => host.touchFx(section);
  const bankNode: ParamsNode = {
    kind: 'params',
    title: () => `${section === 'input' ? 'INPUT' : 'TRACK'} FX BANK`,
    pages: () => [
      page([
        list('BANK', FX_BANKS as unknown as string[], () => sect().bank, (v) => {
          sect().bank = v as FxBank;
          touch();
        }),
        onOff('BANK SW', () => bank().sw, (v) => {
          bank().sw = v;
          touch();
        }),
        list('BANK MODE', ['SINGLE', 'MULTI'], () => bank().mode, (v) => {
          bank().mode = v as 'SINGLE';
          touch();
        }),
        list('FX TARGET', FX_SLOTS as unknown as string[], () => bank().fxTarget, (v) => {
          bank().fxTarget = v as FxSlot;
          host.setFxSlot(v as FxSlot);
          touch();
        }),
      ]),
    ],
  };

  return {
    kind: 'menu',
    title: section === 'input' ? 'INPUT FX' : 'TRACK FX',
    items: () => [
      { label: 'BANK', hint: () => sect().bank, node: bankNode },
      ...FX_SLOTS.map((s) => ({
        label: `FX ${s}`,
        hint: () => bank().slots[s].type,
        node: fxSlotNode(host, section, s),
        onEnter: () => {
          host.setFxSection(section);
          host.setFxSlot(s);
        },
      })),
    ],
  };
}

export function buildLoopMenu(host: ParamHost): MenuNode {
  const trackNodes = Array.from({ length: NUM_TRACKS }, (_, i) => trackNode(host, i));
  return {
    kind: 'menu',
    title: 'LOOP',
    items: () => [
      ...trackNodes.map((node, i) => ({
        label: `TRACK ${i + 1}`,
        node,
        onEnter: () => host.setEditTrack(i),
      })),
      { label: 'REC', node: recNode(host) },
      { label: 'PLAY', node: playNode(host) },
      { label: 'RHYTHM', hint: () => host.memory().rhythm.pattern, node: rhythmNode(host) },
      { label: 'INPUT FX', node: fxSectionNode(host, 'input') },
      { label: 'TRACK FX', node: fxSectionNode(host, 'track') },
      { label: 'NAME', hint: () => host.memory().name, node: { kind: 'special', title: 'NAME', id: 'name' } },
    ],
  };
}

// ---------------------------------------------------------------------------
// MENU (system) tree
// ---------------------------------------------------------------------------

type ChannelKey = 'mic1' | 'mic2' | 'inst1' | 'inst2' | 'usb';

function channelNode(host: ParamHost, key: ChannelKey, label: string): ParamsNode {
  const c = () => host.system().input.channels[key];
  const touch = () => host.touchSystem();
  const isMic = key === 'mic1' || key === 'mic2';
  return {
    kind: 'params',
    title: label,
    pages: () => [
      page([
        num('LEVEL', () => c().level, (v) => {
          c().level = v;
          touch();
        }, 0, 200),
        onOff('MUTE', () => c().mute, (v) => {
          c().mute = v;
          touch();
        }),
        num('REVERB', () => c().reverb, (v) => {
          c().reverb = v;
          touch();
        }, 0, 100),
        key === 'usb'
          ? null
          : num('GAIN', () => c().gain ?? 50, (v) => {
              c().gain = v;
              touch();
            }, 0, 100),
      ]),
      page([
        isMic
          ? onOff('PHANTOM', () => c().phantom ?? false, (v) => {
              c().phantom = v;
              touch();
            })
          : null,
        onOff('EQ SW', () => c().eq.sw, (v) => {
          c().eq.sw = v;
          touch();
        }),
        num('EQ LOW', () => c().eq.low, (v) => {
          c().eq.low = v;
          touch();
        }, -20, 20, { fmt: dbFmt }),
        num('EQ MID', () => c().eq.mid, (v) => {
          c().eq.mid = v;
          touch();
        }, -20, 20, { fmt: dbFmt }),
      ]),
      page([
        choice(
          'MID FREQ',
          MID_FREQ.map((f) => ({ label: hzFmt(f), value: f })),
          () => c().eq.midFreq,
          (v) => {
            c().eq.midFreq = v;
            touch();
          },
        ),
        num('EQ HIGH', () => c().eq.high, (v) => {
          c().eq.high = v;
          touch();
        }, -20, 20, { fmt: dbFmt }),
        num('EQ LEVEL', () => c().eq.level, (v) => {
          c().eq.level = v;
          touch();
        }, -20, 20, { fmt: dbFmt }),
      ]),
      page([
        onOff('COMP SW', () => c().dynamics.compSw, (v) => {
          c().dynamics.compSw = v;
          touch();
        }),
        num('COMP THRS', () => c().dynamics.compThreshold, (v) => {
          c().dynamics.compThreshold = v;
          touch();
        }, 0, 100),
        onOff('NS SW', () => c().dynamics.nsSw, (v) => {
          c().dynamics.nsSw = v;
          touch();
        }),
        num('NS THRS', () => c().dynamics.nsThreshold, (v) => {
          c().dynamics.nsThreshold = v;
          touch();
        }, 0, 100),
      ]),
    ],
  };
}

function inputMenu(host: ParamHost): MenuNode {
  const sl = () => host.system().input.stereoLink;
  const touch = () => host.touchSystem();
  const linkNode: ParamsNode = {
    kind: 'params',
    title: 'STEREO LINK',
    pages: () => [
      page([
        onOff('MIC 1/2', () => sl().mic, (v) => {
          sl().mic = v;
          touch();
        }),
        onOff('INST 1 L/R', () => sl().inst1, (v) => {
          sl().inst1 = v;
          touch();
        }),
        onOff('INST 2 L/R', () => sl().inst2, (v) => {
          sl().inst2 = v;
          touch();
        }),
      ]),
    ],
  };
  return {
    kind: 'menu',
    title: 'INPUT',
    items: () => [
      { label: 'STEREO LINK', node: linkNode },
      { label: 'MIC 1', node: channelNode(host, 'mic1', 'MIC 1') },
      { label: 'MIC 2', node: channelNode(host, 'mic2', 'MIC 2') },
      { label: 'INST 1', node: channelNode(host, 'inst1', 'INST 1') },
      { label: 'INST 2', node: channelNode(host, 'inst2', 'INST 2') },
      { label: 'USB IN', node: channelNode(host, 'usb', 'USB IN') },
    ],
  };
}

function busNode(host: ParamHost, key: 'main' | 'sub1' | 'sub2', label: string): ParamsNode {
  const b = () => host.system().output[key];
  const touch = () => host.touchSystem();
  return {
    kind: 'params',
    title: label,
    pages: () => [
      page([
        num('LEVEL', () => b().level, (v) => {
          b().level = v;
          touch();
        }, 0, 200),
        onOff('EQ SW', () => b().eq.sw, (v) => {
          b().eq.sw = v;
          touch();
        }),
        num('EQ LOW', () => b().eq.low, (v) => {
          b().eq.low = v;
          touch();
        }, -20, 20, { fmt: dbFmt }),
        num('EQ MID', () => b().eq.mid, (v) => {
          b().eq.mid = v;
          touch();
        }, -20, 20, { fmt: dbFmt }),
      ]),
      page([
        choice(
          'MID FREQ',
          MID_FREQ.map((f) => ({ label: hzFmt(f), value: f })),
          () => b().eq.midFreq,
          (v) => {
            b().eq.midFreq = v;
            touch();
          },
        ),
        num('EQ HIGH', () => b().eq.high, (v) => {
          b().eq.high = v;
          touch();
        }, -20, 20, { fmt: dbFmt }),
        num('EQ LEVEL', () => b().eq.level, (v) => {
          b().eq.level = v;
          touch();
        }, -20, 20, { fmt: dbFmt }),
      ]),
      ...paginate(
        [
          ...Array.from({ length: NUM_TRACKS }, (_, i) =>
            onOff(`OUT TRACK${i + 1}`, () => b().routing.tracks[i] ?? true, (v) => {
              b().routing.tracks[i] = v;
              touch();
            }),
          ),
          onOff('OUT RHYTHM', () => b().routing.rhythm, (v) => {
            b().routing.rhythm = v;
            touch();
          }),
        ],
        'ROUTING',
      ),
    ],
  };
}

function outputMenu(host: ParamHost): MenuNode {
  const fx = () => host.system().output.masterFx;
  const touch = () => host.touchSystem();
  const masterFxNode: ParamsNode = {
    kind: 'params',
    title: 'MASTER FX',
    pages: () => [
      page([
        onOff('REVERB SW', () => fx().reverb.sw, (v) => {
          fx().reverb.sw = v;
          touch();
        }),
        list('RVB TYPE', REVERB_TYPES, () => fx().reverb.type, (v) => {
          fx().reverb.type = v;
          touch();
        }),
        num('RVB TIME', () => fx().reverb.time, (v) => {
          fx().reverb.time = v;
          touch();
        }, 0, 100),
        num('RVB LEVEL', () => fx().reverb.level, (v) => {
          fx().reverb.level = v;
          touch();
        }, 0, 100),
      ]),
      page([
        onOff('COMP SW', () => fx().comp.sw, (v) => {
          fx().comp.sw = v;
          touch();
        }),
        num('COMP THRS', () => fx().comp.threshold, (v) => {
          fx().comp.threshold = v;
          touch();
        }, 0, 100),
        list('COMP RATIO', COMP_RATIOS, () => fx().comp.ratio, (v) => {
          fx().comp.ratio = v;
          touch();
        }),
        num('COMP GAIN', () => fx().comp.gain, (v) => {
          fx().comp.gain = v;
          touch();
        }, -20, 20, { fmt: dbFmt }),
      ]),
    ],
  };
  const phones = () => host.system().output.phonesMix;
  const phonesNode: ParamsNode = {
    kind: 'params',
    title: 'PHONES MIX',
    pages: () =>
      paginate([
        ...Array.from({ length: NUM_TRACKS }, (_, i) =>
          onOff(`TRACK ${i + 1}`, () => phones().tracks[i] ?? true, (v) => {
            phones().tracks[i] = v;
            touch();
          }),
        ),
        onOff('RHYTHM', () => phones().rhythm, (v) => {
          phones().rhythm = v;
          touch();
        }),
        onOff('INPUTS', () => phones().inputs, (v) => {
          phones().inputs = v;
          touch();
        }),
      ]),
  };
  return {
    kind: 'menu',
    title: 'OUTPUT',
    items: () => [
      { label: 'MAIN OUT', node: busNode(host, 'main', 'MAIN OUT') },
      { label: 'SUB 1 OUT', node: busNode(host, 'sub1', 'SUB 1 OUT') },
      { label: 'SUB 2 OUT', node: busNode(host, 'sub2', 'SUB 2 OUT') },
      { label: 'MASTER FX', node: masterFxNode },
      { label: 'PHONES MIX', node: phonesNode },
    ],
  };
}

function ctlFuncNode(host: ParamHost): ParamsNode {
  const c = () => host.system().ctlFunc;
  const touch = () => host.touchSystem();
  return {
    kind: 'params',
    title: 'CTL FUNC',
    pages: () => [
      page(
        [
          list('PNL TRACK', TRACK_BTN_FUNCS, () => c().panelPlay.trackButton, (v) => {
            c().panelPlay.trackButton = v;
            touch();
          }),
          list('PNL FX', FX_BTN_FUNCS, () => c().panelPlay.fxButton, (v) => {
            c().panelPlay.fxButton = v;
            touch();
          }),
        ],
        'PANEL (PLAY)',
      ),
      page(
        [
          list('UND FX', UNDO_BTN_FUNCS, () => c().panelUndo.fxButton, (v) => {
            c().panelUndo.fxButton = v;
            touch();
          }),
          list('UND TRACK', UNDO_BTN_FUNCS, () => c().panelUndo.trackButton, (v) => {
            c().panelUndo.trackButton = v;
            touch();
          }),
          list('UND STOP', UNDO_BTN_FUNCS, () => c().panelUndo.stopButton, (v) => {
            c().panelUndo.stopButton = v;
            touch();
          }),
          list('UND REC', UNDO_BTN_FUNCS, () => c().panelUndo.recButton, (v) => {
            c().panelUndo.recButton = v;
            touch();
          }),
        ],
        'PANEL (UNDO)',
      ),
    ],
  };
}

function setupNode(host: ParamHost): ParamsNode {
  const s = () => host.system().setup;
  const touch = () => host.touchSystem();
  return {
    kind: 'params',
    title: 'SETUP',
    pages: () => [
      page([
        num('CONTRAST', () => s().displayContrast, (v) => {
          s().displayContrast = v;
          touch();
        }, 1, 10),
        list('AUTO OFF', AUTO_OFF as unknown as string[], () => s().autoOff, (v) => {
          s().autoOff = v as 'OFF';
          touch();
        }),
        onOff('KNOB LOCK', () => s().knobLock, (v) => {
          s().knobLock = v;
          touch();
        }),
        num('PLAY SCRN', () => s().playScreen, (v) => {
          s().playScreen = v;
          touch();
        }, 1, 7),
      ]),
      page([
        num('LED DIMMER', () => s().ledDimmer, (v) => {
          s().ledDimmer = v;
          touch();
        }, 1, 10),
        onOff('QUICK CLEAR', () => s().quickClear, (v) => {
          s().quickClear = v;
          touch();
        }),
        onOff('ALL CLEAR', () => s().allClear, (v) => {
          s().allClear = v;
          touch();
        }),
      ]),
    ],
  };
}

function midiNode(host: ParamHost): ParamsNode {
  const m = () => host.system().midi;
  const touch = () => host.touchSystem();
  const chParam = (label: string, key: 'rxChCtl' | 'rxChRhythm' | 'rxChVoice' | 'txCh'): Param =>
    list(label, MIDI_CH, () => String(m()[key]), (v) => {
      m()[key] = v === 'OFF' ? 'OFF' : Number(v);
      touch();
    });
  return {
    kind: 'params',
    title: 'MIDI',
    pages: () => [
      page([
        chParam('RX CH CTL', 'rxChCtl'),
        chParam('RX CH RHY', 'rxChRhythm'),
        chParam('RX CH VOC', 'rxChVoice'),
        chParam('TX CH', 'txCh'),
      ]),
      page([
        list('SYNC CLOCK', ['AUTO', 'INTERNAL', 'MIDI', 'USB'], () => m().syncClock, (v) => {
          m().syncClock = v as 'AUTO';
          touch();
        }),
        onOff('SYNC OUT', () => m().syncOut, (v) => {
          m().syncOut = v;
          touch();
        }),
        list('SYNC START', ['OFF', 'ALL START', 'RHYTHM'], () => m().syncStart, (v) => {
          m().syncStart = v as 'OFF';
          touch();
        }),
        onOff('PC OUT', () => m().pcOut, (v) => {
          m().pcOut = v;
          touch();
        }),
      ]),
    ],
  };
}

function usbNode(host: ParamHost): ParamsNode {
  const u = () => host.system().usb;
  const touch = () => host.touchSystem();
  return {
    kind: 'params',
    title: 'USB',
    pages: () => [
      page([
        list('ROUTING', ['LOOP IN', 'SUB MIX', 'MAIN OUT'], () => u().audioRouting, (v) => {
          u().audioRouting = v as 'LOOP IN';
          touch();
        }),
        num('IN LEVEL', () => u().inputLevel, (v) => {
          u().inputLevel = v;
          touch();
        }, 0, 200),
        num('OUT LEVEL', () => u().outputLevel, (v) => {
          u().outputLevel = v;
          touch();
        }, 0, 200),
      ]),
    ],
  };
}

export function buildSystemMenu(host: ParamHost): MenuNode {
  return {
    kind: 'menu',
    title: 'MENU',
    items: () => [
      { label: 'INPUT', node: inputMenu(host) },
      { label: 'OUTPUT', node: outputMenu(host) },
      { label: 'CTL FUNC', node: ctlFuncNode(host) },
      { label: 'USB', node: usbNode(host) },
      { label: 'MIDI', node: midiNode(host) },
      { label: 'SETUP', node: setupNode(host) },
      { label: 'FACTORY RESET', node: { kind: 'special', title: 'FACTORY RESET', id: 'reset' } },
    ],
  };
}
