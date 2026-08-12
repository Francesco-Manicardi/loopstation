/**
 * 128 × 64 dot-matrix LCD emulation.
 *
 * The RC-505mkII uses a negative (light-on-dark) graphic display. Everything is
 * drawn into a 1-bit framebuffer and blitted to a canvas with nearest-neighbour
 * scaling, so the result has the same hard pixel edges as the real panel.
 */

import { CHAR_ADVANCE, GLYPH_HEIGHT, GLYPH_WIDTH, glyph, glyphs, textWidth } from './font';

export const LCD_WIDTH = 128;
export const LCD_HEIGHT = 64;

export interface TextOptions {
  invert?: boolean;
  /** Integer pixel scale (2 gives the "large value" style of the play screen). */
  scale?: number;
  /** Centre the string on `x` instead of using it as the left edge. */
  center?: boolean;
  right?: boolean;
}

export class Lcd {
  readonly canvas: HTMLCanvasElement;
  private ctx2d: CanvasRenderingContext2D;
  private bits = new Uint8Array(LCD_WIDTH * LCD_HEIGHT);
  private image: ImageData;
  private buffer: HTMLCanvasElement;
  private bufferCtx: CanvasRenderingContext2D;
  private contrast = 5;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas context unavailable');
    this.ctx2d = ctx;
    this.buffer = document.createElement('canvas');
    this.buffer.width = LCD_WIDTH;
    this.buffer.height = LCD_HEIGHT;
    const bctx = this.buffer.getContext('2d');
    if (!bctx) throw new Error('2D canvas context unavailable');
    this.bufferCtx = bctx;
    this.image = this.bufferCtx.createImageData(LCD_WIDTH, LCD_HEIGHT);
  }

  setContrast(value: number): void {
    this.contrast = Math.max(1, Math.min(10, value));
  }

  clear(): void {
    this.bits.fill(0);
  }

  px(x: number, y: number, on = true): void {
    if (x < 0 || y < 0 || x >= LCD_WIDTH || y >= LCD_HEIGHT) return;
    this.bits[y * LCD_WIDTH + x] = on ? 1 : 0;
  }

  get(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= LCD_WIDTH || y >= LCD_HEIGHT) return 0;
    return this.bits[y * LCD_WIDTH + x];
  }

  fillRect(x: number, y: number, w: number, h: number, on = true): void {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.px(x + i, y + j, on);
  }

  rect(x: number, y: number, w: number, h: number, on = true): void {
    for (let i = 0; i < w; i++) {
      this.px(x + i, y, on);
      this.px(x + i, y + h - 1, on);
    }
    for (let j = 0; j < h; j++) {
      this.px(x, y + j, on);
      this.px(x + w - 1, y + j, on);
    }
  }

  invertRect(x: number, y: number, w: number, h: number): void {
    for (let j = 0; j < h; j++)
      for (let i = 0; i < w; i++) {
        const px = x + i;
        const py = y + j;
        if (px < 0 || py < 0 || px >= LCD_WIDTH || py >= LCD_HEIGHT) continue;
        const idx = py * LCD_WIDTH + px;
        this.bits[idx] = this.bits[idx] ? 0 : 1;
      }
  }

  hLine(x: number, y: number, w: number, on = true): void {
    for (let i = 0; i < w; i++) this.px(x + i, y, on);
  }

  vLine(x: number, y: number, h: number, on = true): void {
    for (let j = 0; j < h; j++) this.px(x, y + j, on);
  }

  /** Dotted separator, as used between LCD sections. */
  dottedHLine(x: number, y: number, w: number): void {
    for (let i = 0; i < w; i += 2) this.px(x + i, y);
  }

  text(x: number, y: number, str: string, opts: TextOptions = {}): number {
    const scale = opts.scale ?? 1;
    const chars = glyphs(str);
    const width = chars.length * CHAR_ADVANCE * scale - scale;
    let left = x;
    if (opts.center) left = Math.round(x - width / 2);
    if (opts.right) left = x - width;
    if (opts.invert) {
      this.fillRect(left - 1, y - 1, width + 2, GLYPH_HEIGHT * scale + 2, true);
    }
    chars.forEach((ch, index) => {
      const cols = glyph(ch);
      for (let c = 0; c < GLYPH_WIDTH; c++) {
        const bitsCol = cols[c];
        for (let r = 0; r < GLYPH_HEIGHT; r++) {
          if (!(bitsCol & (1 << r))) continue;
          const px = left + (index * CHAR_ADVANCE + c) * scale;
          const py = y + r * scale;
          if (scale === 1) this.px(px, py, !opts.invert);
          else this.fillRect(px, py, scale, scale, !opts.invert);
        }
      }
    });
    return left + width;
  }

  measure(str: string, scale = 1): number {
    return scale === 1 ? textWidth(str) : glyphs(str).length * CHAR_ADVANCE * scale - scale;
  }

  /** Horizontal bar graph used by the mixer / level screens. */
  bar(x: number, y: number, w: number, h: number, value: number): void {
    this.rect(x, y, w, h);
    const inner = Math.max(0, Math.round((w - 2) * Math.max(0, Math.min(1, value))));
    this.fillRect(x + 1, y + 1, inner, h - 2);
  }

  /** Vertical fader-style meter. */
  meter(x: number, y: number, w: number, h: number, value: number): void {
    this.rect(x, y, w, h);
    const inner = Math.max(0, Math.round((h - 2) * Math.max(0, Math.min(1, value))));
    this.fillRect(x + 1, y + h - 1 - inner, w - 2, inner);
  }

  /** Loop-position ring used by the play screens. */
  ring(cx: number, cy: number, r: number, progress: number, filled: boolean): void {
    // Midpoint circle, then a radial hand to show the loop position.
    let x = r;
    let y = 0;
    let err = 0;
    while (x >= y) {
      const pts: [number, number][] = [
        [cx + x, cy + y],
        [cx + y, cy + x],
        [cx - y, cy + x],
        [cx - x, cy + y],
        [cx - x, cy - y],
        [cx - y, cy - x],
        [cx + y, cy - x],
        [cx + x, cy - y],
      ];
      for (const [px, py] of pts) this.px(px, py);
      y += 1;
      err += 1 + 2 * y;
      if (2 * (err - x) + 1 > 0) {
        x -= 1;
        err += 1 - 2 * x;
      }
    }
    if (filled) this.fillRect(cx - 1, cy - 1, 3, 3);
    if (progress >= 0) {
      const a = progress * Math.PI * 2 - Math.PI / 2;
      for (let i = 1; i < r; i++) {
        this.px(Math.round(cx + Math.cos(a) * i), Math.round(cy + Math.sin(a) * i));
      }
    }
  }

  /** Pushes the framebuffer to the visible canvas. */
  present(): void {
    const data = this.image.data;
    // Slight green tint, matching the RC-505mkII's backlight.
    const fg = [226, 244, 240];
    const bgLevel = 6 + (10 - this.contrast);
    for (let i = 0; i < this.bits.length; i++) {
      const on = this.bits[i] === 1;
      const o = i * 4;
      data[o] = on ? fg[0] : bgLevel;
      data[o + 1] = on ? fg[1] : bgLevel + 4;
      data[o + 2] = on ? fg[2] : bgLevel + 2;
      data[o + 3] = 255;
    }
    this.bufferCtx.putImageData(this.image, 0, 0);
    const w = this.canvas.width;
    const h = this.canvas.height;
    this.ctx2d.imageSmoothingEnabled = false;
    this.ctx2d.clearRect(0, 0, w, h);
    this.ctx2d.drawImage(this.buffer, 0, 0, LCD_WIDTH, LCD_HEIGHT, 0, 0, w, h);
  }
}
