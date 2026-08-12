/**
 * The "firmware": turns panel/keyboard events into engine commands and state
 * edits, drives the LCD and the panel LEDs, and handles memory load/write.
 */

import { Engine } from './audio/engine';
import { fxType, rateToSeconds } from './data/fx-list';
import { deletePhrase, readPhrase, savePhrase } from './state/persistence';
import { Store } from './state/store';
import { bindKeyboard } from './ui/keyboard';
import { Lcd } from './ui/lcd/lcd';
import { Panel, type LedColor } from './ui/panel';
import { buildLoopMenu, buildSystemMenu, nodeTitle, type MenuItem, type MenuNode, type Node } from './ui/params';
import { NAME_CHARS, renderLcd } from './ui/screens';
import { FX_SLOTS, NUM_TRACKS, type FxSlot, type TrackIndex, type TrackState, type TrackStatus } from './types';

const ACTIVE_STATES: TrackState[] = ['playing', 'recording', 'overdubbing', 'stopping', 'rec-standby', 'play-standby'];
const HOLD_CLEAR_MS = 2000;
const HOLD_EDIT_MS = 600;
const HOLD_TAP_MS = 900;

const wrap = (v: number, n: number) => ((v % n) + n) % n;
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

export class App {
  readonly store = new Store();
  readonly engine: Engine;
  readonly panel: Panel;
  readonly lcd: Lcd;

  private loopMenu: MenuNode;
  private systemMenu: MenuNode;
  private down = new Set<string>();
  private holdTimers = new Map<string, number>();
  private holdFired = new Set<string>();
  private editUsed = new Set<string>();
  private tapTimes: number[] = [];
  private lastStopClick = -1;
  private lastStopTime = 0;
  private previousTempo = 120;
  private seqStep = new Map<string, number>();
  private unbindKeys: (() => void) | null = null;

  constructor(container: HTMLElement) {
    this.engine = new Engine({
      onStatus: (status) => {
        this.store.status = status;
      },
      onTempoDetected: (tempo) => {
        this.store.memory.tempo = tempo;
        this.store.popup('TEMPO', tempo.toFixed(1));
      },
      onMessage: (text) => this.store.notify(text),
    });

    this.panel = new Panel(container, {
      press: (id) => this.press(id),
      release: (id) => this.release(id),
      knob: (id, delta, coarse) => this.knob(id, delta, coarse),
      knobPress: (id) => this.knobPress(id),
      fader: (track, value) => this.setFader(track, value),
    });
    this.lcd = new Lcd(this.panel.lcdCanvas);
    this.lcd.setContrast(this.store.system.setup.displayContrast);

    const host = {
      memory: () => this.store.memory,
      system: () => this.store.system,
      editTrack: () => this.store.ui.editTrack,
      setEditTrack: (i: number) => {
        this.store.ui.editTrack = i;
        this.store.ui.currentTrack = i;
      },
      fxSection: () => this.store.ui.editSection,
      setFxSection: (s: 'input' | 'track') => {
        this.store.ui.editSection = s;
      },
      fxSlot: () => this.store.ui.editSlot,
      setFxSlot: (s: FxSlot) => {
        this.store.ui.editSlot = s;
      },
      touchMemory: () => {
        this.store.ui.dirty = true;
        this.engine.applyMemory(this.store.memory);
      },
      touchTrack: (i: number) => {
        this.store.ui.dirty = true;
        this.engine.applyTrack(i, this.store.memory.tracks[i], this.store.memory.trackLevels[i]);
      },
      touchSystem: () => {
        this.engine.applySystem(this.store.system);
        this.lcd.setContrast(this.store.system.setup.displayContrast);
        this.store.persist();
      },
      touchFx: (section: 'input' | 'track') => {
        this.store.ui.dirty = true;
        this.engine.applyFxSection(section, section === 'input' ? this.store.memory.inputFx : this.store.memory.trackFx);
      },
      touchRhythm: () => {
        this.store.ui.dirty = true;
        this.engine.rhythm.update(this.store.memory.rhythm);
        void this.engine.rhythm.prepare();
      },
      notify: (text: string) => this.store.notify(text),
    };

    this.loopMenu = buildLoopMenu(host);
    this.systemMenu = buildSystemMenu(host);
  }

  async start(): Promise<void> {
    await this.engine.init(this.store.memory, this.store.system);
    await this.engine.resume();
    await this.loadPhrases(this.store.current);
    this.previousTempo = this.store.memory.tempo;
    for (let i = 0; i < NUM_TRACKS; i++) this.panel.setFader(i, this.store.trackLevel(i) / 100);
    this.panel.setKnob('inputFx', this.store.ui.inputFxKnob / 100);
    this.panel.setKnob('trackFx', this.store.ui.trackFxKnob / 100);
    this.panel.setKnob('output', this.store.system.output.main.level / 200);
    this.unbindKeys = bindKeyboard({
      press: (id) => this.press(id),
      release: (id) => this.release(id),
      action: (name, arg) => this.action(name, arg),
    });
    const frame = () => {
      this.render();
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  dispose(): void {
    this.unbindKeys?.();
    this.engine.dispose();
  }

  // =======================================================================
  // Buttons
  // =======================================================================

  private hold(id: string, ms: number, fn: () => void): void {
    this.holdTimers.set(
      id,
      window.setTimeout(() => {
        this.holdTimers.delete(id);
        this.holdFired.add(id);
        fn();
      }, ms),
    );
  }

  private cancelHold(id: string): boolean {
    const timer = this.holdTimers.get(id);
    if (timer !== undefined) window.clearTimeout(timer);
    this.holdTimers.delete(id);
    const fired = this.holdFired.has(id);
    this.holdFired.delete(id);
    return fired;
  }

  private press(id: string): void {
    this.down.add(id);
    void this.engine.resume();
    const time = performance.now() / 1000;
    const track = /^(play|stop|track|fx)(\d)$/.exec(id);
    if (track) {
      const i = Number(track[2]);
      switch (track[1]) {
        case 'play':
          this.trackPlay(i);
          break;
        case 'stop':
          if (this.store.system.setup.quickClear && this.lastStopClick === i && time - this.lastStopTime < 0.35) {
            this.clearAllTracks();
            this.lastStopClick = -1;
            break;
          }
          this.lastStopClick = i;
          this.lastStopTime = time;
          this.trackStop(i);
          this.hold(id, HOLD_CLEAR_MS, () => this.clearTrack(i));
          break;
        case 'track':
          this.trackSelect(i);
          break;
        case 'fx':
          this.trackFx(i);
          break;
      }
      return;
    }

    const fx = /^(input|track)Fx([A-D])$/.exec(id);
    if (fx) {
      this.fxSlotButton(fx[1] as 'input' | 'track', fx[2] as FxSlot, true);
      return;
    }

    switch (id) {
      case 'inputFxEdit':
      case 'trackFxEdit': {
        const section = id === 'inputFxEdit' ? 'input' : 'track';
        this.editUsed.delete(id);
        this.hold(id, HOLD_EDIT_MS, () => {
          this.store.ui.bankSelect[section] = !this.store.ui.bankSelect[section];
          this.store.notify(this.store.ui.bankSelect[section] ? 'FX BANK SELECT' : 'FX ON/OFF');
        });
        break;
      }
      case 'allStart':
        this.allStartStop();
        if (this.store.system.setup.allClear) this.hold(id, HOLD_CLEAR_MS, () => this.clearAllTracks());
        break;
      case 'undoRedo':
        this.store.ui.undoMode = !this.store.ui.undoMode;
        break;
      case 'menu':
        this.toggleRoot(this.systemMenu);
        break;
      case 'loop':
        this.toggleRoot(this.loopMenu);
        break;
      case 'exit':
        if (this.down.has('enter')) this.openWrite();
        else this.exit();
        break;
      case 'enter':
        if (this.down.has('exit')) this.openWrite();
        else this.enter();
        break;
      case 'left':
        this.nav(-1);
        break;
      case 'right':
        this.nav(1);
        break;
      case 'tap':
        this.tapTempo();
        this.hold(id, HOLD_TAP_MS, () => {
          const t = this.previousTempo;
          this.tapTimes.length = 0;
          this.setTempo(t);
          this.store.notify(`TEMPO ${t.toFixed(1)}`);
        });
        break;
      case 'rhythmStart':
        this.engine.toggleRhythm();
        break;
      case 'rhythmEdit':
        this.openPath('RHYTHM');
        break;
      default:
        break;
    }
  }

  private release(id: string): void {
    this.down.delete(id);
    const fired = this.cancelHold(id);
    const fx = /^(input|track)Fx([A-D])$/.exec(id);
    if (fx) {
      this.fxSlotButton(fx[1] as 'input' | 'track', fx[2] as FxSlot, false);
      return;
    }
    if (id === 'inputFxEdit' || id === 'trackFxEdit') {
      const section = id === 'inputFxEdit' ? 'input' : 'track';
      if (!fired && !this.editUsed.has(id)) {
        const sect = section === 'input' ? this.store.memory.inputFx : this.store.memory.trackFx;
        this.openFxEdit(section, sect.banks[sect.bank].fxTarget);
      }
      this.editUsed.delete(id);
    }
  }

  private action(name: string, arg = 0): void {
    const ui = this.store.ui;
    switch (name) {
      case 'clear':
        this.clearTrack(arg);
        break;
      case 'fader':
        this.setFader(ui.currentTrack, this.store.trackLevel(ui.currentTrack) + arg * 2);
        break;
      case 'undo':
        this.engine.command(ui.currentTrack, 'undo');
        break;
      case 'markSet':
        this.engine.command(ui.currentTrack, 'markSet');
        this.store.notify('MARK SET');
        break;
      case 'markBack':
        this.engine.command(ui.currentTrack, 'markBack');
        break;
      case 'markClear':
        this.engine.command(ui.currentTrack, 'markClear');
        this.store.notify('MARK CLEAR');
        break;
      case 'fill':
        this.engine.fillIn();
        break;
      case 'variation': {
        const order: ('A' | 'B' | 'C' | 'D')[] = ['A', 'B', 'C', 'D'];
        const next = order[(order.indexOf(this.store.memory.rhythm.variation) + 1) % 4];
        this.engine.setVariation(next);
        this.store.popup('VARIATION', next);
        break;
      }
      case 'inputFxBank':
      case 'trackFxBank': {
        const section = name === 'inputFxBank' ? 'input' : 'track';
        this.selectFxBank(section, FX_SLOTS[clamp(arg, 0, 3)]);
        break;
      }
      case 'inputFxKnob':
        this.knob('inputFx', arg, false);
        break;
      case 'trackFxKnob':
        this.knob('trackFx', arg, false);
        break;
      case 'output':
        this.knob('output', arg, false);
        break;
      case 'adjust':
        this.knob(`k${ui.knob + 1}`, arg, false);
        break;
      case 'adjustCoarse':
        this.knob(`k${ui.knob + 1}`, arg, true);
        break;
      case 'focus':
        ui.knob = wrap(ui.knob + arg, 4);
        break;
      case 'knobPress':
        this.knobPress(`k${ui.knob + 1}`);
        break;
      case 'memory':
        this.selectMemory(this.store.current + arg);
        break;
      case 'write':
        this.openWrite();
        break;
      case 'mic':
        void this.toggleMic();
        break;
      case 'help':
        ui.helpOpen = !ui.helpOpen;
        window.dispatchEvent(new CustomEvent('rc505:help', { detail: ui.helpOpen }));
        break;
      default:
        break;
    }
  }

  // =======================================================================
  // Track operations
  // =======================================================================

  private undoFunc(name: string, track: number): void {
    switch (name) {
      case 'UNDO/REDO':
        this.engine.command(track, 'undo');
        break;
      case 'MARK SET':
        this.engine.command(track, 'markSet');
        this.store.notify('MARK SET');
        break;
      case 'MARK CLEAR':
        this.engine.command(track, 'markClear');
        this.store.notify('MARK CLEAR');
        break;
      case 'MARK BACK':
        this.engine.command(track, 'markBack');
        break;
      case 'ALL START':
        this.engine.allStart();
        break;
      case 'ALL STOP':
        this.engine.allStop();
        break;
      default:
        break;
    }
  }

  private trackPlay(i: number): void {
    if (this.store.ui.undoMode) {
      this.undoFunc(this.store.system.ctlFunc.panelUndo.recButton, i);
      return;
    }
    this.store.ui.currentTrack = i;
    this.engine.command(i, 'rec');
  }

  private trackStop(i: number): void {
    if (this.store.ui.undoMode) {
      this.undoFunc(this.store.system.ctlFunc.panelUndo.stopButton, i);
      return;
    }
    this.engine.command(i, 'stop');
  }

  private trackSelect(i: number): void {
    if (this.store.ui.undoMode) {
      this.undoFunc(this.store.system.ctlFunc.panelUndo.trackButton, i);
      return;
    }
    const mode = this.store.system.ctlFunc.panelPlay.trackButton;
    switch (mode) {
      case 'PLAY/STOP': {
        const st = this.store.status?.tracks[i];
        if (st && ACTIVE_STATES.includes(st.state)) this.engine.command(i, 'stop');
        else this.engine.command(i, 'play');
        break;
      }
      case 'REC/PLAY':
        this.engine.command(i, 'rec');
        break;
      case 'CLEAR':
        this.clearTrack(i);
        break;
      case 'OFF':
        break;
      default:
        this.store.ui.currentTrack = i;
        this.store.ui.editTrack = i;
        this.store.memory.play.currentTrack = i as TrackIndex;
        this.openPath(`TRACK ${i + 1}`);
        break;
    }
  }

  private trackFx(i: number): void {
    if (this.store.ui.undoMode) {
      this.undoFunc(this.store.system.ctlFunc.panelUndo.fxButton, i);
      return;
    }
    if (this.store.system.ctlFunc.panelPlay.fxButton === 'FX BANK') {
      const sect = this.store.memory.trackFx;
      sect.bank = FX_SLOTS[wrap(FX_SLOTS.indexOf(sect.bank) + 1, 4)];
      this.engine.applyFxSection('track', sect);
      return;
    }
    const t = this.store.memory.tracks[i];
    t.fx = !t.fx;
    this.store.ui.dirty = true;
    this.engine.applyTrack(i, t, this.store.trackLevel(i));
    this.store.popup(`TRACK ${i + 1} FX`, t.fx ? 'ON' : 'OFF');
  }

  private clearAllTracks(): void {
    this.engine.allStop();
    for (let i = 0; i < NUM_TRACKS; i++) this.engine.clearTrack(i);
    this.store.notify('ALL TRACKS\nCLEAR');
  }

  private clearTrack(i: number): void {
    this.engine.clearTrack(i);
    this.store.notify(`TRACK ${i + 1}\nCLEAR`);
  }

  private allStartStop(): void {
    const st = this.store.status;
    const active = st?.tracks.some((t) => ACTIVE_STATES.includes(t.state));
    if (active) this.engine.allStop();
    else this.engine.allStart();
  }

  private setFader(track: number, value: number): void {
    this.store.setTrackLevel(track, value);
    const v = this.store.trackLevel(track);
    this.engine.setTrackFader(track, v);
    this.panel.setFader(track, v / 100);
  }

  // =======================================================================
  // FX
  // =======================================================================

  private selectFxBank(section: 'input' | 'track', bank: FxSlot): void {
    const sect = section === 'input' ? this.store.memory.inputFx : this.store.memory.trackFx;
    sect.bank = bank;
    this.store.ui.dirty = true;
    this.engine.applyFxSection(section, sect);
    this.store.popup(section === 'input' ? 'IN FX BANK' : 'TR FX BANK', bank);
  }

  private fxSlotButton(section: 'input' | 'track', slot: FxSlot, down: boolean): void {
    const sect = section === 'input' ? this.store.memory.inputFx : this.store.memory.trackFx;
    const editId = section === 'input' ? 'inputFxEdit' : 'trackFxEdit';
    if (down && this.store.ui.bankSelect[section]) {
      this.selectFxBank(section, slot);
      return;
    }
    if (down && this.down.has(editId)) {
      this.editUsed.add(editId);
      this.openFxEdit(section, slot);
      return;
    }
    const bank = sect.banks[sect.bank];
    const s = bank.slots[slot];
    if (s.swMode === 'MOMENT') {
      if (down) bank.fxTarget = slot;
      s.sw = down;
    } else {
      if (!down) return;
      bank.fxTarget = slot;
      s.sw = !s.sw;
    }
    this.store.ui.dirty = true;
    this.engine.applyFxSection(section, sect);
    if (down) this.store.popup(fxType(s.type).name, s.sw ? 'ON' : 'OFF');
  }

  private openFxEdit(section: 'input' | 'track', slot: FxSlot): void {
    const sect = section === 'input' ? this.store.memory.inputFx : this.store.memory.trackFx;
    sect.banks[sect.bank].fxTarget = slot;
    this.store.ui.editSection = section;
    this.store.ui.editSlot = slot;
    this.engine.applyFxSection(section, sect);
    this.openPath(section === 'input' ? 'INPUT FX' : 'TRACK FX', `FX ${slot}`);
  }

  /** Advances FX SEQUENCE steps for the active slots. */
  private tickSequences(): void {
    const now = this.engine.ctx.currentTime;
    const info = this.engine.info;
    for (const section of ['input', 'track'] as const) {
      const sect = section === 'input' ? this.store.memory.inputFx : this.store.memory.trackFx;
      const bank = sect.banks[sect.bank];
      for (const id of FX_SLOTS) {
        const slot = bank.slots[id];
        const seq = slot.sequence;
        const key = `${section}${sect.bank}${id}`;
        if (!seq.sw || !seq.target || !slot.sw || !bank.sw) {
          this.seqStep.delete(key);
          continue;
        }
        const stepSeconds = Math.max(0.02, rateToSeconds(seq.rate, info.tempo, info.beatsPerMeasure));
        const step = Math.floor(now / stepSeconds) % Math.max(1, seq.max);
        if (this.seqStep.get(key) === step) continue;
        this.seqStep.set(key, step);
        const param = fxType(slot.type).params.find((p) => p.id === seq.target);
        if (!param) continue;
        const level = clamp(seq.values[step] ?? 1, 1, 16);
        const t = (level - 1) / 15;
        let value: number | string;
        if (param.kind === 'num') {
          const min = param.min ?? 0;
          const max = param.max ?? 100;
          value = Math.round(min + (max - min) * t);
        } else {
          const values = param.values ?? ['OFF', 'ON'];
          value = values[Math.round(t * (values.length - 1))];
        }
        this.engine.setFxParam(section, id, seq.target, value);
      }
    }
  }

  // =======================================================================
  // Navigation
  // =======================================================================

  private toggleRoot(node: MenuNode): void {
    const root = this.store.ui.stack[0];
    if (root && root.node === node) this.store.home();
    else this.store.open(node);
  }

  private openPath(...labels: string[]): void {
    this.store.open(this.loopMenu);
    let node: Node = this.loopMenu;
    for (const label of labels) {
      if (node.kind !== 'menu') break;
      const items: MenuItem[] = node.items();
      const index = items.findIndex((i: MenuItem) => i.label === label);
      if (index < 0) break;
      const item = items[index];
      const entry = this.store.top;
      if (entry) entry.cursor = index;
      item.onEnter?.();
      node = item.node;
      this.store.push(node);
    }
  }

  private exit(): void {
    if (!this.store.top) return;
    this.store.pop();
  }

  private enter(): void {
    const entry = this.store.top;
    if (!entry) {
      this.store.push({ kind: 'special', title: 'MIXER', id: 'mixer' });
      return;
    }
    if (entry.node.kind === 'menu') {
      const item = entry.node.items()[entry.cursor];
      if (item) {
        item.onEnter?.();
        this.store.push(item.node);
      }
      return;
    }
    if (entry.node.kind === 'special') {
      switch (entry.node.id) {
        case 'write':
          void this.executeWrite();
          break;
        case 'name':
          this.store.pop();
          this.store.notify('NAME OK');
          break;
        case 'reset':
          this.store.factoryReset();
          this.engine.applyMemory(this.store.memory);
          this.engine.applySystem(this.store.system);
          for (let i = 0; i < NUM_TRACKS; i++) this.engine.clearTrack(i);
          this.store.home();
          this.store.notify('FACTORY RESET\nCOMPLETE');
          break;
        default:
          break;
      }
    }
  }

  private nav(dir: number): void {
    const entry = this.store.top;
    const ui = this.store.ui;
    if (!entry) {
      ui.playVariation = wrap(ui.playVariation - 1 + dir, 7) + 1;
      return;
    }
    switch (entry.node.kind) {
      case 'menu':
        entry.cursor = clamp(entry.cursor + dir, 0, entry.node.items().length - 1);
        break;
      case 'params': {
        const pages = entry.node.pages().length;
        entry.page = clamp(entry.page + dir, 0, pages - 1);
        ui.knob = 0;
        break;
      }
      case 'special':
        if (entry.node.id === 'mixer') ui.mixerPage = clamp(ui.mixerPage + dir, 0, 2);
        else if (entry.node.id === 'name') ui.nameCursor = clamp(ui.nameCursor + dir, 0, 11);
        else if (entry.node.id === 'write') ui.writeTarget = wrap(ui.writeTarget + dir, this.store.memories.length);
        break;
    }
  }

  private openWrite(): void {
    this.store.ui.writeTarget = this.store.current;
    this.store.ui.writeMode = 'WRITE';
    this.store.open({ kind: 'special', title: 'WRITE', id: 'write' });
  }

  // =======================================================================
  // Knobs
  // =======================================================================

  private knob(id: string, delta: number, coarse: boolean): void {
    const ui = this.store.ui;
    if (this.store.system.setup.knobLock && id !== 'output' && !id.startsWith('k')) {
      this.store.notify('KNOB LOCK ON');
      return;
    }
    if (id === 'inputFx' || id === 'trackFx') {
      const section = id === 'inputFx' ? 'input' : 'track';
      const key = section === 'input' ? 'inputFxKnob' : 'trackFxKnob';
      ui[key] = clamp(ui[key] + delta * (coarse ? 10 : 2), 0, 100);
      this.panel.setKnob(id, ui[key] / 100);
      this.engine.setFxKnob(section, ui[key]);
      const label = this.engine.fxKnobLabel(section);
      if (label) this.store.popup(`${label.label}`, label.value);
      this.store.ui.dirty = true;
      return;
    }
    if (id === 'output') {
      const out = this.store.system.output.main;
      out.level = clamp(out.level + delta * (coarse ? 10 : 2), 0, 200);
      this.panel.setKnob('output', out.level / 200);
      this.engine.applySystem(this.store.system);
      this.store.persist();
      this.store.popup('OUTPUT LVL', String(out.level));
      return;
    }
    const match = /^k(\d)$/.exec(id);
    if (!match) return;
    const index = Number(match[1]) - 1;
    this.panel.spinKnob(id, delta);
    ui.knob = index;
    const entry = this.store.top;
    if (!entry) {
      this.playKnob(index, delta, coarse);
      return;
    }
    switch (entry.node.kind) {
      case 'menu':
        entry.cursor = clamp(entry.cursor + delta, 0, entry.node.items().length - 1);
        break;
      case 'params': {
        const pages = entry.node.pages();
        const page = pages[clamp(entry.page, 0, pages.length - 1)];
        const param = page?.params[index];
        if (param) {
          param.adjust(delta, coarse);
          this.store.popup(param.label, param.value());
        }
        break;
      }
      case 'special':
        this.specialKnob(entry.node.id, index, delta, coarse);
        break;
    }
  }

  private playKnob(index: number, delta: number, coarse: boolean): void {
    switch (index) {
      case 0:
        this.selectMemory(this.store.current + delta);
        break;
      case 1:
        this.setTempo(this.store.memory.tempo + delta * (coarse ? 10 : 1));
        this.store.popup('TEMPO', this.store.memory.tempo.toFixed(1));
        break;
      case 2: {
        const r = this.store.memory.rhythm;
        r.level = clamp(r.level + delta * (coarse ? 10 : 2), 0, 100);
        this.engine.rhythm.setLevel(r.level);
        this.store.ui.dirty = true;
        this.store.popup('RHYTHM LVL', String(r.level));
        break;
      }
      case 3: {
        const order: ('A' | 'B' | 'C' | 'D')[] = ['A', 'B', 'C', 'D'];
        const next = order[clamp(order.indexOf(this.store.memory.rhythm.variation) + delta, 0, 3)];
        this.engine.setVariation(next);
        this.store.ui.dirty = true;
        this.store.popup('VARIATION', next);
        break;
      }
    }
  }

  private specialKnob(id: string, index: number, delta: number, coarse: boolean): void {
    const ui = this.store.ui;
    if (id === 'mixer') {
      const step = delta * (coarse ? 10 : 2);
      const ch = this.store.system.input.channels;
      const link = this.store.system.input.stereoLink.mic;
      const inputs = link ? [ch.mic1, ch.inst1, ch.inst2, ch.usb] : [ch.mic1, ch.mic2, ch.inst1, ch.inst2];
      const out = this.store.system.output;
      if (ui.mixerPage === 0) {
        const target = inputs[index];
        if (target) target.level = clamp(target.level + step, 0, 200);
      } else if (ui.mixerPage === 1) {
        const targets = [out.main, out.sub1, out.sub2];
        if (index < 3) targets[index].level = clamp(targets[index].level + step, 0, 200);
        else this.store.system.usb.outputLevel = clamp(this.store.system.usb.outputLevel + step, 0, 200);
        this.panel.setKnob('output', out.main.level / 200);
      } else {
        const keys = ['loopLevel', 'rhythmLevel', 'masterLevel'] as const;
        const key = keys[index];
        if (key) out[key] = clamp(out[key] + step, 0, 200);
      }
      this.engine.applySystem(this.store.system);
      this.store.persist();
      return;
    }
    if (id === 'name') {
      const name = this.store.memory.name.padEnd(12, ' ').slice(0, 12).split('');
      if (index === 0) {
        const chars = NAME_CHARS;
        const cur = chars.indexOf(name[ui.nameCursor]);
        const next = clamp((cur < 0 ? 0 : cur) + delta * (coarse ? 5 : 1), 0, chars.length - 1);
        name[ui.nameCursor] = chars[next];
        this.store.memory.name = name.join('').replace(/\s+$/, '');
        this.store.ui.dirty = true;
      } else if (index === 1) {
        ui.nameCursor = clamp(ui.nameCursor + delta, 0, 11);
      }
      return;
    }
    if (id === 'write') {
      if (index === 0) ui.writeTarget = wrap(ui.writeTarget + delta, this.store.memories.length);
      else if (index === 1) ui.writeMode = delta > 0 ? 'CLEAR' : 'WRITE';
    }
  }

  private knobPress(id: string): void {
    const entry = this.store.top;
    const match = /^k(\d)$/.exec(id);
    if (!match) {
      if (id === 'inputFx' || id === 'trackFx') {
        const section = id === 'inputFx' ? 'input' : 'track';
        const sect = section === 'input' ? this.store.memory.inputFx : this.store.memory.trackFx;
        this.openFxEdit(section, sect.banks[sect.bank].fxTarget);
      }
      return;
    }
    const index = Number(match[1]) - 1;
    this.store.ui.knob = index;
    if (!entry) {
      if (index === 3) this.action('variation');
      return;
    }
    if (entry.node.kind === 'params') {
      const pages = entry.node.pages();
      const param = pages[clamp(entry.page, 0, pages.length - 1)]?.params[index];
      if (param?.press) {
        param.press();
        this.store.popup(param.label, param.value());
      }
      return;
    }
    if (entry.node.kind === 'menu') {
      this.enter();
      return;
    }
    if (entry.node.kind === 'special' && entry.node.id === 'mixer' && this.store.ui.mixerPage === 0) {
      const ch = this.store.system.input.channels;
      const link = this.store.system.input.stereoLink.mic;
      const inputs = link ? [ch.mic1, ch.inst1, ch.inst2, ch.usb] : [ch.mic1, ch.mic2, ch.inst1, ch.inst2];
      const target = inputs[index];
      if (target) {
        target.mute = !target.mute;
        this.engine.applySystem(this.store.system);
        this.store.persist();
      }
    }
  }

  // =======================================================================
  // Tempo / memory
  // =======================================================================

  private setTempo(tempo: number): void {
    const t = clamp(Math.round(tempo * 10) / 10, 40, 300);
    this.store.memory.tempo = t;
    this.store.ui.dirty = true;
    this.engine.setTempo(t);
  }

  private tapTempo(): void {
    const now = performance.now();
    if (this.tapTimes.length && now - this.tapTimes[this.tapTimes.length - 1] > 2500) this.tapTimes.length = 0;
    this.tapTimes.push(now);
    if (this.tapTimes.length > 5) this.tapTimes.shift();
    if (this.tapTimes.length < 2) {
      this.store.popup('TAP TEMPO', '...');
      return;
    }
    const spans: number[] = [];
    for (let i = 1; i < this.tapTimes.length; i++) spans.push(this.tapTimes[i] - this.tapTimes[i - 1]);
    const avg = spans.reduce((a, b) => a + b, 0) / spans.length;
    this.previousTempo = this.store.memory.tempo;
    this.setTempo(60000 / avg);
    this.store.popup('TEMPO', this.store.memory.tempo.toFixed(1));
  }

  private selectMemory(index: number): void {
    const target = wrap(index, this.store.memories.length);
    if (target === this.store.current) return;
    this.engine.allStop();
    for (let i = 0; i < NUM_TRACKS; i++) this.engine.clearTrack(i);
    this.store.selectMemory(target);
    this.engine.applyMemory(this.store.memory);
    for (let i = 0; i < NUM_TRACKS; i++) this.panel.setFader(i, this.store.trackLevel(i) / 100);
    void this.loadPhrases(target);
    this.store.popup('MEMORY', `${String(target + 1).padStart(2, '0')} ${this.store.memory.name}`);
  }

  private async loadPhrases(memory: number): Promise<void> {
    for (let i = 0; i < NUM_TRACKS; i++) {
      const rec = await readPhrase(memory, i);
      if (!rec) continue;
      this.engine.loadPhrase(i, rec.left, rec.right, rec.length, rec.tempo, rec.measures);
    }
  }

  private async executeWrite(): Promise<void> {
    const target = this.store.ui.writeTarget;
    if (this.store.ui.writeMode === 'CLEAR') {
      this.store.clearMemory(target);
      for (let i = 0; i < NUM_TRACKS; i++) await deletePhrase(target, i);
      if (target === this.store.current) {
        for (let i = 0; i < NUM_TRACKS; i++) this.engine.clearTrack(i);
        this.engine.applyMemory(this.store.memory);
      }
      this.store.home();
      this.store.notify(`CLEAR ${String(target + 1).padStart(2, '0')}\nCOMPLETE`);
      return;
    }
    this.store.writeMemory(target);
    for (let i = 0; i < NUM_TRACKS; i++) {
      const phrase = await this.engine.exportPhrase(i);
      if (phrase.length > 0 && phrase.left && phrase.right) {
        await savePhrase(target, i, {
          left: phrase.left,
          right: phrase.right,
          length: phrase.length,
          tempo: phrase.tempo ?? this.store.memory.tempo,
          measures: phrase.measures ?? 0,
        });
      } else {
        await deletePhrase(target, i);
      }
    }
    this.store.home();
    this.store.notify(`WRITE ${String(target + 1).padStart(2, '0')}\nCOMPLETE`);
  }

  private async toggleMic(): Promise<void> {
    if (this.store.ui.micOn) {
      this.engine.disableMic();
      this.store.ui.micOn = false;
      this.store.notify('MIC OFF');
      return;
    }
    const ok = await this.engine.enableMic();
    this.store.ui.micOn = ok;
    if (ok) this.store.notify('MIC ON');
  }

  // =======================================================================
  // Rendering
  // =======================================================================

  private render(): void {
    const time = performance.now() / 1000;
    this.tickSequences();
    renderLcd(this.lcd, { store: this.store, time });
    this.updateLeds(time);
  }

  private updateLeds(time: number): void {
    const { store, panel } = this;
    const dim = store.system.setup.ledDimmer / 10;
    const status = store.status;
    const blink = time % 0.5 < 0.25;
    const cfg = store.system.ctlFunc.panelUndo;

    const trackFxActive = (() => {
      const sect = store.memory.trackFx;
      const bank = sect.banks[sect.bank];
      return bank.sw && FX_SLOTS.some((id) => bank.slots[id].sw && (bank.mode === 'MULTI' || id === bank.fxTarget));
    })();

    for (let i = 0; i < NUM_TRACKS; i++) {
      const st = status?.tracks[i];
      let play: LedColor = 'off';
      if (store.ui.undoMode) {
        play = undoLed(cfg.recButton, st);
      } else if (st) {
        if (st.state === 'recording') play = 'red';
        else if (st.state === 'overdubbing') play = 'yellow';
        else if (st.state === 'playing' || st.state === 'stopping') play = 'green';
        else if (st.state === 'rec-standby') play = blink ? 'red' : 'off';
        else if (st.state === 'play-standby') play = blink ? 'green' : 'off';
      }
      panel.setLed(`play${i}`, play, dim);

      if (store.ui.undoMode) {
        panel.setLed(`track${i}`, undoLed(cfg.trackButton, st), dim);
        panel.setLed(`fx${i}`, undoLed(cfg.fxButton, st), dim);
        panel.setLed(`stop${i}`, undoLed(cfg.stopButton, st), dim);
      } else {
        panel.setLed(`track${i}`, st?.hasPhrase ? 'white' : 'off', i === store.ui.currentTrack ? dim : dim * 0.5);
        // Bright while the track's FX are actually sounding, dim when only assigned.
        const fxOn = store.memory.tracks[i].fx;
        panel.setLed(`fx${i}`, fxOn ? 'red' : 'off', fxOn && trackFxActive ? dim : dim * 0.28);
        panel.setLed(`stop${i}`, 'off', dim);
      }

      let ringColor: LedColor = 'off';
      if (st) {
        if (st.state === 'recording') ringColor = 'red';
        else if (st.state === 'overdubbing') ringColor = 'yellow';
        else if (st.state === 'playing' || st.state === 'stopping') ringColor = 'green';
        else if (st.hasPhrase) ringColor = 'white';
      }
      panel.setRing(i, {
        color: ringColor,
        progress: st?.hasPhrase ? st.position : -1,
        level: ringColor === 'white' ? 0.12 : Math.max(0.2, st?.level ?? 0),
        on: !!st && ACTIVE_STATES.includes(st.state),
      });
    }

    for (const section of ['input', 'track'] as const) {
      const sect = section === 'input' ? store.memory.inputFx : store.memory.trackFx;
      const bank = sect.banks[sect.bank];
      const prefix = section === 'input' ? 'inputFx' : 'trackFx';
      FX_SLOTS.forEach((id) => {
        let color: LedColor = 'off';
        if (store.ui.bankSelect[section]) color = id === sect.bank ? 'blue' : 'off';
        else if (bank.sw && bank.slots[id].sw && (bank.mode === 'MULTI' || id === bank.fxTarget))
          color = id === bank.fxTarget ? 'pink' : 'red';
        panel.setLed(`${prefix}${id}`, color, dim);
      });
      const sectionTitle = section === 'input' ? 'INPUT FX' : 'TRACK FX';
      const editing = store.ui.stack.some((e) => nodeTitle(e.node) === sectionTitle);
      panel.setLed(`${prefix}Edit`, store.ui.bankSelect[section] ? 'blue' : editing ? 'white' : 'off', dim);
    }

    const anyPlaying = status?.tracks.some((t) => ACTIVE_STATES.includes(t.state));
    panel.setLed('allStart', anyPlaying ? 'green' : 'off', dim);
    panel.setLed('undoRedo', store.ui.undoMode ? 'white' : 'off', dim);
    const root = store.ui.stack[0]?.node;
    panel.setLed('menu', root === this.systemMenu ? 'white' : 'off', dim);
    panel.setLed('loop', root === this.loopMenu ? 'white' : 'off', dim);
    // The rhythm and tap lamps flash on every beat, brightest on the downbeat.
    const running = status?.running ?? false;
    const rhythmOn = this.engine.rhythm.running;
    const flash = status ? Math.max(0, 1 - status.beatPhase * 2.6) : 0;
    const beatLevel = status ? (status.beatInMeasure === 0 ? 0.45 + 0.55 * flash : 0.25 + 0.4 * flash) : 0.35;
    panel.setLed('rhythmStart', rhythmOn ? 'orange' : 'off', rhythmOn ? dim * beatLevel : dim);
    panel.setLed('tap', running ? 'white' : 'off', running ? dim * beatLevel : 0);
  }
}

/**
 * LED colour of a track button while UNDO/REDO mode is latched: buttons that do
 * undo/redo show whether an undo (green) or redo (red) is available, the rest
 * light amber to show they carry a function.
 */
function undoLed(func: string, st: TrackStatus | undefined): LedColor {
  if (func === 'OFF') return 'off';
  if (func === 'UNDO/REDO') return st?.redoAvailable ? 'red' : st?.undoAvailable ? 'green' : 'off';
  if (func === 'MARK SET' || func === 'MARK BACK' || func === 'MARK CLEAR') return st?.hasPhrase ? 'orange' : 'off';
  return 'orange';
}
