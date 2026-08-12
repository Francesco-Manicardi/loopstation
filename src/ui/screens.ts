/**
 * All LCD screens: the seven play-screen variations, the MIXER screen, the
 * generic menu/parameter screens driven by `params.ts`, the name editor and the
 * WRITE/CLEAR confirmations.
 */

import { Lcd, LCD_HEIGHT, LCD_WIDTH } from './lcd/lcd';
import { nodeTitle, type Page, type Param } from './params';
import type { Store } from '../state/store';
import { fxType } from '../data/fx-list';
import { parseBeat } from '../data/rhythm-data';
import { FX_SLOTS, NUM_TRACKS, type TrackStatus } from '../types';

export interface ScreenCtx {
  store: Store;
  /** Seconds, used for blinking elements. */
  time: number;
}

const KNOB_LABEL_Y = 48;
const KNOB_VALUE_Y = 57;
const CONTENT_TOP = 10;

export const NAME_CHARS = " ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!\"#$%&'()*+,-./:;<=>?@[]^_`{|}~";

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

function fmtTempo(t: number): string {
  return Number.isInteger(t) ? `${t}.0` : t.toFixed(1);
}

function stateIcon(st: TrackStatus | undefined): string {
  if (!st) return '';
  switch (st.state) {
    case 'recording':
      return '●';
    case 'overdubbing':
      return '◐';
    case 'playing':
      return '▶';
    case 'rec-standby':
    case 'play-standby':
      return '○';
    case 'stopping':
      return '▶';
    case 'stopped':
      return '■';
    default:
      return '';
  }
}

function trackIcon(lcd: Lcd, x: number, y: number, st: TrackStatus | undefined, blink: boolean): void {
  // 7×7 status icon: filled square = phrase, hollow = empty, triangle = playing.
  if (!st || (!st.hasPhrase && st.state === 'empty')) {
    lcd.rect(x, y, 7, 7);
    return;
  }
  switch (st.state) {
    case 'recording':
    case 'rec-standby':
      if (blink || st.state === 'recording') lcd.fillRect(x + 1, y + 1, 5, 5);
      lcd.rect(x, y, 7, 7);
      break;
    case 'playing':
    case 'overdubbing':
    case 'stopping':
      for (let i = 0; i < 4; i++) lcd.vLine(x + 1 + i, y + i, 7 - i * 2);
      break;
    default:
      lcd.fillRect(x, y, 7, 7);
      break;
  }
}

function header(lcd: Lcd, ctx: ScreenCtx): void {
  const { store } = ctx;
  const num = String(store.current + 1).padStart(2, '0');
  lcd.text(1, 1, num, { invert: true });
  lcd.text(16, 1, store.memory.name.slice(0, 12));
  if (store.ui.dirty) lcd.text(16 + lcd.measure(store.memory.name.slice(0, 12)) + 3, 1, '*');
  const tempo = `♩${fmtTempo(store.memory.tempo)}`;
  lcd.text(127, 1, tempo, { right: true });
  if (store.system.setup.knobLock) lcd.text(80, 1, 'L');
  lcd.hLine(0, 9, LCD_WIDTH);
}

function titleBar(lcd: Lcd, title: string, right?: string): void {
  lcd.fillRect(0, 0, LCD_WIDTH, 9);
  lcd.text(2, 1, title.slice(0, 16), { invert: true });
  if (right) lcd.text(126, 1, right, { right: true, invert: true });
}

function knobStrip(lcd: Lcd, cells: { label: string; value: string }[], focus = -1): void {
  lcd.fillRect(0, KNOB_LABEL_Y, LCD_WIDTH, 9);
  for (let i = 0; i < 4; i++) {
    const cell = cells[i];
    const x = i * 32;
    if (i > 0) {
      lcd.vLine(x, KNOB_LABEL_Y, 16, i === focus || i - 1 === focus ? true : false);
      for (let y = KNOB_VALUE_Y; y < LCD_HEIGHT; y += 2) lcd.px(x, y);
    }
    if (!cell) continue;
    const cx = x + 16;
    lcd.text(cx, KNOB_LABEL_Y + 1, fit(cell.label, 5), { center: true, invert: true });
    lcd.text(cx, KNOB_VALUE_Y, fit(cell.value, 5), { center: true });
    if (i === focus) lcd.invertRect(x + 1, KNOB_VALUE_Y - 1, 30, 8);
  }
}

/** Shortens a label/value to fit a cell, dropping vowels before truncating. */
export function fit(text: string, chars: number): string {
  if (text.length <= chars) return text;
  const compact = text.replace(/[ .]/g, '');
  if (compact.length <= chars) return compact;
  const noVowels = compact.replace(/(?!^)[AEIOUaeiou]/g, '');
  if (noVowels.length <= chars) return noVowels;
  return compact.slice(0, chars);
}

function meterBar(lcd: Lcd, x: number, y: number, w: number, h: number, value: number): void {
  lcd.rect(x, y, w, h);
  const filled = Math.round((w - 2) * Math.min(1, value));
  lcd.fillRect(x + 1, y + 1, filled, h - 2);
}

// ---------------------------------------------------------------------------
// Play screens
// ---------------------------------------------------------------------------

function playKnobCells(ctx: ScreenCtx): { label: string; value: string }[] {
  const { store } = ctx;
  return [
    { label: 'MEMORY', value: String(store.current + 1).padStart(2, '0') },
    { label: 'TEMPO', value: fmtTempo(store.memory.tempo) },
    { label: 'RHYTHM', value: String(store.memory.rhythm.level) },
    { label: 'VARI', value: store.memory.rhythm.variation },
  ];
}

function fxBadges(lcd: Lcd, x: number, y: number, section: 'input' | 'track', ctx: ScreenCtx): void {
  const sect = section === 'input' ? ctx.store.memory.inputFx : ctx.store.memory.trackFx;
  const bank = sect.banks[sect.bank];
  FX_SLOTS.forEach((id, i) => {
    const slot = bank.slots[id];
    const bx = x + i * 8;
    const on = bank.sw && slot.sw && (bank.mode === 'MULTI' || id === bank.fxTarget);
    if (on) {
      lcd.fillRect(bx, y, 7, 7);
      lcd.text(bx + 1, y + 1, id, { invert: true });
    } else {
      lcd.rect(bx, y, 7, 7);
      if (id === bank.fxTarget) lcd.px(bx + 3, y + 3);
    }
  });
}

function playVariation1(lcd: Lcd, ctx: ScreenCtx): void {
  const { store } = ctx;
  const blink = ctx.time % 0.6 < 0.3;
  for (let i = 0; i < NUM_TRACKS; i++) {
    const st = store.status?.tracks[i];
    const x = 1 + i * 25;
    const cx = x + 11;
    const current = i === store.ui.currentTrack;
    lcd.text(cx, CONTENT_TOP, String(i + 1), { center: true, invert: current });
    const active =
      st && (st.state === 'playing' || st.state === 'overdubbing' || st.state === 'recording' || st.state === 'stopping');
    lcd.ring(cx, 26, 8, active ? st!.position : -1, false);
    trackIcon(lcd, cx - 3, 23, st, blink);
    meterBar(lcd, x + 1, 36, 21, 4, st?.level ?? 0);
  }
  const st = store.status;
  const len = st?.loopLengthSeconds ?? 0;
  const info = st
    ? `${String(st.measure + 1).padStart(2, '0')}:${st.beatInMeasure + 1} ${len > 0 ? `${len.toFixed(1)}s` : '--'}`
    : '';
  lcd.text(1, 41, info);
  fxBadges(lcd, 62, 40, 'input', ctx);
  fxBadges(lcd, 96, 40, 'track', ctx);
}

function playVariation2(lcd: Lcd, ctx: ScreenCtx): void {
  const { store } = ctx;
  for (let i = 0; i < NUM_TRACKS; i++) {
    const st = store.status?.tracks[i];
    // 7.5 px pitch: five 7 px rows only just fit between the header and the
    // knob strip, so the odd rows get the spare pixel of breathing space.
    const y = CONTENT_TOP + Math.round(i * 7.5);
    // Five 7 px rows only just fit between the header and the knob strip, so the
    // track numbers are drawn as inverted cells — stacked light-on-black digits
    // would run into each other at this pitch.
    const current = i === store.ui.currentTrack;
    lcd.fillRect(0, y, 7, 7, !current);
    lcd.text(1, y, String(i + 1), { invert: !current });
    lcd.text(8, y, stateIcon(st));
    lcd.rect(15, y, 88, 6);
    if (st && st.hasPhrase) {
      const w = Math.round(86 * st.position);
      const active = st.state === 'playing' || st.state === 'overdubbing' || st.state === 'recording';
      if (active) lcd.fillRect(16, y + 1, w, 4);
      else lcd.dottedHLine(16, y + 3, 86);
    }
    meterBar(lcd, 105, y, 22, 6, st?.level ?? 0);
  }
}

function playVariation3(lcd: Lcd, ctx: ScreenCtx): void {
  const { store, time } = ctx;
  const st = store.status;
  lcd.text(1, CONTENT_TOP + 1, '♩');
  lcd.text(64, CONTENT_TOP + 4, fmtTempo(store.memory.tempo), { center: true, scale: 2 });
  const { num, den } = parseBeat(store.memory.rhythm.beat);
  const beats = Math.max(1, den === 8 ? Math.round(num / 2) : num);
  for (let i = 0; i < beats; i++) {
    const x = Math.round(64 - (beats * 9 - 2) / 2 + i * 9);
    const on = st?.running
      ? st.beatInMeasure === i
      : Math.floor(time * (store.memory.tempo / 60)) % beats === i;
    if (on) lcd.fillRect(x, 31, 7, 7);
    else lcd.rect(x, 31, 7, 7);
  }
  lcd.text(1, 41, store.memory.rhythm.beat);
  lcd.text(127, 41, fit(store.memory.rhythm.pattern, 12), { right: true });
}

function playVariation4(lcd: Lcd, ctx: ScreenCtx): void {
  const { store } = ctx;
  for (let i = 0; i < NUM_TRACKS; i++) {
    const st = store.status?.tracks[i];
    const x = 6 + i * 14;
    lcd.meter(x, CONTENT_TOP + 1, 9, 27, st?.level ?? 0);
    lcd.text(x + 4, 39, String(i + 1), { center: true, invert: i === store.ui.currentTrack });
  }
  lcd.text(84, CONTENT_TOP, 'IN');
  lcd.meter(96, CONTENT_TOP, 8, 12, store.status?.inputPeak ?? 0);
  lcd.text(78, CONTENT_TOP + 15, 'OUT');
  lcd.meter(96, CONTENT_TOP + 14, 8, 12, store.status?.outputPeak[0] ?? 0);
  lcd.meter(107, CONTENT_TOP + 14, 8, 12, store.status?.outputPeak[1] ?? 0);
}

function playVariation5(lcd: Lcd, ctx: ScreenCtx): void {
  const { store } = ctx;
  const sections: ('input' | 'track')[] = ['input', 'track'];
  sections.forEach((section, row) => {
    const sect = section === 'input' ? store.memory.inputFx : store.memory.trackFx;
    const bank = sect.banks[sect.bank];
    const slot = bank.slots[bank.fxTarget];
    const y = CONTENT_TOP + row * 18;
    lcd.text(1, y, section === 'input' ? 'IN FX' : 'TR FX');
    lcd.text(36, y, `${sect.bank}${bank.mode === 'MULTI' ? '*' : ''}`);
    fxBadges(lcd, 50, y - 1, section, ctx);
    lcd.text(1, y + 9, fit(fxType(slot.type).name, 20), { invert: bank.sw && slot.sw });
  });
}

function playVariation6(lcd: Lcd, ctx: ScreenCtx): void {
  const { store } = ctx;
  const r = store.memory.rhythm;
  const st = store.status;
  lcd.text(1, CONTENT_TOP, r.genre);
  lcd.text(127, CONTENT_TOP, r.beat, { right: true });
  lcd.text(1, CONTENT_TOP + 9, fit(r.pattern, 12));
  lcd.text(127, CONTENT_TOP + 9, `VARI ${r.variation}`, { right: true });
  lcd.text(1, CONTENT_TOP + 18, fit(r.kit, 10));
  const bar = st ? String(st.measure + 1).padStart(2, '0') : '--';
  const beat = st ? String(st.beatInMeasure + 1) : '-';
  lcd.text(127, CONTENT_TOP + 18, `${bar}:${beat}`, { right: true, scale: 1 });
  if (st?.running) lcd.fillRect(60, CONTENT_TOP + 18, 5, 5);
}

function playVariation7(lcd: Lcd, ctx: ScreenCtx): void {
  const { store } = ctx;
  lcd.text(64, CONTENT_TOP + 1, String(store.current + 1).padStart(2, '0'), { center: true, scale: 3 });
  lcd.text(64, CONTENT_TOP + 23, store.memory.name.slice(0, 12), { center: true, scale: 1 });
  for (let i = 0; i < NUM_TRACKS; i++) {
    trackIcon(lcd, 40 + i * 10, 41, store.status?.tracks[i], true);
  }
}

const PLAY_VARIATIONS = [
  playVariation1,
  playVariation2,
  playVariation3,
  playVariation4,
  playVariation5,
  playVariation6,
  playVariation7,
];

function renderPlay(lcd: Lcd, ctx: ScreenCtx): void {
  const v = Math.min(PLAY_VARIATIONS.length, Math.max(1, ctx.store.ui.playVariation));
  if (v === 7) {
    // The "memory" variation uses the full screen height.
    lcd.text(1, 1, `MEMORY ${String(ctx.store.current + 1).padStart(2, '0')}`);
    lcd.text(127, 1, `♩${fmtTempo(ctx.store.memory.tempo)}`, { right: true });
    lcd.hLine(0, 9, LCD_WIDTH);
  } else {
    header(lcd, ctx);
  }
  PLAY_VARIATIONS[v - 1](lcd, ctx);
  knobStrip(lcd, playKnobCells(ctx), ctx.store.ui.knob);
}

// ---------------------------------------------------------------------------
// MIXER
// ---------------------------------------------------------------------------

interface MixerStrip {
  label: string;
  level: number;
  mute: boolean;
  peak: number;
}

function mixerStrips(ctx: ScreenCtx): MixerStrip[][] {
  const { store } = ctx;
  const ch = store.system.input.channels;
  const inPeak = store.status?.inputPeak ?? 0;
  const link = store.system.input.stereoLink.mic;
  const page1: MixerStrip[] = link
    ? [
        { label: 'MIC', level: ch.mic1.level, mute: ch.mic1.mute, peak: inPeak },
        { label: 'INST1', level: ch.inst1.level, mute: ch.inst1.mute, peak: inPeak * 0.8 },
        { label: 'INST2', level: ch.inst2.level, mute: ch.inst2.mute, peak: inPeak * 0.8 },
        { label: 'USB', level: ch.usb.level, mute: ch.usb.mute, peak: 0 },
      ]
    : [
        { label: 'MIC1', level: ch.mic1.level, mute: ch.mic1.mute, peak: inPeak },
        { label: 'MIC2', level: ch.mic2.level, mute: ch.mic2.mute, peak: inPeak * 0.5 },
        { label: 'INST1', level: ch.inst1.level, mute: ch.inst1.mute, peak: inPeak * 0.8 },
        { label: 'INST2', level: ch.inst2.level, mute: ch.inst2.mute, peak: inPeak * 0.8 },
      ];
  const out = store.system.output;
  const peak = store.status?.outputPeak ?? [0, 0];
  const page2: MixerStrip[] = [
    { label: 'MAIN', level: out.main.level, mute: false, peak: (peak[0] + peak[1]) / 2 },
    { label: 'SUB1', level: out.sub1.level, mute: false, peak: (peak[0] + peak[1]) / 2 },
    { label: 'SUB2', level: out.sub2.level, mute: false, peak: (peak[0] + peak[1]) / 2 },
    { label: 'USB', level: store.system.usb.outputLevel, mute: false, peak: 0 },
  ];
  const trackPeak = store.status?.tracks.reduce((m, t) => Math.max(m, t.level), 0) ?? 0;
  const page3: MixerStrip[] = [
    { label: 'LOOP', level: out.loopLevel, mute: false, peak: trackPeak },
    { label: 'RHYTM', level: out.rhythmLevel, mute: false, peak: store.status?.running ? 0.5 : 0 },
    { label: 'MASTR', level: out.masterLevel, mute: false, peak: (peak[0] + peak[1]) / 2 },
  ];
  return [page1, page2, page3];
}

function renderMixer(lcd: Lcd, ctx: ScreenCtx): void {
  const pages = mixerStrips(ctx);
  const page = Math.min(pages.length - 1, Math.max(0, ctx.store.ui.mixerPage));
  const titles = ['MIXER  INPUT', 'MIXER  OUTPUT', 'MIXER  LOOP/RHYTHM'];
  titleBar(lcd, titles[page] ?? 'MIXER', `${page + 1}/${pages.length}`);
  const strips = pages[page];
  strips.forEach((s, i) => {
    // 32 px pitch keeps each strip above the knob that controls it.
    const x = 10 + i * 32;
    // Scale marks: the hardware prints a target range on the meter.
    for (let m = 0; m <= 4; m++) lcd.px(x - 3, 12 + m * 6);
    lcd.hLine(x - 5, 18, 3);
    lcd.meter(x, 11, 12, 26, Math.min(1, s.peak * 1.2));
    // Level setting drawn as a fader cap across the meter.
    const ly = 11 + 24 - Math.round((Math.min(200, s.level) / 200) * 22);
    lcd.fillRect(x - 2, ly, 16, 2);
    lcd.text(x + 6, 39, fit(s.label, 5), { center: true, invert: s.mute });
  });
  knobStrip(
    lcd,
    strips.map((s) => ({ label: s.label, value: s.mute ? 'MUTE' : String(s.level) })),
    ctx.store.ui.knob,
  );
}

// ---------------------------------------------------------------------------
// Menu / parameter screens
// ---------------------------------------------------------------------------

function renderMenu(lcd: Lcd, title: string, items: { label: string; hint?: () => string }[], cursor: number): void {
  titleBar(lcd, title, `${cursor + 1}/${items.length}`);
  const rows = 5;
  const first = Math.max(0, Math.min(items.length - rows, cursor - Math.floor(rows / 2)));
  for (let r = 0; r < rows; r++) {
    const index = first + r;
    if (index >= items.length) break;
    const item = items[index];
    const y = 11 + r * 10;
    const selected = index === cursor;
    if (selected) lcd.fillRect(0, y - 1, LCD_WIDTH, 9);
    lcd.text(3, y, fit(item.label, 14), { invert: selected });
    const hint = item.hint?.();
    if (hint) lcd.text(125, y, fit(hint, 7), { right: true, invert: selected });
  }
  // Scroll bar.
  if (items.length > rows) {
    const h = Math.max(4, Math.round((rows / items.length) * 50));
    const y = 11 + Math.round((first / (items.length - rows)) * (50 - h));
    lcd.vLine(126, 11, 50);
    lcd.fillRect(125, y, 3, h);
  }
}

function renderParams(lcd: Lcd, title: string, pages: Page[], pageIndex: number, focus: number): void {
  const page = pages[Math.min(pages.length - 1, Math.max(0, pageIndex))] ?? { params: [] };
  // The title bar has room for 16 characters next to the page counter, so the
  // section and the page group are joined with a colon rather than a space.
  const label = page.title ? `${title}:${page.title}` : title;
  titleBar(lcd, label, pages.length > 1 ? `${pageIndex + 1}/${pages.length}` : undefined);
  page.params.forEach((p: Param, i: number) => {
    const y = 12 + i * 13;
    const selected = i === focus;
    if (selected) lcd.fillRect(0, y - 2, LCD_WIDTH, 11);
    // Knob number badge: a solid square holding the knob's number, inverted
    // against whatever the row background happens to be.
    lcd.fillRect(0, y - 1, 8, 9, !selected);
    lcd.text(2, y, String(i + 1), { invert: !selected });
    const value = fit(p.value(), 11);
    lcd.text(10, y, fit(p.label, Math.max(4, 19 - value.length)), { invert: selected });
    lcd.text(127, y, value, { right: true, invert: selected });
  });
  if (!page.params.length) lcd.text(64, 30, '(NO PARAMETERS)', { center: true });
}

// ---------------------------------------------------------------------------
// NAME / WRITE / CLEAR
// ---------------------------------------------------------------------------

function renderName(lcd: Lcd, ctx: ScreenCtx): void {
  const { store } = ctx;
  titleBar(lcd, 'MEMORY NAME');
  const name = store.memory.name.padEnd(12, ' ').slice(0, 12);
  const startX = 4;
  for (let i = 0; i < 12; i++) {
    const x = startX + i * 10;
    lcd.text(x, 16, name[i], { scale: 2 });
    if (i === store.ui.nameCursor) {
      lcd.hLine(x - 1, 32, 11);
      lcd.hLine(x - 1, 33, 11);
    }
  }
  lcd.text(64, 39, 'K J : CURSOR   [1] : CHAR', { center: true });
  knobStrip(
    lcd,
    [
      { label: 'CHAR', value: name[store.ui.nameCursor] === ' ' ? 'SPC' : name[store.ui.nameCursor] },
      { label: 'POS', value: String(store.ui.nameCursor + 1) },
      { label: 'INS', value: '-' },
      { label: 'DEL', value: '-' },
    ],
    store.ui.knob,
  );
}

function renderWrite(lcd: Lcd, ctx: ScreenCtx): void {
  const { store } = ctx;
  const clear = store.ui.writeMode === 'CLEAR';
  titleBar(lcd, clear ? 'CLEAR MEMORY' : 'WRITE MEMORY');
  const target = store.ui.writeTarget;
  lcd.text(64, 14, String(target + 1).padStart(2, '0'), { center: true, scale: 2 });
  lcd.text(64, 32, (clear ? store.memories[target].name : store.memory.name).slice(0, 12), { center: true });
  lcd.text(64, 41, clear ? 'ALL DATA WILL BE LOST' : 'ENTER=WRITE EXIT=EXIT', { center: true });
  knobStrip(
    lcd,
    [
      { label: 'TARGET', value: String(target + 1) },
      { label: 'MODE', value: clear ? 'CLEAR' : 'WRITE' },
      { label: '', value: '' },
      { label: '', value: '' },
    ],
    store.ui.knob,
  );
}

function renderReset(lcd: Lcd): void {
  titleBar(lcd, 'FACTORY RESET');
  lcd.text(64, 16, 'ALL MEMORIES AND', { center: true });
  lcd.text(64, 25, 'SETTINGS WILL BE', { center: true });
  lcd.text(64, 34, 'INITIALIZED', { center: true });
  lcd.text(64, 46, 'ENTER=OK  EXIT=CANCEL', { center: true });
}

// ---------------------------------------------------------------------------
// Overlays
// ---------------------------------------------------------------------------

function overlayBox(lcd: Lcd, lines: string[]): void {
  const w = Math.min(LCD_WIDTH - 8, Math.max(...lines.map((l) => lcd.measure(l))) + 12);
  const h = lines.length * 9 + 9;
  const x = Math.round((LCD_WIDTH - w) / 2);
  const y = Math.round((LCD_HEIGHT - h) / 2);
  lcd.fillRect(x, y, w, h, false);
  lcd.rect(x, y, w, h);
  lcd.rect(x + 1, y + 1, w - 2, h - 2);
  lines.forEach((l, i) => lcd.text(x + w / 2, y + 6 + i * 9, l, { center: true }));
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function renderLcd(lcd: Lcd, ctx: ScreenCtx): void {
  const { store } = ctx;
  lcd.clear();
  const entry = store.top;
  if (!entry) {
    renderPlay(lcd, ctx);
  } else if (entry.node.kind === 'menu') {
    renderMenu(lcd, entry.node.title, entry.node.items(), entry.cursor);
  } else if (entry.node.kind === 'params') {
    const pages = entry.node.pages();
    renderParams(lcd, nodeTitle(entry.node), pages, entry.page, store.ui.knob);
  } else {
    switch (entry.node.id) {
      case 'mixer':
        renderMixer(lcd, ctx);
        break;
      case 'name':
        renderName(lcd, ctx);
        break;
      case 'write':
      case 'clear':
        renderWrite(lcd, ctx);
        break;
      case 'reset':
        renderReset(lcd);
        break;
    }
  }

  // Value popups only appear over the play screen; edit screens show the value
  // in the row itself.
  const popup = store.ui.popup;
  if (popup && popup.until > ctx.time && !entry) {
    lcd.fillRect(0, KNOB_LABEL_Y - 10, LCD_WIDTH, 10, false);
    lcd.rect(0, KNOB_LABEL_Y - 10, LCD_WIDTH, 10);
    lcd.text(3, KNOB_LABEL_Y - 8, fit(popup.label, 12));
    lcd.text(125, KNOB_LABEL_Y - 8, popup.value, { right: true });
  } else if (popup) {
    store.ui.popup = null;
  }

  const msg = store.ui.message;
  if (msg && msg.until > ctx.time) overlayBox(lcd, msg.text.split('\n'));
  else if (msg) store.ui.message = null;

  lcd.present();
}
