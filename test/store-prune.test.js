import test from 'node:test';
import assert from 'node:assert/strict';
import { pruneOldEntries } from '../src/store.js';

const DAY = 24 * 60 * 60 * 1000;
const now = Date.parse('2026-08-14T12:00:00Z');
const iso = (daysAgo) => new Date(now - daysAgo * DAY).toISOString();

test('keeps entries newer than the retention window', () => {
  const map = { a: { at: iso(1) }, b: { at: iso(179) } };
  assert.deepEqual(Object.keys(pruneOldEntries(map, 180, now)), ['a', 'b']);
});

test('drops entries older than the retention window', () => {
  const map = { fresh: { at: iso(10) }, stale: { at: iso(181) } };
  const out = pruneOldEntries(map, 180, now);
  assert.deepEqual(Object.keys(out), ['fresh']);
});

test('keeps entries without a parseable date (never silently lose data)', () => {
  const map = { legacy: { done: true }, weird: { at: 'not-a-date' } };
  assert.equal(Object.keys(pruneOldEntries(map, 180, now)).length, 2);
});

test('does not mutate the input map', () => {
  const map = { stale: { at: iso(500) } };
  pruneOldEntries(map, 180, now);
  assert.ok(map.stale);
});
