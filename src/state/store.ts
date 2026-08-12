/**
 * Application state: the 99 stored memories, the working ("edit buffer")
 * memory, the system settings and everything the panel/LCD needs to draw.
 *
 * As on the hardware, edits change the working memory only — they are lost when
 * you select another memory unless you WRITE them first.
 */

import { defaultMemories, defaultMemory, defaultSystem } from './defaults';
import { loadState, saveState } from './persistence';
import { NUM_MEMORIES, NUM_TRACKS, type FxSlot, type Memory, type SystemSettings, type TransportStatus } from '../types';
import type { Node } from '../ui/params';

export interface NavEntry {
  node: Node;
  cursor: number;
  page: number;
}

export interface UiState {
  /** Navigation stack; empty means the play screen is showing. */
  stack: NavEntry[];
  playVariation: number; // 1..7
  /** Focused knob (0..3) within the current page. */
  knob: number;
  undoMode: boolean;
  /** EDIT held down → the [A]–[D] buttons switch FX banks. */
  bankSelect: { input: boolean; track: boolean };
  editSection: 'input' | 'track';
  editSlot: FxSlot;
  editTrack: number;
  currentTrack: number;
  message: { text: string; until: number } | null;
  /** Transient parameter popup shown while a knob is being turned. */
  popup: { label: string; value: string; until: number } | null;
  nameCursor: number;
  writeTarget: number;
  writeMode: 'WRITE' | 'CLEAR';
  mixerPage: number;
  micOn: boolean;
  helpOpen: boolean;
  dirty: boolean;
  outputLevel: number;
  inputFxKnob: number;
  trackFxKnob: number;
}

const clone = <T>(v: T): T => (typeof structuredClone === 'function' ? structuredClone(v) : (JSON.parse(JSON.stringify(v)) as T));

export class Store {
  memories: Memory[];
  system: SystemSettings;
  current: number;
  /** The working memory — what the engine plays and what the screens edit. */
  memory: Memory;
  status: TransportStatus | null = null;
  ui: UiState;

  constructor() {
    const saved = loadState();
    this.memories = saved?.memories ?? defaultMemories();
    // Guard against a truncated or older payload.
    while (this.memories.length < NUM_MEMORIES) this.memories.push(defaultMemory(this.memories.length));
    this.system = { ...defaultSystem(), ...(saved?.system ?? {}) };
    this.current = Math.min(NUM_MEMORIES - 1, Math.max(0, saved?.currentMemory ?? 0));
    this.memory = clone(this.memories[this.current]);
    this.ui = {
      stack: [],
      playVariation: this.system.setup.playScreen,
      knob: 0,
      undoMode: false,
      bankSelect: { input: false, track: false },
      editSection: 'input',
      editSlot: 'A',
      editTrack: 0,
      currentTrack: this.memory.play.currentTrack,
      message: null,
      popup: null,
      nameCursor: 0,
      writeTarget: this.current,
      writeMode: 'WRITE',
      mixerPage: 0,
      micOn: false,
      helpOpen: false,
      dirty: false,
      outputLevel: this.system.output.main.level,
      inputFxKnob: 50,
      trackFxKnob: 50,
    };
  }

  // -- navigation ----------------------------------------------------------

  get top(): NavEntry | null {
    return this.ui.stack.length ? this.ui.stack[this.ui.stack.length - 1] : null;
  }

  push(node: Node): void {
    this.ui.stack.push({ node, cursor: 0, page: 0 });
    this.ui.knob = 0;
  }

  pop(): void {
    this.ui.stack.pop();
    this.ui.knob = 0;
  }

  home(): void {
    this.ui.stack.length = 0;
  }

  /** Replaces the stack with a single node (used by the MENU / LOOP buttons). */
  open(node: Node): void {
    this.ui.stack.length = 0;
    this.push(node);
  }

  // -- messages ------------------------------------------------------------

  notify(text: string, seconds = 1.4): void {
    this.ui.message = { text, until: performance.now() / 1000 + seconds };
  }

  popup(label: string, value: string, seconds = 1.1): void {
    this.ui.popup = { label, value, until: performance.now() / 1000 + seconds };
  }

  // -- memories ------------------------------------------------------------

  selectMemory(index: number): void {
    this.current = ((index % NUM_MEMORIES) + NUM_MEMORIES) % NUM_MEMORIES;
    this.memory = clone(this.memories[this.current]);
    this.ui.dirty = false;
    this.ui.currentTrack = this.memory.play.currentTrack;
    this.persist();
  }

  writeMemory(index: number): void {
    this.memories[index] = clone(this.memory);
    this.current = index;
    this.ui.dirty = false;
    this.persist();
  }

  clearMemory(index: number): void {
    this.memories[index] = defaultMemory(index);
    if (index === this.current) {
      this.memory = clone(this.memories[index]);
      this.ui.dirty = false;
    }
    this.persist();
  }

  factoryReset(): void {
    this.memories = defaultMemories();
    this.system = defaultSystem();
    this.current = 0;
    this.memory = clone(this.memories[0]);
    this.ui.dirty = false;
    this.persist();
  }

  persist(): void {
    saveState({ memories: this.memories, system: this.system, currentMemory: this.current });
  }

  // -- helpers -------------------------------------------------------------

  trackLevel(i: number): number {
    return this.memory.trackLevels[i] ?? 100;
  }

  setTrackLevel(i: number, v: number): void {
    this.memory.trackLevels[i] = Math.min(100, Math.max(0, Math.round(v)));
    this.ui.dirty = true;
  }

  get anyTrackHasPhrase(): boolean {
    if (!this.status) return false;
    for (let i = 0; i < NUM_TRACKS; i++) if (this.status.tracks[i]?.hasPhrase) return true;
    return false;
  }
}
