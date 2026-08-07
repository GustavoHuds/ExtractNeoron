/**
 * Product detection for Lojas Belmont chats (furniture / mattress domain).
 * Scans a conversation transcript and returns which product(s) are being
 * negotiated, based on category keywords + size qualifiers + model names cited.
 *
 * Extend PRODUCT_RULES freely — order does not matter (results rank by mentions).
 */

// category regex -> canonical label. Specific patterns first is fine but not required.
export const PRODUCT_RULES = [
  { re: /\bconjunto\s+box\b/i, label: 'Conjunto box' },
  { re: /\bbox\s+ba[uú]\b/i, label: 'Box baú' },
  { re: /\bbicama\b/i, label: 'Bicama' },
  { re: /\bcolch[aã]o\b/i, label: 'Colchão' },
  { re: /\bcabeceira\b/i, label: 'Cabeceira' },
  { re: /\bguarda[\s-]?roupa\b/i, label: 'Guarda-roupa' },
  { re: /\bcriado[\s-]?mudo\b/i, label: 'Criado-mudo' },
  { re: /\bc[oôó]moda\b/i, label: 'Cômoda' },
  { re: /\bbeliche\b/i, label: 'Beliche' },
  { re: /\bpoltrona\b/i, label: 'Poltrona' },
  { re: /\bsof[aá]\b/i, label: 'Sofá' },
  { re: /\bber[çc]o\b/i, label: 'Berço' },
  { re: /\bguarda[\s-]?lou[çc]a\b/i, label: 'Guarda-louça' },
  { re: /\bpainel\b/i, label: 'Painel' },
  { re: /\brack\b/i, label: 'Rack' },
  { re: /\bmesa\b/i, label: 'Mesa' },
  { re: /\bcadeira\b/i, label: 'Cadeira' },
  { re: /\btravesseiro\b/i, label: 'Travesseiro' },
  { re: /\bbase\s+ba[uú]\b/i, label: 'Base baú' },
  { re: /\bcama\b/i, label: 'Cama' }, // generic, kept last
];

const SIZE_RE = /\b(super\s?king|king\s?size|king|queen\s?size|queen|casal|solteir[oa]|vi[uú]v[oa])\b/i;

// tokens that look like a model but are really attributes/filler — never a model.
const MODEL_STOP = new Set([
  'BOX', 'BAU', 'BAÚ', 'QUEEN', 'KING', 'CASAL', 'SOLTEIRO', 'SOLTEIRA', 'VIUVA', 'VIÚVA',
  'FICA', 'SEM', 'JUROS', 'ATE', 'ATÉ', 'COM', 'MAIS', 'CONTA', 'MOLAS', 'ENSACADAS',
  'ESPUMA', 'BASE', 'CONJUNTO', 'CAMA', 'GRATIS', 'GRÁTIS', 'ENTRADA', 'LINK', 'REAIS',
]);

function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : s; }

/** Try to capture a model/collection name near a "conjunto ... NAME" mention. */
function findModels(text) {
  const models = new Set();
  const re = /\bconjunto\b([^.!?\n]{0,45})/gi;
  let m;
  while ((m = re.exec(text))) {
    const seg = m[1];
    const tokRe = /\b([A-ZÀ-Ú][a-zà-ú]{3,}|[A-ZÀ-Ú]{4,})\b/g;
    let t;
    while ((t = tokRe.exec(seg))) {
      const up = t[1].toUpperCase();
      if (!MODEL_STOP.has(up)) models.add(cap(t[1]));
    }
  }
  return [...models].slice(0, 3);
}

/**
 * @param {string} transcript full conversation text (user + agent)
 * @returns {{ produto: string, itens: Array<{label:string,count:number,snippet:string}>, modelos: string[] }}
 */
export function detectProducts(transcript) {
  const text = transcript || '';
  const found = new Map();
  for (const rule of PRODUCT_RULES) {
    const re = new RegExp(rule.re.source, 'gi');
    let m;
    while ((m = re.exec(text))) {
      const idx = m.index;
      const win = text.slice(Math.max(0, idx - 30), idx + 55);
      const size = (win.match(SIZE_RE) || [])[0];
      const cur = found.get(rule.label) || { label: rule.label, count: 0, size: null, snippet: win.replace(/\s+/g, ' ').trim() };
      cur.count++;
      if (size && !cur.size) cur.size = size.replace(/\s+/g, ' ').toLowerCase();
      found.set(rule.label, cur);
    }
  }

  let itens = [...found.values()].sort((a, b) => b.count - a.count);
  // Drop generic "Cama" when a more specific bedding product is present.
  if (itens.some((i) => ['Conjunto box', 'Colchão', 'Box baú'].includes(i.label))) {
    itens = itens.filter((i) => i.label !== 'Cama');
  }

  const modelos = findModels(text);
  const labelWithSize = (i) => i.size ? `${i.label} ${i.size}` : i.label;
  const top = itens.slice(0, 2).map(labelWithSize);
  let produto = top.join('; ');
  if (produto && modelos.length && /conjunto|colch|box/i.test(produto)) {
    produto += ` — ${modelos[0]}`;
  }
  return { produto: produto || '', itens, modelos };
}
