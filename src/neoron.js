/**
 * Neoron domain layer — how the data actually lives in Neoron's Firestore
 * (mapped by scripts/discover.mjs against the live system):
 *
 *   bots_draft/{botId}                                  bot registry (users[])
 *   bots/{botId}/agents/{uid}                           agent names
 *   bots/{botId}/departments/{id}                       department names
 *   bots/{botId}/conversations_metadata/{convId}        one doc per conversation
 *   bots/{botId}/conversations/{convId}/messages/{id}   full history
 *
 * conversations_metadata carries `channel`: "WHATSAPP" | "INSTAGRAM" | "WEB",
 * or none at all (legacy/expired stubs that still hold real messages).
 * Instagram contacts have `contact.instagram_username` and usually no phone.
 * Tags live as OBJECT MAPS ({id: {name, color, id}}) on both contact.tags and
 * the conversation's own tags.
 */
import { runQuery, listDocuments, decodeDoc } from './firestore.js';

/** List the bots this user can access (id + display name). */
export async function listBots(idToken, localId) {
  const rows = await runQuery(idToken, {
    from: [{ collectionId: 'bots_draft' }],
    where: { fieldFilter: { field: { fieldPath: 'users' }, op: 'ARRAY_CONTAINS', value: { stringValue: localId } } },
  });
  return rows.map((r) => decodeDoc(r.document)).filter(Boolean)
    .map((b) => ({ id: b._id, name: b.name || b.botName || b._id }));
}

/** id -> name map for a subcollection (agents / departments). */
export async function nameMap(idToken, parentPath, collection) {
  const map = {};
  try {
    let pageToken;
    do {
      const { documents = [], nextPageToken } = await listDocuments(idToken, `${parentPath}/${collection}`, { pageSize: 300, pageToken });
      for (const d of documents.map(decodeDoc)) map[d._id] = d.name || d.display_name || d.email || d._id;
      pageToken = nextPageToken;
    } while (pageToken);
  } catch { /* collection may not exist */ }
  return map;
}

/** Fetch every conversations_metadata doc under a bot (paginated). */
export async function fetchConversations(idToken, botId) {
  const out = [];
  let pageToken;
  do {
    const { documents = [], nextPageToken } = await listDocuments(
      idToken, `bots/${botId}/conversations_metadata`, { pageSize: 300, pageToken });
    for (const d of documents) out.push(decodeDoc(d));
    pageToken = nextPageToken;
  } while (pageToken);
  return out;
}

/** Fetch the full message history for one conversation (chronological). */
export async function fetchMessages(idToken, botId, convId) {
  const out = [];
  let pageToken;
  do {
    const { documents = [], nextPageToken } = await listDocuments(
      idToken, `bots/${botId}/conversations/${convId}/messages`, { pageSize: 300, pageToken });
    for (const d of documents) out.push(decodeDoc(d));
    pageToken = nextPageToken;
  } while (pageToken);
  out.sort((a, b) => (a.created_date || a.id || 0) - (b.created_date || b.id || 0));
  return out;
}

/** Run async tasks with limited concurrency. */
export async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return results;
}
