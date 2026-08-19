/**
 * Catalog matcher: identify the real Belmont SKU being negotiated in a chat by
 * matching the transcript against `Catálogo - ref/data/catalogo-dados.json`.
 *
 * Uses TF-IDF-ish scoring: rare tokens (brand/model names like PROBEL, SMILE,
 * GRECIA, TOPAZIO) dominate, so when the agent/customer names a model we lock
 * onto the exact product; generic words (COLCHAO, CASAL) barely move the score.
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, DATA_DIR, ensureDirs } from './config.js';

// Where the active catalog lives. Priority:
//   1. CATALOG_PATH env override
//   2. data/catalogo.json  (imported via the dashboard "Importar catálogo" button;
//      git-ignored, persisted per deployment — each user brings their own catalog)
//   3. legacy local reference file (kept working for existing local setups)
const IMPORTED_CATALOG = path.join(DATA_DIR, 'catalogo.json');
const LEGACY_CATALOG = path.join(ROOT, 'Catálogo - ref', 'data', 'catalogo-dados.json');

function catalogPath() {
  if (process.env.CATALOG_PATH) return process.env.CATALOG_PATH;
  if (fs.existsSync(IMPORTED_CATALOG)) return IMPORTED_CATALOG;
  return LEGACY_CATALOG;
}

// Generic product words + sizes + units + colors + store/greeting words +
// common conversational Portuguese — none carry a model signal.
const STOP = new Set([
  // product-generic
  'CONJUNTO', 'CONJ', 'BOX', 'BIBOX', 'UNIBOX', 'CAMA', 'COLCHAO', 'BASE', 'KIT', 'KITS',
  'JOGO', 'PECAS', 'PECA', 'POL', 'MOL', 'MOLA', 'MOLAS', 'ENSACADAS', 'ENSAC', 'ENSACAD',
  'ENSACADA', 'AUXILIAR', 'AUXILAR', 'GRANDE', 'PEQUENA', 'PEQUENO', 'MASTER', 'FIRME',
  'MEGA', 'SUPER', 'SORT', 'SORTIMENTO', 'SORTIDO', 'PREMIUM', 'PLUS', 'UNICA', 'UNICO',
  // sizes
  'CASAL', 'QUEEN', 'KING', 'SOLTEIRO', 'SOLTEIRA', 'VIUVO', 'VIUVA', 'VIUVAO', 'PADRAO',
  // colors
  'PRETA', 'PRETO', 'BRANCA', 'BRANCO', 'MARROM', 'MARFIM', 'CARAMELO', 'CINZA', 'BEGE',
  'AZUL', 'VERDE', 'AMARELO', 'VERMELHA', 'VERMELHO', 'ROSA', 'LISO', 'LISA', 'COR', 'CORES',
  'OFF', 'WHITE', 'NAT', 'NATUR', 'NATURE', 'GRAFITE', 'FREIJO', 'FOSCO', 'SORTIDO',
  // store / greeting / people
  'BELMONT', 'GRUPO', 'LOJA', 'LOJAS', 'ATENDIMENTO', 'CONSULTOR', 'VENDAS', 'JONAS', 'ALVES',
  // cities / regions (Paraíba) that customers mention
  'CAMPINA', 'GRANDE', 'ITAMBE', 'BAYEUX', 'MAMANGUAPE', 'PESSOA', 'JOAO', 'GUARABIRA', 'PATOS',
  'SOUSA', 'CAJAZEIRAS', 'ESPERANCA', 'POMBAL', 'SANTA', 'RITA', 'CENTRO', 'MANGABEIRA',
  'GAISO', 'INTERLAGOS', 'GRAMAME', 'PARAIBA', 'RECIFE', 'NATAL', 'CONDOMINIO',
  // common verbs/adverbs (5+) that slipped through
  'PASSAR', 'ESCOLHA', 'ESCOLHER', 'MOSTRAR', 'CONSEGUE', 'CONSEGUIR', 'PODERIA', 'GOSTARIA',
  'OBRIGADA', 'OBRIGADO', 'CONFIRMAR', 'RESOLVER', 'PRECISO', 'PRECISANDO', 'MEDIR', 'TAMANHO',
  // conversational PT (4+)
  'PARA', 'POR', 'PODE', 'PAGA', 'PAGO', 'PAGAR', 'VOCE', 'ISSO', 'ESSE', 'ESSA', 'ESTE',
  'ESTA', 'AQUI', 'TUDO', 'VOU', 'VER', 'TEM', 'NAO', 'SIM', 'DIA', 'BOA', 'BOM', 'OLA',
  'FICA', 'FICOU', 'VAI', 'QUER', 'QUERO', 'QUERIA', 'GENTE', 'AGORA', 'DEPOIS', 'ANTES',
  'HOJE', 'AMANHA', 'LINK', 'COMO', 'ONDE', 'QUAL', 'QUANTO', 'VALOR', 'PRECO', 'PRAZO',
  'ENTREGA', 'ENTRADA', 'FRETE', 'CIDADE', 'BAIRRO', 'CASA', 'APARTAMENTO', 'MANDA', 'DADOS',
  'NOME', 'COMPLETO', 'ENDERECO', 'PONTO', 'REFERENCIA', 'CARTAO', 'CREDITO', 'BOLETO',
  'JUROS', 'VEZES', 'PARCELA', 'PARCELAS', 'SCORE', 'FINANCEIRA', 'CLIENTE', 'MODELO', 'FOTO',
]);

// Firmness / unit codes that look like model tokens but aren't.
const CODE_RE = /^(D\d+|EP|CT|CCT|EAN|LCC|CFU|PB|QQ|JJ|EA|UN|PC|PCS|PT|PTS|CM|MM|MT)$/;

function norm(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
}
function tokenize(s) {
  return norm(s).replace(/[^A-Z0-9]+/g, ' ').split(' ')
    .filter((t) => t.length >= 4 && !/^\d/.test(t) && !CODE_RE.test(t) && !STOP.has(t));
}

let CATALOG = null, IDF = null, DF = null, SOURCE = null;

// Parts / accessories that a customer doesn't negotiate as the main product.
const COMPONENT_RE = /(LATERAL|PROTETOR|\bPROT\b|\bCAPA\b|\bSAIA\b|\bGRADE\b|\bTAMPO\b|RODIZIO|\bPES\b)/;

/** Build the in-memory index from a raw catalog array. */
function indexCatalog(raw) {
  DF = new Map();
  for (const it of raw) {
    it._tokens = [...new Set(tokenize(it.nome))];
    it._skip = it.categoria === 'ACESSORIOS' || COMPONENT_RE.test(norm(it.nome));
    for (const t of it._tokens) DF.set(t, (DF.get(t) || 0) + 1);
  }
  const N = raw.length || 1;
  IDF = new Map();
  for (const [t, d] of DF) IDF.set(t, Math.log(N / d));
  CATALOG = raw;
  return CATALOG;
}

export function loadCatalog() {
  if (CATALOG) return CATALOG;
  const file = catalogPath();
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Array.isArray(raw)) throw new Error('catalog is not an array');
    SOURCE = file;
    return indexCatalog(raw);
  } catch {
    // No catalog imported yet (or unreadable): run with SKU matching disabled.
    // Category-based product detection still works. Import one via the dashboard.
    SOURCE = null;
    return indexCatalog([]);
  }
}

/** Drop the in-memory cache so the next match re-reads from disk. */
export function invalidateCatalog() { CATALOG = null; IDF = null; DF = null; SOURCE = null; }

/** Report whether a catalog is loaded, how many SKUs, and its source path. */
export function catalogStatus() {
  loadCatalog();
  return { loaded: (CATALOG?.length || 0) > 0, count: CATALOG?.length || 0, source: SOURCE };
}

/** Parse a price cell in BR ("1.234,56" / "169,00") or US ("169.00") format. */
function parsePreco(raw) {
  if (raw == null) return null;
  let s = String(raw).trim().replace(/R\$/gi, '').replace(/\s/g, '');
  if (!s) return null;
  if (s.includes(',') && s.includes('.')) s = s.replace(/\./g, '').replace(',', '.'); // 1.234,56
  else if (s.includes(',')) s = s.replace(',', '.');                                   // 169,00
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Detect the delimiter of a CSV from its header line (, ; or tab). */
function detectDelim(line) {
  const counts = { ',': 0, ';': 0, '\t': 0 };
  let q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if (!q && ch in counts) counts[ch]++;
  }
  const [best, n] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return n > 0 ? best : ',';
}

/** RFC4180-ish parser: rows of fields, honoring quotes and the given delimiter. */
function parseRows(text, delim) {
  const rows = [];
  let field = '', row = [], inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === delim) { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/**
 * Parse a catalog CSV into the item shape the app reads. Maps columns by header
 * name (case-insensitive), tolerating common variants; requires a `nome` column.
 * @returns {Array<{nome,codigo?,preco?,categoria?,nome_exibicao?,categoria_label?}>}
 */
export function parseCatalogCsv(text) {
  const clean = String(text).replace(/^﻿/, '');
  const firstLine = clean.slice(0, (clean.search(/\r?\n/) + 1 || clean.length + 1) - 1);
  const rows = parseRows(clean, detectDelim(firstLine));
  if (rows.length < 2) throw new Error('CSV vazio ou sem linhas de dados.');
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (...names) => { for (const n of names) { const i = header.indexOf(n); if (i >= 0) return i; } return -1; };
  const iNome = col('nome', 'name', 'produto', 'descricao');
  if (iNome < 0) throw new Error('O CSV precisa de uma coluna "nome" (achei: ' + header.join(', ') + ').');
  const iCod = col('codigo', 'código', 'cod', 'sku', 'ref', 'referencia', 'referência');
  const iPreco = col('preco', 'preço', 'price', 'valor');
  const iCat = col('categoria', 'category', 'cat');
  const iExib = col('nome_exibicao', 'nome_exibição', 'exibicao', 'display');
  const iCatLbl = col('categoria_label', 'categoria_nome', 'cat_label');
  const items = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const nome = (row[iNome] || '').trim();
    if (!nome) continue;
    const it = { nome };
    if (iCod >= 0 && row[iCod]?.trim()) it.codigo = row[iCod].trim();
    if (iCat >= 0 && row[iCat]?.trim()) it.categoria = row[iCat].trim();
    if (iExib >= 0 && row[iExib]?.trim()) it.nome_exibicao = row[iExib].trim();
    if (iCatLbl >= 0 && row[iCatLbl]?.trim()) it.categoria_label = row[iCatLbl].trim();
    if (iPreco >= 0) { const p = parsePreco(row[iPreco]); if (p != null) it.preco = p; }
    items.push(it);
  }
  if (!items.length) throw new Error('Nenhuma linha com "nome" preenchido no CSV.');
  return items;
}

/**
 * Validate + persist an imported catalog to data/catalogo.json, then reload it.
 * Accepts the same shape as catalogo-dados.json: an array of items with at least
 * a `nome` field (codigo/preco/categoria optional but recommended).
 * @returns {{ loaded: boolean, count: number, source: string|null }}
 */
export function saveCatalog(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('Catálogo inválido: envie um JSON com uma lista de produtos.');
  }
  const clean = items.filter((it) => it && typeof it.nome === 'string' && it.nome.trim());
  if (clean.length === 0) {
    throw new Error('Catálogo inválido: nenhum item com o campo "nome".');
  }
  ensureDirs();
  fs.writeFileSync(IMPORTED_CATALOG, JSON.stringify(clean));
  invalidateCatalog();
  return catalogStatus();
}

/**
 * Match a transcript to the best catalog item.
 * @returns {null | { item, score, matched: string[], distinctive: boolean, second: object|null }}
 */
export function matchCatalog(transcript) {
  loadCatalog();
  const tset = new Set(tokenize(transcript));
  if (!tset.size) return null;

  let best = null, second = null;
  for (const it of CATALOG) {
    if (it._skip) continue;
    let score = 0; const matched = [];
    for (const t of it._tokens) {
      if (tset.has(t)) { score += IDF.get(t) || 0; matched.push(t); }
    }
    if (score <= 0) continue;
    const cand = { item: it, score, matched };
    if (!best || score > best.score) { second = best; best = cand; }
    else if (!second || score > second.score) { second = cand; }
  }
  if (!best) return null;
  best.distinctive = best.matched.some((t) => (DF.get(t) || 0) <= 40);
  best.second = second;
  return best;
}

/**
 * High-level: return a confident SKU match or null.
 * @returns {null | { produto, codigo, preco, categoria, matched: string[] }}
 */
export function matchProduct(transcript) {
  const m = matchCatalog(transcript);
  if (!m) return null;
  // An "anchor" is a real brand/model token: long-ish and rare in the catalog.
  const anchors = m.matched.filter((t) => t.length >= 5 && (DF.get(t) || 0) <= 30);
  // Confident only with corroboration: >=2 matched tokens, an anchor, decent
  // score, and a real priced product (filters out R$0 parts/variants).
  const ok = anchors.length >= 1 && m.matched.length >= 2 && m.score >= 6 && m.item.preco > 0;
  if (!ok) return null;
  const it = m.item;
  return {
    produto: it.nome_exibicao || it.nome,
    codigo: it.codigo,
    preco: it.preco,
    categoria: it.categoria_label || it.categoria,
    matched: m.matched,
    anchors,
  };
}
