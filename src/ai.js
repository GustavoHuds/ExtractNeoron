/** Nota IA (0-10) do atendimento do vendedor, por conversa.
 *
 * Usa a API da Anthropic (Claude Haiku por padrão) com um transcript compacto
 * para gastar o mínimo de tokens. A nota é cacheada por conversa + timestamp da
 * última mensagem em data/ai-scores.json: só re-avalia quando o chat mudou.
 * Sem ANTHROPIC_API_KEY o recurso fica desligado (retorna null).
 */
import fs from 'node:fs';
import Anthropic from '@anthropic-ai/sdk';
import { config, AI_SCORES_FILE, ensureDirs } from './config.js';
import { pruneOldEntries } from './store.js';

export const aiEnabled = () => !!config.anthropicKey;

let client = null;
function getClient() {
  if (!client) client = new Anthropic({ apiKey: config.anthropicKey });
  return client;
}

function loadScores() {
  try { return JSON.parse(fs.readFileSync(AI_SCORES_FILE, 'utf8')); }
  catch { return {}; }
}

/** Compact the normalized transcript ({sender, text}) into few tokens:
 * last messages only, each line capped, total capped (keeps the tail). */
export function compactTranscript(messages, { maxMsgs = 40, maxMsgChars = 160, maxChars = 5000 } = {}) {
  const ROLE = { user: 'Cliente', agent: 'Vendedor', bot: 'Bot' };
  const lines = [];
  for (const m of messages.slice(-maxMsgs)) {
    const text = String(m.text || '').trim();
    if (!text) continue;
    lines.push(`${ROLE[m.sender] || 'Bot'}: ${text.length > maxMsgChars ? text.slice(0, maxMsgChars - 1) + '…' : text}`);
  }
  let out = lines.join('\n');
  if (out.length > maxChars) out = out.slice(out.length - maxChars);
  return out;
}

const SYSTEM = 'Você avalia a qualidade do atendimento de VENDEDORES em conversas (WhatsApp/Instagram) de uma loja de móveis e colchões. '
  + 'Dê uma nota de 0 a 10 para o atendimento do vendedor até este momento, considerando: presença e rapidez nas respostas, '
  + 'clareza das informações, proatividade (ofertas, follow-up, fechamento) e cordialidade. '
  + 'Ignore a decisão do cliente — avalie só o vendedor. 0-3 péssimo (cliente ignorado), 4-6 regular, 7-8 bom, 9-10 excelente. '
  + 'Seja rigoroso. O "motivo" deve ter no máximo 12 palavras, em português.';

const OUTPUT_SCHEMA = {
  type: 'json_schema',
  schema: {
    type: 'object',
    properties: {
      nota: { type: 'integer', description: 'Nota do atendimento, de 0 a 10.' },
      motivo: { type: 'string', description: 'Justificativa curtíssima (máx. 12 palavras).' },
    },
    required: ['nota', 'motivo'],
    additionalProperties: false,
  },
};

/** One API call: transcript in, { nota, motivo } out. Throws on API failure. */
async function requestScore(transcript) {
  const res = await getClient().messages.create({
    model: config.aiModel,
    max_tokens: 200,
    system: SYSTEM,
    messages: [{ role: 'user', content: `Conversa (mais recente por último):\n${transcript}` }],
    output_config: { format: OUTPUT_SCHEMA },
  });
  const text = res.content.find((b) => b.type === 'text')?.text || '{}';
  const parsed = JSON.parse(text);
  const nota = Math.max(0, Math.min(10, Math.round(Number(parsed.nota))));
  if (Number.isNaN(nota)) return null;
  return { nota, motivo: String(parsed.motivo || '').slice(0, 140) };
}

/**
 * Per-extraction scorer: loads the cache once, scores only conversations whose
 * last message changed, and flushes the cache once at the end (safe under the
 * extractor's concurrent enrichment).
 */
export function createScorer() {
  const map = loadScores();
  let dirty = false;
  return {
    /** @param row lead row (conversationId + ultimaInteracaoMs)
     *  @param messages normalized transcript [{sender, text}] — null returns
     *  whatever is cached (unchanged conversations skip the fetch entirely). */
    async score(row, messages) {
      if (!aiEnabled()) return null;
      const key = row.conversationId;
      const lastMs = row.ultimaInteracaoMs || 0;
      const cached = map[key];
      if (cached && cached.lastMs === lastMs) return cached;
      if (!messages) return cached || null;
      // Sem mensagem humana do vendedor não há atendimento a avaliar.
      if (!messages.some((m) => m.sender === 'agent')) return cached || null;
      try {
        const s = await requestScore(compactTranscript(messages));
        if (!s) return cached || null;
        map[key] = { ...s, lastMs, at: new Date().toISOString() };
        dirty = true;
        return map[key];
      } catch (e) {
        console.error(`nota IA (${key}):`, e.message || e);
        return cached || null;
      }
    },
    flush() {
      if (!dirty) return;
      ensureDirs();
      fs.writeFileSync(AI_SCORES_FILE, JSON.stringify(pruneOldEntries(map, config.doneRetentionDays)));
      dirty = false;
    },
  };
}
