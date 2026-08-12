/**
 * Persistence. Memory/system settings live in localStorage; recorded phrases
 * (which can be many megabytes) live in IndexedDB, one record per
 * memory/track pair — the browser equivalent of the unit's internal memory.
 */

import type { Memory, SystemSettings } from '../types';

const LS_KEY = 'rc505mk2.state.v1';
const DB_NAME = 'rc505mk2';
const DB_STORE = 'phrases';

export interface PersistedState {
  memories: Memory[];
  system: SystemSettings;
  currentMemory: number;
}

export interface PhraseRecord {
  key: string;
  left: ArrayBuffer;
  right: ArrayBuffer;
  length: number;
  tempo: number;
  measures: number;
}

export function loadState(): PersistedState | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PersistedState;
  } catch {
    return null;
  }
}

let saveTimer: number | null = null;

export function saveState(state: PersistedState): void {
  if (saveTimer !== null) window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(state));
    } catch (err) {
      console.warn('Could not persist settings', err);
    }
  }, 400);
}

export function clearState(): void {
  localStorage.removeItem(LS_KEY);
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

function db(): Promise<IDBDatabase | null> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve) => {
      if (!('indexedDB' in window)) {
        resolve(null);
        return;
      }
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains(DB_STORE)) d.createObjectStore(DB_STORE, { keyPath: 'key' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    });
  }
  return dbPromise;
}

const key = (memory: number, track: number): string => `${memory}:${track}`;

export async function savePhrase(memory: number, track: number, rec: Omit<PhraseRecord, 'key'>): Promise<void> {
  const d = await db();
  if (!d) return;
  await new Promise<void>((resolve) => {
    const tx = d.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).put({ ...rec, key: key(memory, track) });
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

export async function readPhrase(memory: number, track: number): Promise<PhraseRecord | null> {
  const d = await db();
  if (!d) return null;
  return new Promise((resolve) => {
    const tx = d.transaction(DB_STORE, 'readonly');
    const req = tx.objectStore(DB_STORE).get(key(memory, track));
    req.onsuccess = () => resolve((req.result as PhraseRecord | undefined) ?? null);
    req.onerror = () => resolve(null);
  });
}

export async function deletePhrase(memory: number, track: number): Promise<void> {
  const d = await db();
  if (!d) return;
  await new Promise<void>((resolve) => {
    const tx = d.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).delete(key(memory, track));
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}
