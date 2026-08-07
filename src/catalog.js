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
import { ROOT } from './config.js';

const CATALOG_JSON = process.env.CATALOG_PATH
  || path.join(ROOT, 'Catálogo - ref', 'data', 'catalogo-dados.json');

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

let CATALOG = null, IDF = null, DF = null;

// Parts / accessories that a customer doesn't negotiate as the main product.
const COMPONENT_RE = /(LATERAL|PROTETOR|\bPROT\b|\bCAPA\b|\bSAIA\b|\bGRADE\b|\bTAMPO\b|RODIZIO|\bPES\b)/;

export function loadCatalog() {
  if (CATALOG) return CATALOG;
  const raw = JSON.parse(fs.readFileSync(CATALOG_JSON, 'utf8'));
  DF = new Map();
  for (const it of raw) {
    it._tokens = [...new Set(tokenize(it.nome))];
    it._skip = it.categoria === 'ACESSORIOS' || COMPONENT_RE.test(norm(it.nome));
    for (const t of it._tokens) DF.set(t, (DF.get(t) || 0) + 1);
  }
  const N = raw.length;
  IDF = new Map();
  for (const [t, d] of DF) IDF.set(t, Math.log(N / d));
  CATALOG = raw;
  return CATALOG;
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
