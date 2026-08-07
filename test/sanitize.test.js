import test from 'node:test';
import assert from 'node:assert/strict';
import { neutralizeCell } from '../src/sanitize.js';

test('prefixes formula-leading strings', () => {
  for (const c of ['=', '+', '-', '@']) {
    assert.equal(neutralizeCell(`${c}CMD()`), `'${c}CMD()`);
  }
});
test('prefixes tab/CR-leading strings', () => {
  assert.equal(neutralizeCell('\tx'), "'\tx");
  assert.equal(neutralizeCell('\rx'), "'\rx");
});
test('prefixes whitespace-then-formula strings (Excel trims leading space)', () => {
  assert.equal(neutralizeCell(' =1+1'), "' =1+1");
  assert.equal(neutralizeCell('  @cmd'), "'  @cmd");
});
test('leaves safe strings unchanged', () => {
  assert.equal(neutralizeCell('João'), 'João');
  assert.equal(neutralizeCell('R$ 1.200,00'), 'R$ 1.200,00');
});
test('passes through non-strings', () => {
  assert.equal(neutralizeCell(42), 42);
  assert.equal(neutralizeCell(null), null);
});
