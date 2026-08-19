/**
 * Neoron schema discovery — maps how the data lives in Neoron's Firestore.
 * Read-only. Uses NEORON_EMAIL / NEORON_PASSWORD from .env (never hardcode).
 *
 *   npm run discover
 */
import 'dotenv/config';
import { signIn, listDocuments, runQuery, decodeDoc } from '../src/firestore.js';

if (!process.env.NEORON_EMAIL || !process.env.NEORON_PASSWORD) {
  console.error('Preencha NEORON_EMAIL e NEORON_PASSWORD no .env (só para este script).');
  process.exit(1);
}

async function listAll(idToken, path, cap = Infinity) {
  const out = []; let pageToken;
  do {
    const { documents = [], nextPageToken } = await listDocuments(idToken, path, { pageSize: 300, pageToken });
    for (const d of documents) out.push(decodeDoc(d));
    pageToken = nextPageToken;
  } while (pageToken && out.length < cap);
  return out;
}

const tally = (arr, fn) => {
  const m = new Map();
  for (const x of arr) { const k = fn(x) ?? '(none)'; m.set(k, (m.get(k) || 0) + 1); }
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
};

const { idToken, localId } = await signIn();
console.log('AUTH OK');

const botsRaw = await runQuery(idToken, {
  from: [{ collectionId: 'bots_draft' }],
  where: { fieldFilter: { field: { fieldPath: 'users' }, op: 'ARRAY_CONTAINS', value: { stringValue: localId } } },
});
const bots = botsRaw.map((r) => decodeDoc(r.document)).filter(Boolean);
console.log('BOTS:', bots.map((b) => `${b._id} "${b.name || '?'}"`));

for (const bot of bots) {
  const convs = await listAll(idToken, `bots/${bot._id}/conversations_metadata`);
  console.log(`\n=== ${bot.name || bot._id}: ${convs.length} conversations ===`);
  console.log('BY channel:', tally(convs, (c) => c.channel));
  console.log('BY status:', tally(convs, (c) => c.status));
  const asArr = (x) => (x && typeof x === 'object' ? Object.values(x) : []);
  const tags = new Map();
  for (const c of convs) {
    for (const t of [...asArr(c.contact?.tags), ...asArr(c.tags)]) {
      const n = t?.name || '?';
      tags.set(n, (tags.get(n) || 0) + 1);
    }
  }
  console.log('TAGS:', [...tags.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20));
  for (const sub of ['agents', 'departments']) {
    const docs = await listAll(idToken, `bots/${bot._id}/${sub}`, 300);
    console.log(`${sub}: ${docs.length}`, docs.slice(0, 15).map((d) => d.name || d._id));
  }
}
