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
export const HISTORY_FILE = path.join(DATA_DIR, 'history.jsonl');
export const TIMELINE_JSON = path.join(DATA_DIR, 'timeline.json');

export const config = {
  url: process.env.NEORON_URL || 'https://app.neoron.io/dashboard',
  email: process.env.NEORON_EMAIL || '',
  password: process.env.NEORON_PASSWORD || '',
  idleThresholdHours: Number(process.env.IDLE_THRESHOLD_HOURS || 24),
  headless: String(process.env.HEADLESS ?? 'true').toLowerCase() !== 'false',
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
