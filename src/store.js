/** Local persistence: "Feito" (done) state + historical pipeline snapshots.
 * Shared across the network since it lives on the host machine. */
import fs from 'node:fs';
import { DONE_FILE, NOANSWER_FILE, HISTORY_FILE, JUSTIF_FILE, ensureDirs, config } from './config.js';

const UNSAFE_KEY = new Set(['__proto__', 'constructor', 'prototype']);

/** Drop entries whose `at` is older than `days`. Pure — returns a new map. */
export function pruneOldEntries(map, days, now = Date.now()) {
  const cutoff = now - days * 24 * 60 * 60 * 1000;
  const out = {};
  for (const [id, entry] of Object.entries(map)) {
    const at = Date.parse(entry?.at || '');
    if (Number.isNaN(at) || at >= cutoff) out[id] = entry;
  }
  return out;
}

export function loadDone() {
  let map;
  try { map = JSON.parse(fs.readFileSync(DONE_FILE, 'utf8')); }
  catch { return {}; }
  // Retention: finalized leads are purged after config.doneRetentionDays (180d).
  const pruned = pruneOldEntries(map, config.doneRetentionDays);
  if (Object.keys(pruned).length !== Object.keys(map).length) {
    ensureDirs();
    fs.writeFileSync(DONE_FILE, JSON.stringify(pruned, null, 2));
  }
  return pruned;
}

/** Mark a conversation done/undone. When concluding, records the outcome
 * `reason` (preset disposition), free-text `note` (justificativa) and a `snap`
 * of the lead so the "Finalizados" tab survives the lead leaving the tag.
 * Returns the full done map. */
export function setDone(id, done, by = '', reason = '', note = '', snap = null) {
  if (UNSAFE_KEY.has(id)) return loadDone(); // ignore prototype-polluting ids
  ensureDirs();
  const map = loadDone();
  if (done) map[id] = { done: true, at: new Date().toISOString(), by, reason, note, ...(snap ? { snap } : {}) };
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

/** Register one more "não atendeu" attempt, keeping an optional free-text
 * `note` from the latest attempt. Returns the full map. */
export function bumpNoAnswer(id, by = '', note = '') {
  if (UNSAFE_KEY.has(id)) return loadNoAnswer();
  const map = loadNoAnswer();
  const count = (map[id]?.count || 0) + 1;
  map[id] = { count, at: new Date().toISOString(), by, note };
  return writeNoAnswer(map);
}

/** Clear the attempts for a conversation (back to the queue). Returns the full map. */
export function resetNoAnswer(id) {
  if (UNSAFE_KEY.has(id)) return loadNoAnswer();
  const map = loadNoAnswer();
  delete map[id];
  return writeNoAnswer(map);
}

/** Reusable justificativas for the "Finalizar" popup: preset list + the ones
 * the team saves. Stored as a plain string array. */
const DEFAULT_JUSTIFS = [
  'Cliente vai pensar e retorna',
  'Aguardando pagamento',
  'Preço acima do orçamento',
  'Comprou em outra loja',
  'Número errado / não existe',
  'Pediu para não contatar',
];
const JUSTIF_MAX_LEN = 120;
const JUSTIF_MAX_COUNT = 40;

export function loadJustifs() {
  try {
    const arr = JSON.parse(fs.readFileSync(JUSTIF_FILE, 'utf8'));
    if (Array.isArray(arr)) return arr.filter((t) => typeof t === 'string' && t.trim()).slice(0, JUSTIF_MAX_COUNT);
  } catch { /* first run: seed with the presets */ }
  return DEFAULT_JUSTIFS.slice();
}

function writeJustifs(list) {
  ensureDirs();
  fs.writeFileSync(JUSTIF_FILE, JSON.stringify(list, null, 2));
  return list;
}

export function addJustif(text) {
  const t = String(text || '').trim().slice(0, JUSTIF_MAX_LEN);
  if (!t) return loadJustifs();
  const list = loadJustifs();
  if (list.some((x) => x.toLowerCase() === t.toLowerCase())) return list;
  list.push(t);
  return writeJustifs(list.slice(-JUSTIF_MAX_COUNT));
}

export function removeJustif(text) {
  const t = String(text || '').trim().toLowerCase();
  return writeJustifs(loadJustifs().filter((x) => x.toLowerCase() !== t));
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
