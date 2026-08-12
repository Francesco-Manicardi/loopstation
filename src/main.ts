/**
 * Bootstrap: builds the shell (power-on gate + help sheet), then starts the
 * emulator once the user has made the gesture the Web Audio API requires.
 */

import './styles/reset.css';
import './styles/panel.css';
import './styles/overlay.css';

import { App } from './app';
import { KEY_HELP } from './ui/keyboard';

const root = document.getElementById('app');
if (!root) throw new Error('#app missing');

const stage = document.createElement('div');
stage.className = 'stage';
root.appendChild(stage);

// --- keyboard help sheet ----------------------------------------------------
const help = document.createElement('div');
help.className = 'overlay';
help.hidden = true;
help.innerHTML = `
  <div class="card">
    <h1>KEYBOARD SHORTCUTS</h1>
    <p class="sub">Every control on the panel also responds to the mouse: click buttons, drag or scroll the knobs and sliders.</p>
    <h2>Keys</h2>
    <div class="keys">${KEY_HELP.map(
      (r) => `<div><span>${escape(r.keys)}</span><span>${escape(r.desc)}</span></div>`,
    ).join('')}</div>
    <div class="actions"><button class="ghost" data-close>CLOSE</button></div>
  </div>`;
document.body.appendChild(help);

function escape(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] as string);
}

function setHelp(open: boolean): void {
  help.hidden = !open;
}
help.addEventListener('click', (e) => {
  if (e.target === help || (e.target as HTMLElement).hasAttribute('data-close')) setHelp(false);
});
window.addEventListener('rc505:help', (e) => setHelp(!!(e as CustomEvent).detail));

// --- power-on gate ----------------------------------------------------------
const gate = document.createElement('div');
gate.className = 'overlay';
gate.innerHTML = `
  <div class="card">
    <h1>RC-505mkII</h1>
    <p class="sub">LOOP STATION — web emulator</p>
    <p>
      Five stereo phrase tracks, Input FX and Track FX with 4 banks × 4 slots, the rhythm
      engine, 99 memories and the 128×64 display — all running in the browser.
    </p>
    <p>
      Audio starts only after a click (browser policy). Use the microphone to record real
      audio into the tracks, or run without it and loop the rhythm and FX.
    </p>
    <div class="actions">
      <button class="power" data-power>POWER ON</button>
      <button class="ghost" data-power data-mic>POWER ON + MICROPHONE</button>
      <button class="ghost" data-help>SHORTCUTS</button>
    </div>
  </div>`;
document.body.appendChild(gate);

const hint = document.createElement('div');
hint.className = 'hint';
hint.innerHTML = '<b>/</b> shortcuts &nbsp;·&nbsp; <b>Space</b> all start/stop &nbsp;·&nbsp; <b>1–5</b> rec/play';
document.body.appendChild(hint);

let app: App | null = null;

gate.addEventListener('click', async (e) => {
  const target = e.target as HTMLElement;
  if (target.hasAttribute('data-help')) {
    setHelp(true);
    return;
  }
  if (!target.hasAttribute('data-power')) return;
  const wantMic = target.hasAttribute('data-mic');
  target.textContent = 'STARTING…';
  gate.hidden = true;
  try {
    app = new App(stage);
    await app.start();
    if (wantMic) {
      const ok = await app.engine.enableMic();
      app.store.ui.micOn = ok;
      app.store.notify(ok ? 'MIC ON' : 'MIC ERROR');
    }
  } catch (err) {
    gate.hidden = false;
    const card = gate.querySelector('.card');
    if (card) card.innerHTML = `<h1>AUDIO ERROR</h1><p>${escape(String(err))}</p>`;
  }
});

window.addEventListener('resize', () => app?.panel.fit());
window.addEventListener('beforeunload', () => app?.store.persist());
