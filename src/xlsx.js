/** Styled .xlsx export of the Negociando call list (two sheets: Leads + Resumo). */
import ExcelJS from 'exceljs';
import { neutralizeCell } from './sanitize.js';

const TEMP_FILL = {
  quente: 'FFFAD4D4',
  morno: 'FFFBEBC8',
  frio: 'FFDFE5EF',
};
const SIT_FILL = {
  Aberto: 'FFD6ECFB',
  Vendido: 'FFD3F0DE',
  Descartado: 'FFEEE0E0',
};

export async function buildWorkbook(result) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'ExtractNeoron';
  wb.created = new Date();

  const ws = wb.addWorksheet('Leads Negociando', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = [
    { header: 'Nome', key: 'nome', width: 24 },
    { header: 'Telefone', key: 'contato', width: 20 },
    { header: 'Situação', key: 'situacao', width: 12 },
    { header: 'Temperatura', key: 'temperatura', width: 13 },
    { header: 'Motivo (sinais)', key: 'motivos', width: 34 },
    { header: 'Produto', key: 'produto', width: 34 },
    { header: 'Preço', key: 'produtoPreco', width: 12 },
    { header: 'Atendente', key: 'atendente', width: 14 },
    { header: 'Nota IA', key: 'aiNota', width: 9 },
    { header: 'Cliente aguardando', key: 'aguardando', width: 12 },
    { header: 'Aguardando (min)', key: 'aguardandoMin', width: 16 },
    { header: '1ª resposta (min)', key: 'primeiraRespostaMin', width: 16 },
    { header: 'Resp. mediana (min)', key: 'respostaMedianaMin', width: 17 },
    { header: 'Feito', key: 'feito', width: 8 },
    { header: 'Motivo (desfecho)', key: 'feitoReasonLabel', width: 18 },
    { header: 'Justificativa', key: 'feitoNota', width: 34 },
    { header: 'Concluído por', key: 'feitoPor', width: 22 },
    { header: 'Última interação', key: 'ultimaInteracao', width: 20 },
    { header: 'Contexto', key: 'contexto', width: 46 },
    { header: 'Tags', key: 'tags', width: 26 },
    { header: 'Conversation ID', key: 'conversationId', width: 26 },
  ];

  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E2A44' } };
  head.alignment = { vertical: 'middle' };
  head.height = 20;

  for (const r of result.rows) {
    const row = ws.addRow({
      ...r,
      nome: neutralizeCell(r.nome),
      contato: neutralizeCell(r.contato),
      produto: neutralizeCell(r.produto),
      atendente: neutralizeCell(r.atendente),
      contexto: neutralizeCell(r.contexto),
      temperatura: cap(r.temperatura),
      motivos: neutralizeCell((r.motivos || []).join(', ')),
      aguardando: r.aguardando ? 'Sim' : '',
      feito: r.feito ? 'Sim' : '',
      feitoNota: neutralizeCell(r.feitoNota),
      feitoPor: neutralizeCell(r.feitoPor),
      aiNota: typeof r.aiNota === 'number' ? r.aiNota : null,
      tags: neutralizeCell((r.tags || []).join(', ')),
      produtoPreco: r.produtoPreco || null,
      ultimaInteracao: r.ultimaInteracao ? new Date(r.ultimaInteracao) : null,
    });
    fillCell(row.getCell('temperatura'), TEMP_FILL[r.temperatura]);
    fillCell(row.getCell('situacao'), SIT_FILL[r.situacao]);
    row.getCell('produtoPreco').numFmt = 'R$ #,##0.00';
    row.getCell('ultimaInteracao').numFmt = 'dd/mm/yyyy hh:mm';
    if (r.feito) row.font = { color: { argb: 'FF9AA3B2' }, strike: true };
    row.getCell('contexto').alignment = { wrapText: false };
  }
  ws.autoFilter = { from: 'A1', to: 'U1' };

  // Resumo sheet
  const rs = wb.addWorksheet('Resumo');
  rs.columns = [{ header: 'Métrica', key: 'k', width: 30 }, { header: 'Valor', key: 'v', width: 18 }];
  rs.getRow(1).font = { bold: true };
  const s = result.situacao || {}, t = result.temperatura || {};
  const lines = [
    ['Gerado em', new Date(result.generatedAt).toLocaleString('pt-BR')],
    ['Conta', result.account],
    ['Conversas varridas', result.conversationsScanned],
    ...(result.filtered
      ? [['Exportados (filtro atual)', result.count], ['Total em Negociando', result.totalCarteira]]
      : [['Total em Negociando', result.count]]),
    ['— Abertos', s.abertos], ['— Vendidos', s.vendidos], ['— Descartados', s.descartados],
    ['Quentes', t.quentes], ['Mornos', t.mornos], ['Frios', t.frios],
    ['Clientes aguardando', result.aguardando],
    ['Aguardando +24h (fila)', result.aguardando24h],
    ['Marcados como Feito', result.feitos],
  ];
  lines.forEach((l) => rs.addRow({ k: l[0], v: l[1] }));

  return wb;
}

function fillCell(cell, argb) {
  if (argb) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } };
}
function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
