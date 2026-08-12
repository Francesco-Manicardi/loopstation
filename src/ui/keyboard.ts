/**
 * Keyboard control. Every panel control is reachable from the keyboard; keys are
 * matched on `KeyboardEvent.code` so the layout works on non-US keyboards too.
 *
 * A binding either maps to a panel button id (press/release, so MOMENT-mode FX
 * and long-presses behave exactly like the mouse) or to a named action.
 */

export interface KeyHandlers {
  press(id: string): void;
  release(id: string): void;
  action(name: string, arg?: number): void;
}

interface Binding {
  /** Panel button id. */
  button?: string;
  /** Action name + argument. */
  action?: string;
  arg?: number;
  /** true → requires Shift, false → requires no Shift, undefined → either. */
  shift?: boolean;
  ctrl?: boolean;
  repeat?: boolean;
  help?: string;
  keys: string;
}

const TRACK_DIGITS = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5'];
const TRACK_SELECT = ['KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT'];
const TRACK_FXKEYS = ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG'];
const FX_SLOT_KEYS = ['Digit6', 'Digit7', 'Digit8', 'Digit9'];
const TRACK_FX_SLOT_KEYS = ['F1', 'F2', 'F3', 'F4'];

const BINDINGS: Record<string, Binding[]> = {};

function bind(code: string, b: Binding): void {
  (BINDINGS[code] ??= []).push(b);
}

// --- track strips ----------------------------------------------------------
TRACK_DIGITS.forEach((code, i) => {
  bind(code, { button: `play${i}`, shift: false, ctrl: false, keys: '1 – 5', help: 'Track [J/t] — rec / play / dub' });
  bind(code, { button: `stop${i}`, shift: true, ctrl: false, keys: 'Shift+1 – 5', help: 'Track [q] — stop (hold to clear)' });
  bind(code, { action: 'clear', arg: i, ctrl: true, keys: 'Ctrl+1 – 5', help: 'Clear track' });
});
TRACK_SELECT.forEach((code, i) => {
  bind(code, { button: `track${i}`, keys: 'Q W E R T', help: 'Track [TRACK] — select / settings' });
});
TRACK_FXKEYS.forEach((code, i) => {
  bind(code, { button: `fx${i}`, keys: 'A S D F G', help: 'Track [FX] — FX on/off for the track' });
});
bind('PageUp', { action: 'fader', arg: 1, repeat: true, keys: 'PgUp / PgDn', help: 'Current track slider' });
bind('PageDown', { action: 'fader', arg: -1, repeat: true, keys: '', help: '' });

// --- transport -------------------------------------------------------------
bind('Space', { button: 'allStart', keys: 'Space', help: '[ALL START/STOP]' });
bind('KeyU', { button: 'undoRedo', keys: 'U', help: '[UNDO/REDO]' });
bind('KeyZ', { action: 'undo', keys: 'Z', help: 'Undo / redo the current track' });
bind('KeyB', { action: 'markSet', keys: 'B', help: 'MARK SET (current track)' });
bind('KeyN', { action: 'markBack', keys: 'N', help: 'MARK BACK (current track)' });
bind('KeyV', { action: 'markClear', keys: 'V', help: 'MARK CLEAR (current track)' });

// --- rhythm ----------------------------------------------------------------
bind('KeyH', { button: 'rhythmStart', keys: 'H', help: 'RHYTHM [START/STOP]' });
bind('KeyJ', { button: 'rhythmEdit', keys: 'J', help: 'RHYTHM [EDIT]' });
bind('KeyY', { button: 'tap', keys: 'Y', help: '[TAP TEMPO] (hold: previous tempo)' });
bind('KeyX', { action: 'fill', keys: 'X', help: 'Rhythm fill-in' });
bind('KeyC', { action: 'variation', keys: 'C', help: 'Next rhythm variation' });

// --- FX --------------------------------------------------------------------
FX_SLOT_KEYS.forEach((code, i) => {
  bind(code, { button: `inputFx${'ABCD'[i]}`, shift: false, keys: '6 7 8 9', help: 'INPUT FX [A]–[D]' });
  bind(code, { action: 'inputFxBank', arg: i, shift: true, keys: 'Shift+6 – 9', help: 'INPUT FX bank A–D' });
});
TRACK_FX_SLOT_KEYS.forEach((code, i) => {
  bind(code, { button: `trackFx${'ABCD'[i]}`, shift: false, keys: 'F1 – F4', help: 'TRACK FX [A]–[D]' });
  bind(code, { action: 'trackFxBank', arg: i, shift: true, keys: 'Shift+F1 – F4', help: 'TRACK FX bank A–D' });
});
bind('KeyI', { button: 'inputFxEdit', keys: 'I', help: 'INPUT FX [EDIT] (hold: bank select)' });
bind('KeyO', { button: 'trackFxEdit', keys: 'O', help: 'TRACK FX [EDIT] (hold: bank select)' });
bind('Minus', { action: 'inputFxKnob', arg: -1, repeat: true, keys: '- / =', help: '[INPUT FX] knob' });
bind('Equal', { action: 'inputFxKnob', arg: 1, repeat: true, keys: '', help: '' });
bind('BracketLeft', { action: 'trackFxKnob', arg: -1, repeat: true, keys: '[ / ]', help: '[TRACK FX] knob' });
bind('BracketRight', { action: 'trackFxKnob', arg: 1, repeat: true, keys: '', help: '' });

// --- screens ---------------------------------------------------------------
bind('KeyM', { button: 'menu', shift: false, keys: 'M', help: '[MENU]' });
bind('KeyM', { action: 'mic', shift: true, keys: 'Shift+M', help: 'Enable / disable the microphone input' });
bind('KeyL', { button: 'loop', keys: 'L', help: '[LOOP]' });
bind('Enter', { button: 'enter', ctrl: false, keys: 'Enter', help: '[ENTER] (play screen → MIXER)' });
bind('Escape', { button: 'exit', keys: 'Esc / Backspace', help: '[EXIT]' });
bind('Backspace', { button: 'exit', keys: '', help: '' });
bind('ArrowLeft', { button: 'left', shift: false, repeat: true, keys: '← / →', help: '[K] [J] — page / cursor / play screen' });
bind('ArrowRight', { button: 'right', shift: false, repeat: true, keys: '', help: '' });
bind('ArrowLeft', { action: 'memory', arg: -1, shift: true, keys: 'Shift+← / →', help: 'Previous / next memory' });
bind('ArrowRight', { action: 'memory', arg: 1, shift: true, keys: '', help: '' });
bind('ArrowUp', { action: 'adjust', arg: 1, repeat: true, keys: '↑ / ↓', help: 'Turn the focused [1]–[4] knob (Shift: coarse)' });
bind('ArrowDown', { action: 'adjust', arg: -1, repeat: true, keys: '', help: '' });
bind('Tab', { action: 'focus', arg: 1, shift: false, keys: 'Tab', help: 'Focus the next [1]–[4] knob' });
bind('Tab', { action: 'focus', arg: -1, shift: true, keys: 'Shift+Tab', help: 'Focus the previous knob' });
bind('KeyP', { action: 'knobPress', keys: 'P', help: 'Push the focused knob (toggles ON/OFF values)' });
bind('KeyS', { action: 'write', ctrl: true, keys: 'Ctrl+S', help: 'WRITE / CLEAR memory ([EXIT]+[ENTER])' });
bind('Comma', { action: 'output', arg: -1, repeat: true, keys: ', / .', help: '[OUTPUT LEVEL] knob' });
bind('Period', { action: 'output', arg: 1, repeat: true, keys: '', help: '' });
bind('Slash', { action: 'help', keys: '/', help: 'Show / hide this shortcut list' });

export interface HelpRow {
  keys: string;
  desc: string;
}

export const KEY_HELP: HelpRow[] = Object.values(BINDINGS)
  .flat()
  .filter((b) => b.keys && b.help)
  .map((b) => ({ keys: b.keys, desc: b.help as string }))
  .filter((row, i, all) => all.findIndex((r) => r.keys === row.keys) === i);

function matches(b: Binding, e: KeyboardEvent): boolean {
  if (b.shift !== undefined && b.shift !== e.shiftKey) return false;
  if (b.ctrl !== undefined && b.ctrl !== (e.ctrlKey || e.metaKey)) return false;
  if (b.ctrl === undefined && (e.ctrlKey || e.metaKey)) return false;
  return true;
}

export function bindKeyboard(handlers: KeyHandlers): () => void {
  const down = new Map<string, string>(); // code → button id currently held

  const onKeyDown = (e: KeyboardEvent) => {
    const list = BINDINGS[e.code];
    if (!list) return;
    const b = list.find((x) => matches(x, e));
    if (!b) return;
    e.preventDefault();
    if (e.repeat && !b.repeat) return;
    if (b.button) {
      if (down.has(e.code)) return;
      down.set(e.code, b.button);
      handlers.press(b.button);
    } else if (b.action) {
      handlers.action(b.action, b.arg);
    }
  };

  const onKeyUp = (e: KeyboardEvent) => {
    const id = down.get(e.code);
    if (id) {
      down.delete(e.code);
      handlers.release(id);
    }
  };

  const onBlur = () => {
    for (const [code, id] of down) {
      down.delete(code);
      handlers.release(id);
    }
  };

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  return () => {
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('blur', onBlur);
  };
}
