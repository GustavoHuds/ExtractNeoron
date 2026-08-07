/**
 * Firestore REST client for Neoron.
 * Neoron is a Firebase app: auth via Firebase Auth (Identity Toolkit),
 * data in Cloud Firestore (project "neoron"). We sign in with email/password
 * to get an idToken, then read Firestore over its REST API.
 */
import { config } from './config.js';

const PROJECT = 'neoron';
const API_KEY = 'AIzaSyDS65vzbj3_zGMFHypPaRG76DFEfAxuB50';
const DB = `projects/${PROJECT}/databases/(default)`;
const DOCS = `https://firestore.googleapis.com/v1/${DB}/documents`;

export async function signIn() {
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: config.email, password: config.password, returnSecureToken: true }),
    }
  );
  const data = await res.json();
  if (!res.ok) throw new Error(`Auth failed: ${data.error?.message || res.status}`);
  return { idToken: data.idToken, localId: data.localId, email: data.email };
}

function authHeaders(idToken) {
  return { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' };
}

/** List collection ids under a document path ('' = root). */
export async function listCollectionIds(idToken, parentPath = '') {
  const base = parentPath ? `${DOCS}/${parentPath}` : DOCS;
  const res = await fetch(`${base}:listCollectionIds`, {
    method: 'POST',
    headers: authHeaders(idToken),
    body: JSON.stringify({ pageSize: 300 }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`listCollectionIds(${parentPath}): ${data.error?.message || res.status}`);
  return data.collectionIds || [];
}

/** List documents in a collection. Returns raw Firestore documents. */
export async function listDocuments(idToken, collectionPath, { pageSize = 50, pageToken } = {}) {
  const url = new URL(`${DOCS}/${collectionPath}`);
  url.searchParams.set('pageSize', String(pageSize));
  if (pageToken) url.searchParams.set('pageToken', pageToken);
  const res = await fetch(url, { headers: authHeaders(idToken) });
  const data = await res.json();
  if (!res.ok) throw new Error(`listDocuments(${collectionPath}): ${data.error?.message || res.status}`);
  return data; // { documents: [...], nextPageToken }
}

/** runQuery (structured query) against a collection under an optional parent. */
export async function runQuery(idToken, structuredQuery, parentPath = '') {
  const base = parentPath ? `${DOCS}/${parentPath}` : DOCS;
  const res = await fetch(`${base}:runQuery`, {
    method: 'POST',
    headers: authHeaders(idToken),
    body: JSON.stringify({ structuredQuery }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`runQuery(${parentPath}): ${JSON.stringify(data.error) || res.status}`);
  return data; // array of { document } rows (plus readTime markers)
}

/** Convert a Firestore REST value object to a plain JS value. */
export function decodeValue(v) {
  if (v == null) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('nullValue' in v) return null;
  if ('referenceValue' in v) return v.referenceValue;
  if ('geoPointValue' in v) return v.geoPointValue;
  if ('bytesValue' in v) return v.bytesValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(decodeValue);
  if ('mapValue' in v) return decodeFields(v.mapValue.fields || {});
  return null;
}

export function decodeFields(fields = {}) {
  const out = {};
  for (const [k, v] of Object.entries(fields)) out[k] = decodeValue(v);
  return out;
}

/** Decode a full Firestore document into { _path, _id, ...fields }. */
export function decodeDoc(doc) {
  if (!doc) return null;
  const name = doc.name || '';
  const id = name.split('/').pop();
  return { _path: name.split('/documents/')[1] || name, _id: id, ...decodeFields(doc.fields || {}) };
}

export { PROJECT, DB, DOCS };
