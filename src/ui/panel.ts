/**
 * The panel replica. Everything is absolutely positioned inside a fixed
 * 1240 × 690 "design" surface which is then scaled to the viewport, so the
 * proportions of the real RC-505mkII top panel are preserved at any size.
 *
 * Layout follows the top-panel illustration in the Owner's Manual (p. 4):
 *   1 INPUT FX · 2 ALL START/STOP + UNDO/REDO · 3 MENU/LOOP/display/EXIT/ENTER/
 *   [K][J]/[1]–[4]/OUTPUT LEVEL · 4 TAP TEMPO · 5 RHYTHM · 6 TRACK FX ·
 *   7 TRACK 1–5
 */

import { NUM_TRACKS } from '../types';

export const PANEL_W = 1240;
export const PANEL_H = 690;

export type LedColor = 'off' | 'red' | 'green' | 'yellow' | 'pink' | 'blue' | 'white' | 'orange';

export interface PanelHandlers {
  press(id: string): void;
  release(id: string): void;
  knob(id: string, delta: number, coarse: boolean): void;
  knobPress(id: string): void;
  fader(track: number, value: number): void;
}

interface KnobEl {
  root: HTMLElement;
  pointer: HTMLElement;
  angle: number;
}

const el = (tag: string, cls: string, parent: HTMLElement, style?: Partial<CSSStyleDeclaration>): HTMLElement => {
  const node = document.createElement(tag);
  node.className = cls;
  if (style) Object.assign(node.style, style);
  parent.appendChild(node);
  return node;
};

const box = (x: number, y: number, w: number, h: number): Partial<CSSStyleDeclaration> => ({
  left: `${x}px`,
  top: `${y}px`,
  width: `${w}px`,
  height: `${h}px`,
});

export class Panel {
  readonly root: HTMLElement;
  readonly surface: HTMLElement;
  readonly lcdCanvas: HTMLCanvasElement;
  private buttons = new Map<string, HTMLElement>();
  private knobs = new Map<string, KnobEl>();
  private faders: { groove: HTMLElement; cap: HTMLElement }[] = [];
  private rings: { arc: HTMLElement; core: HTMLElement; label: HTMLElement }[] = [];
  private handlers: PanelHandlers;
  private held = new Set<string>();

  constructor(container: HTMLElement, handlers: PanelHandlers) {
    this.handlers = handlers;
    this.root = el('div', 'stage', container);
    this.surface = el('div', 'panel', this.root, { width: `${PANEL_W}px`, height: `${PANEL_H}px` });

    this.buildUpper();
    this.buildTracks();
    this.lcdCanvas = this.buildDisplay();

    window.addEventListener('resize', () => this.fit());
    this.fit();
  }

  fit(): void {
    const pad = 16;
    const scale = Math.min(
      (window.innerWidth - pad * 2) / PANEL_W,
      (window.innerHeight - pad * 2) / PANEL_H,
    );
    this.surface.style.transform = `scale(${Math.max(0.28, scale)})`;
    this.root.style.height = `${PANEL_H * Math.max(0.28, scale)}px`;
    this.root.style.width = `${PANEL_W * Math.max(0.28, scale)}px`;
  }

  // -----------------------------------------------------------------------
  // Construction
  // -----------------------------------------------------------------------

  private label(text: string, x: number, y: number, w: number, cls = ''): HTMLElement {
    const node = el('div', `label ${cls}`, this.surface, { ...box(x, y, w, 14), lineHeight: '14px' });
    node.textContent = text;
    return node;
  }

  private section(x: number, y: number, w: number, h: number, title: string): HTMLElement {
    const node = el('div', 'section', this.surface, box(x, y, w, h));
    const cap = el('div', 'section-title', node);
    cap.textContent = title;
    return node;
  }

  private button(
    id: string,
    x: number,
    y: number,
    w: number,
    h: number,
    text: string,
    cls = '',
  ): HTMLElement {
    const node = el('button', `btn ${cls}`, this.surface, box(x, y, w, h));
    node.setAttribute('type', 'button');
    node.dataset.id = id;
    node.dataset.led = 'off';
    const lamp = el('span', 'lamp', node);
    lamp.setAttribute('aria-hidden', 'true');
    const cap = el('span', 'cap', node);
    cap.innerHTML = text;
    node.setAttribute('aria-label', text.replace(/<[^>]+>/g, ' ').trim() || id);
    node.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      if (this.held.has(id)) return;
      this.held.add(id);
      node.classList.add('down');
      this.handlers.press(id);
    });
    const up = () => {
      if (!this.held.has(id)) return;
      this.held.delete(id);
      node.classList.remove('down');
      this.handlers.release(id);
    };
    node.addEventListener('pointerup', up);
    node.addEventListener('pointercancel', up);
    node.addEventListener('pointerleave', (e) => {
      if ((e as PointerEvent).buttons) up();
    });
    node.addEventListener('keydown', (e) => e.preventDefault());
    this.buttons.set(id, node);
    return node;
  }

  private knob(id: string, cx: number, cy: number, size: number, cls = ''): void {
    const node = el('div', `knob ${cls}`, this.surface, box(cx - size / 2, cy - size / 2, size, size));
    node.dataset.id = id;
    node.setAttribute('role', 'slider');
    node.setAttribute('aria-label', id);
    el('div', 'knob-body', node);
    const pointer = el('div', 'knob-pointer', node);
    const knob: KnobEl = { root: node, pointer, angle: 0 };
    this.knobs.set(id, knob);

    let last = 0;
    let coarse = false;
    let moved = false;
    let acc = 0;
    node.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      node.setPointerCapture(e.pointerId);
      node.classList.add('active');
      last = e.clientY;
      moved = false;
      acc = 0;
      coarse = e.button === 2 || e.shiftKey;
    });
    node.addEventListener('pointermove', (e) => {
      if (!node.hasPointerCapture(e.pointerId)) return;
      acc += last - e.clientY;
      last = e.clientY;
      const step = 3.5;
      while (Math.abs(acc) >= step) {
        const dir = acc > 0 ? 1 : -1;
        acc -= dir * step;
        moved = true;
        this.handlers.knob(id, dir, coarse || e.shiftKey);
      }
    });
    const end = (e: PointerEvent) => {
      if (!node.hasPointerCapture(e.pointerId)) return;
      node.releasePointerCapture(e.pointerId);
      node.classList.remove('active');
      if (!moved) this.handlers.knobPress(id);
    };
    node.addEventListener('pointerup', end);
    node.addEventListener('pointercancel', end);
    node.addEventListener('contextmenu', (e) => e.preventDefault());
    node.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.handlers.knob(id, e.deltaY < 0 ? 1 : -1, e.shiftKey);
      },
      { passive: false },
    );
  }

  private buildUpper(): void {
    // --- 1 INPUT FX -------------------------------------------------------
    this.section(20, 14, 200, 210, 'INPUT FX');
    this.knob('inputFx', 120, 104, 108, 'knob-fx');
    for (let i = 0; i < 4; i++) {
      this.button(`inputFx${'ABCD'[i]}`, 26 + i * 38, 176, 32, 30, 'ABCD'[i], 'btn-fx');
    }
    this.button('inputFxEdit', 178, 176, 36, 30, 'EDIT', 'btn-small');

    // --- 2 ALL START/STOP, UNDO/REDO -------------------------------------
    this.button('allStart', 232, 40, 104, 62, 'ALL<br>START/STOP', 'btn-major');
    this.button('undoRedo', 232, 128, 104, 62, 'UNDO<br>REDO', 'btn-major');

    // --- 3 MENU / LOOP / display / EXIT / ENTER / arrows / [1]-[4] -------
    this.button('menu', 352, 26, 68, 34, 'MENU', 'btn-small');
    this.button('loop', 352, 74, 68, 34, 'LOOP', 'btn-small');
    this.button('exit', 752, 26, 68, 34, 'EXIT', 'btn-small');
    this.button('enter', 752, 74, 68, 34, 'ENTER', 'btn-small');
    this.button('left', 752, 122, 32, 34, '&#9664;', 'btn-small btn-arrow');
    this.button('right', 788, 122, 32, 34, '&#9654;', 'btn-small btn-arrow');

    for (let i = 0; i < 4; i++) {
      this.knob(`k${i + 1}`, 476 + i * 86, 236, 62, 'knob-value');
      this.label(String(i + 1), 476 + i * 86 - 20, 272, 40, 'label-center');
    }

    this.knob('output', 1132, 240, 74, 'knob-output');
    this.label('OUTPUT LEVEL', 1072, 282, 120, 'label-center');

    // --- 4 TAP TEMPO, 5 RHYTHM ------------------------------------------
    this.button('tap', 860, 30, 116, 44, 'TAP TEMPO', 'btn-small');
    this.section(848, 92, 140, 132, 'RHYTHM');
    this.button('rhythmEdit', 860, 122, 116, 38, 'EDIT', 'btn-small');
    this.button('rhythmStart', 860, 168, 116, 44, 'START/STOP', 'btn-rhythm');

    // --- 6 TRACK FX -----------------------------------------------------
    this.section(1016, 14, 200, 210, 'TRACK FX');
    this.knob('trackFx', 1116, 104, 108, 'knob-fx');
    for (let i = 0; i < 4; i++) {
      this.button(`trackFx${'ABCD'[i]}`, 1022 + i * 38, 176, 32, 30, 'ABCD'[i], 'btn-fx');
    }
    this.button('trackFxEdit', 1174, 176, 36, 30, 'EDIT', 'btn-small');
  }

  private buildDisplay(): HTMLCanvasElement {
    const bezel = el('div', 'bezel', this.surface, box(430, 14, 312, 182));
    const canvas = document.createElement('canvas');
    canvas.className = 'lcd';
    canvas.width = 128 * 4;
    canvas.height = 64 * 4;
    bezel.appendChild(canvas);
    return canvas as HTMLCanvasElement;
  }

  private buildTracks(): void {
    const strip = el('div', 'track-area', this.surface, box(0, 296, PANEL_W, PANEL_H - 296));
    strip.style.pointerEvents = 'none';
    for (let i = 0; i < NUM_TRACKS; i++) {
      const x = 24 + i * 238;
      const col = el('div', 'track-col', this.surface, box(x, 306, 220, 372));
      col.style.pointerEvents = 'none';
      this.button(`fx${i}`, x + 14, 316, 78, 32, 'FX', 'btn-fx-track');
      this.button(`track${i}`, x + 100, 316, 106, 32, 'TRACK', 'btn-track');

      // Loop indicator: LED ring + core, showing status, position and level.
      const ring = el('div', 'ring', this.surface, box(x + 58, 358, 104, 104));
      ring.style.pointerEvents = 'none';
      const arc = el('div', 'ring-arc', ring);
      const core = el('div', 'ring-core', ring);
      const label = el('div', 'ring-label', ring);
      label.textContent = String(i + 1);
      this.rings.push({ arc, core, label });

      this.button(`stop${i}`, x + 14, 480, 92, 46, '&#9632;', 'btn-stop');
      this.button(`play${i}`, x + 114, 480, 92, 46, '&#9654;/&#9679;', 'btn-play');

      // Track slider.
      const groove = el('div', 'fader', this.surface, box(x + 92, 546, 36, 128));
      const cap = el('div', 'fader-cap', groove);
      this.faders.push({ groove, cap });
      const set = (clientY: number) => {
        const r = groove.getBoundingClientRect();
        const v = 1 - (clientY - r.top) / r.height;
        this.handlers.fader(i, Math.min(1, Math.max(0, v)) * 100);
      };
      groove.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        groove.setPointerCapture(e.pointerId);
        set(e.clientY);
      });
      groove.addEventListener('pointermove', (e) => {
        if (groove.hasPointerCapture(e.pointerId)) set(e.clientY);
      });
      groove.addEventListener('pointerup', (e) => groove.releasePointerCapture(e.pointerId));
      groove.addEventListener(
        'wheel',
        (e) => {
          e.preventDefault();
          const current = (this.faderValue[i] ?? 1) * 100;
          this.handlers.fader(i, Math.min(100, Math.max(0, current + (e.deltaY < 0 ? 2 : -2))));
        },
        { passive: false },
      );
      this.label(`TRACK ${i + 1}`, x + 60, 682, 100, 'label-center label-track');
    }
  }

  // -----------------------------------------------------------------------
  // Updates
  // -----------------------------------------------------------------------

  private faderValue: number[] = [];

  setLed(id: string, color: LedColor, dim = 1): void {
    const node = this.buttons.get(id);
    if (!node) return;
    if (node.dataset.led !== color) node.dataset.led = color;
    const alpha = color === 'off' ? '0' : String(0.35 + 0.65 * dim);
    if (node.style.getPropertyValue('--lamp-alpha') !== alpha) node.style.setProperty('--lamp-alpha', alpha);
  }

  setKnob(id: string, value01: number): void {
    const knob = this.knobs.get(id);
    if (!knob) return;
    const angle = -150 + 300 * Math.min(1, Math.max(0, value01));
    if (knob.angle === angle) return;
    knob.angle = angle;
    knob.pointer.style.transform = `translate(-50%, 0) rotate(${angle}deg)`;
  }

  /** Endless encoders ([1]–[4]) just spin by the accumulated delta. */
  spinKnob(id: string, delta: number): void {
    const knob = this.knobs.get(id);
    if (!knob) return;
    knob.angle += delta * 15;
    knob.pointer.style.transform = `translate(-50%, 0) rotate(${knob.angle}deg)`;
  }

  setFader(track: number, value01: number): void {
    const f = this.faders[track];
    if (!f) return;
    this.faderValue[track] = value01;
    f.cap.style.bottom = `${Math.min(1, Math.max(0, value01)) * 100}%`;
  }

  setRing(track: number, opts: { color: LedColor; progress: number; level: number; on: boolean }): void {
    const r = this.rings[track];
    if (!r) return;
    const deg = Math.round(opts.progress * 360);
    const colorVar = `var(--led-${opts.color})`;
    r.arc.style.background =
      opts.progress >= 0 && opts.on
        ? `conic-gradient(${colorVar} 0deg ${deg}deg, rgba(255,255,255,0.06) ${deg}deg 360deg)`
        : opts.color === 'off'
          ? 'rgba(255,255,255,0.05)'
          : `conic-gradient(${colorVar} 0deg 360deg)`;
    r.arc.style.opacity = opts.color === 'off' ? '0.5' : String(0.55 + 0.45 * Math.min(1, opts.level * 2));
    r.core.style.background = opts.color === 'off' ? 'rgba(0,0,0,0.55)' : colorVar;
    r.core.style.opacity = String(0.25 + 0.75 * Math.min(1, opts.level * 2.2));
  }

  buttonElement(id: string): HTMLElement | undefined {
    return this.buttons.get(id);
  }
}
