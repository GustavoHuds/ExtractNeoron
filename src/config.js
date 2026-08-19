import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');
export const DATA_DIR = path.join(ROOT, 'data');

// Extraction output + caches (all git-ignored, private to the host).
export const OUT_JSON = path.join(DATA_DIR, 'leads.json');
export const OUT_CSV = path.join(DATA_DIR, 'leads.csv');
export const CONV_INDEX_FILE = path.join(DATA_DIR, 'convindex.json');

// Team-shared state.
export const DONE_FILE = path.join(DATA_DIR, 'done.json');
export const NOANSWER_FILE = path.join(DATA_DIR, 'noanswer.json');
export const JUSTIF_FILE = path.join(DATA_DIR, 'justificativas.json');
export const AI_SCORES_FILE = path.join(DATA_DIR, 'ai-scores.json');
export const HISTORY_FILE = path.join(DATA_DIR, 'history.jsonl');
export const AUDIT_FILE = path.join(DATA_DIR, 'audit.jsonl');

export const config = {
  // Firebase project + web API key for Neoron. The web API key is public by
  // design (it ships in Neoron's browser app), but env-only keeps the repo
  // clean for secret scanners and each environment configurable.
  firebaseProject: process.env.NEORON_PROJECT || 'neoron',
  apiKey: process.env.NEORON_API_KEY || '',

  // Optional access allow-list. Empty = any valid Neoron account may sign in.
  authorizedEmails: (process.env.AUTHORIZED_EMAILS || '')
    .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),

  // Hours a customer can wait for a human reply before the call queue.
  callQueueHours: Number(process.env.CALL_QUEUE_HOURS || 24),

  // Waiting longer than this leaves the call queue (lead considered lost —
  // still visible in the pipeline, but not something to "call now").
  callQueueMaxDays: Number(process.env.CALL_QUEUE_MAX_DAYS || 14),

  // Concluded leads + caches are purged after N days.
  doneRetentionDays: Number(process.env.DONE_RETENTION_DAYS || 180),

  // Nota IA (0-10) do atendimento — optional. Off without ANTHROPIC_API_KEY.
  anthropicKey: process.env.ANTHROPIC_API_KEY || '',
  aiModel: process.env.AI_MODEL || 'claude-haiku-4-5',

  host: process.env.HOST || '0.0.0.0',
  port: Number(process.env.PORT || 3000),

  // scripts/discover.mjs only (never used by the server).
  email: process.env.NEORON_EMAIL || '',
  password: process.env.NEORON_PASSWORD || '',
};

export function ensureDirs() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
