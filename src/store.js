/** Local persistence: "Feito" (done) state + historical pipeline snapshots.
 * Shared across the network since it lives on the host machine. */
import fs from 'node:fs';
import { DONE_FILE, HISTORY_FILE, ensureDirs } from './config.js';

export function loadDone() {
  try { return JSON.parse(fs.readFileSync(DONE_FILE, 'utf8')); }
  catch { return {}; }
}

/** Mark a conversation done/undone. Returns the full done map. */
export function setDone(id, done, by = '') {
  ensureDirs();
  const map = loadDone();
  if (done) map[id] = { done: true, at: new Date().toISOString(), by };
  else delete map[id];
  fs.writeFileSync(DONE_FILE, JSON.stringify(map, null, 2));
  return map;
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
