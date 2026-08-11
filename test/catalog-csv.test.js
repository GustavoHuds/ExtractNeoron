import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCatalogCsv } from '../src/catalog.js';

test('parses comma-delimited CSV with US decimals + BOM', () => {
  const csv = '﻿codigo,nome,categoria,preco\n1001,COLCHAO PROBEL,COLCHAO,169.00\n';
  const items = parseCatalogCsv(csv);
  assert.equal(items.length, 1);
  assert.deepEqual(items[0], { nome: 'COLCHAO PROBEL', codigo: '1001', categoria: 'COLCHAO', preco: 169 });
});

test('parses semicolon-delimited CSV with BR decimals', () => {
  const csv = 'nome;preco;codigo\nCONJUNTO ORTOBOM;1.299,90;77\n';
  const items = parseCatalogCsv(csv);
  assert.equal(items[0].preco, 1299.9);
  assert.equal(items[0].codigo, '77');
});

test('honors quoted fields containing the delimiter', () => {
  const csv = 'nome,categoria,preco\n"CAMA BOX, CASAL",MOVEIS,"2.000,00"\n';
  const items = parseCatalogCsv(csv);
  assert.equal(items[0].nome, 'CAMA BOX, CASAL');
  assert.equal(items[0].preco, 2000);
});

test('maps optional display columns and skips blank-nome rows', () => {
  const csv = 'codigo,nome,nome_exibicao,categoria_label,preco\n5,X SMILE,Colchão Smile,Colchões,10\n6,,,,0\n';
  const items = parseCatalogCsv(csv);
  assert.equal(items.length, 1);
  assert.equal(items[0].nome_exibicao, 'Colchão Smile');
  assert.equal(items[0].categoria_label, 'Colchões');
});

test('rejects a CSV without a nome column', () => {
  assert.throws(() => parseCatalogCsv('codigo,preco\n1,10\n'), /coluna "nome"/);
});

test('rejects an empty CSV', () => {
  assert.throws(() => parseCatalogCsv('nome,preco\n'), /vazio|sem linhas/);
});
