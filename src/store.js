/** Local persistence: done state, call attempts, justificativas, history,
 * the incremental conversation index and the audit log.
 * Everything lives in data/ on the host — shared by the whole team. */
import fs from 'node:fs';
import {
  DONE_FILE, NOANSWER_FILE, HISTORY_FILE, JUSTIF_FILE, CONV_INDEX_FILE,
  AUDIT_FILE, ensureDirs, config,
} from './config.js';

const UNSAFE_KEY = new Set(['__proto__', 'constructor', 'prototype']);

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return fallback; }
}

function writeJson(file, value) {
  ensureDirs();
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value));
  fs.renameSync(tmp, file); // atomic-ish: no torn files on crash
  return value;
}

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

// ---------------------------------------------------------------- done leads

export function loadDone() {
  const map = readJson(DONE_FILE, {});
  const pruned = pruneOldEntries(map, config.doneRetentionDays);
  if (Object.keys(pruned).length !== Object.keys(map).length) writeJson(DONE_FILE, pruned);
  return pruned;
}

/** Mark a conversation done/undone. When concluding, records the outcome
 * `reason`, free-text `note` and a `snap` of the lead so the "Finalizados"
 * tab survives the lead leaving Neoron. Returns the full done map. */
export function setDone(id, done, by = '', reason = '', note = '', snap = null) {
  if (UNSAFE_KEY.has(id)) return loadDone();
  const map = loadDone();
  if (done) map[id] = { done: true, at: new Date().toISOString(), by, reason, note, ...(snap ? { snap } : {}) };
  else delete map[id];
  return writeJson(DONE_FILE, map);
}

// ---------------------------------------------------------- call attempts

export function loadNoAnswer() { return readJson(NOANSWER_FILE, {}); }

/** Register one more "não atendeu" attempt (keeps the latest note). */
export function bumpNoAnswer(id, by = '', note = '') {
  if (UNSAFE_KEY.has(id)) return loadNoAnswer();
  const map = loadNoAnswer();
  const count = (map[id]?.count || 0) + 1;
  map[id] = { count, at: new Date().toISOString(), by, note };
  return writeJson(NOANSWER_FILE, map);
}

/** Clear the attempts for a conversation (back to the queue). */
export function resetNoAnswer(id) {
  if (UNSAFE_KEY.has(id)) return loadNoAnswer();
  const map = loadNoAnswer();
  delete map[id];
  return writeJson(NOANSWER_FILE, map);
}

// -------------------------------------------------------- justificativas

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
  const arr = readJson(JUSTIF_FILE, null);
  if (Array.isArray(arr)) return arr.filter((t) => typeof t === 'string' && t.trim()).slice(0, JUSTIF_MAX_COUNT);
  return DEFAULT_JUSTIFS.slice();
}

export function addJustif(text) {
  const t = String(text || '').trim().slice(0, JUSTIF_MAX_LEN);
  if (!t) return loadJustifs();
  const list = loadJustifs();
  if (list.some((x) => x.toLowerCase() === t.toLowerCase())) return list;
  list.push(t);
  return writeJson(JUSTIF_FILE, list.slice(-JUSTIF_MAX_COUNT));
}

export function removeJustif(text) {
  const t = String(text || '').trim().toLowerCase();
  return writeJson(JUSTIF_FILE, loadJustifs().filter((x) => x.toLowerCase() !== t));
}

// ------------------------------------------------ conversation index (cache)

/**
 * Incremental extraction cache: one entry per conversation with everything
 * derived from its messages. A conversation is only re-fetched when its
 * `lastMs` changes, so extractions after the first touch only changed chats.
 * Shape: { [convId]: { lastMs, firstTs, firstUserTs, msgCount, userMsgs,
 *   agentMsgs, atendente, firstResponseMs, medianResponseMs, pendingUserTs,
 *   interesseScore, temperatura, motivos, produto..., monthsActive: [..] } }
 */
export function loadConvIndex() { return readJson(CONV_INDEX_FILE, {}); }

export function saveConvIndex(map) {
  // retention: entries idle beyond the done-retention window are dropped
  const cutoff = Date.now() - config.doneRetentionDays * 24 * 3600 * 1000;
  const out = {};
  for (const [id, e] of Object.entries(map)) {
    if (!UNSAFE_KEY.has(id) && (e.lastMs || 0) >= cutoff) out[id] = e;
  }
  return writeJson(CONV_INDEX_FILE, out);
}

// --------------------------------------------------------------- history

/** Append a pipeline snapshot (one JSON per line) for trends. */
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

// ---------------------------------------------------------------- audit log

/** Append-only audit trail of every state-changing action (who/what/when).
 * Never returned to the browser; inspect on the host with `tail data/audit.jsonl`. */
export function audit(actor, action, detail = {}) {
  ensureDirs();
  const entry = { at: new Date().toISOString(), actor, action, ...detail };
  fs.appendFileSync(AUDIT_FILE, JSON.stringify(entry) + '\n');
}
