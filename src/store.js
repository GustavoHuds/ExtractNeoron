/** Local persistence: "Feito" (done) state + historical pipeline snapshots.
 * Shared across the network since it lives on the host machine. */
import fs from 'node:fs';
import { DONE_FILE, NOANSWER_FILE, HISTORY_FILE, ensureDirs } from './config.js';

export function loadDone() {
  try { return JSON.parse(fs.readFileSync(DONE_FILE, 'utf8')); }
  catch { return {}; }
}

const UNSAFE_KEY = new Set(['__proto__', 'constructor', 'prototype']);

/** Mark a conversation done/undone. Returns the full done map. */
export function setDone(id, done, by = '') {
  if (UNSAFE_KEY.has(id)) return loadDone(); // ignore prototype-polluting ids
  ensureDirs();
  const map = loadDone();
  if (done) map[id] = { done: true, at: new Date().toISOString(), by };
  else delete map[id];
  fs.writeFileSync(DONE_FILE, JSON.stringify(map, null, 2));
  return map;
}

/** "Não atendeu" call attempts, persisted as { count, at, by } per conversation. */
export function loadNoAnswer() {
  try { return JSON.parse(fs.readFileSync(NOANSWER_FILE, 'utf8')); }
  catch { return {}; }
}

function writeNoAnswer(map) {
  ensureDirs();
  fs.writeFileSync(NOANSWER_FILE, JSON.stringify(map, null, 2));
  return map;
}

/** Register one more "não atendeu" attempt. Returns the full map. */
export function bumpNoAnswer(id, by = '') {
  if (UNSAFE_KEY.has(id)) return loadNoAnswer();
  const map = loadNoAnswer();
  const count = (map[id]?.count || 0) + 1;
  map[id] = { count, at: new Date().toISOString(), by };
  return writeNoAnswer(map);
}

/** Clear the attempts for a conversation (back to the queue). Returns the full map. */
export function resetNoAnswer(id) {
  if (UNSAFE_KEY.has(id)) return loadNoAnswer();
  const map = loadNoAnswer();
  delete map[id];
  return writeNoAnswer(map);
}

/** Append a pipeline snapshot (one JSON per line) for timeline trends. */
export function appendSnapshot(snap) {
  ensureDirs();
  fs.appendFileSync(HISTORY_FILE, JSON.stringify(snap) + '\n');
}

export function loadHistory() {
  try {
    return fs.readFileSync(HISTORY_FILE, 'utf8').trim().split(/\r?\n/)
      .filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean);
  } catch { return []; }
}
