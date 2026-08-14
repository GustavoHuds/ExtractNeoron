import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');
export const DATA_DIR = path.join(ROOT, 'data');
export const DISCOVERY_DIR = path.join(DATA_DIR, 'discovery');
export const STORAGE_STATE = path.join(DATA_DIR, 'storageState.json');
export const OUT_JSON = path.join(DATA_DIR, 'negociando.json');
export const OUT_CSV = path.join(DATA_DIR, 'negociando.csv');
export const OUT_XLSX = path.join(DATA_DIR, 'negociando.xlsx');
export const DONE_FILE = path.join(DATA_DIR, 'done.json');
export const NOANSWER_FILE = path.join(DATA_DIR, 'noanswer.json');
export const AI_SCORES_FILE = path.join(DATA_DIR, 'ai-scores.json');
export const JUSTIF_FILE = path.join(DATA_DIR, 'justificativas.json');
export const HISTORY_FILE = path.join(DATA_DIR, 'history.jsonl');
export const TIMELINE_JSON = path.join(DATA_DIR, 'timeline.json');

export const config = {
  url: process.env.NEORON_URL || 'https://app.neoron.io/dashboard',
  email: process.env.NEORON_EMAIL || '',
  password: process.env.NEORON_PASSWORD || '',
  // Firebase project + web API key for Neoron. The web API key is public by
  // design, but it is kept out of source (env only) so secret scanners don't
  // flag the repo and so it stays configurable per environment.
  firebaseProject: process.env.NEORON_PROJECT || 'neoron',
  apiKey: process.env.NEORON_API_KEY || '',
  // Optional access allow-list. Empty = any valid Neoron account may sign in.
  authorizedEmails: (process.env.AUTHORIZED_EMAILS || '')
    .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
  idleThresholdHours: Number(process.env.IDLE_THRESHOLD_HOURS || 24),
  // Nota IA (0-10) do atendimento — opcional. Sem ANTHROPIC_API_KEY, o recurso
  // fica desligado e o painel funciona normalmente sem a nota.
  anthropicKey: process.env.ANTHROPIC_API_KEY || '',
  aiModel: process.env.AI_MODEL || 'claude-haiku-4-5',
  // Leads finalizados são expurgados (done.json + snapshots) após N dias.
  doneRetentionDays: Number(process.env.DONE_RETENTION_DAYS || 180),
  headless: String(process.env.HEADLESS ?? 'true').toLowerCase() !== 'false',
  host: process.env.HOST || '0.0.0.0',
  port: Number(process.env.PORT || 3000),
  // Neoron runs on Firebase / Google Cloud Functions; its SPA talks to this host.
  apiHostFragment: 'cloudfunctions.net/api/',
};

export function ensureDirs() {
  for (const dir of [DATA_DIR, DISCOVERY_DIR]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function assertCredentials() {
  if (!config.email || !config.password) {
    throw new Error('Missing NEORON_EMAIL / NEORON_PASSWORD. Fill in .env (see .env.example).');
  }
}
