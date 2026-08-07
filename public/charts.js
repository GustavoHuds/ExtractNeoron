// Hand-drawn SVG charts: readable labels, axes, gridlines, value labels. No deps.
const esc = (s) => String(s ?? '').replace(/[&<>"'`]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' }[c]));

const NS_TEXT = 'font-family:Inter,Segoe UI,system-ui,sans-serif';

/** Vertical bars with y-gridlines + value labels. rows: [{label, value}] */
export function barChart(rows, { color = 'var(--accent)', fmt = (v) => v, unit = '' } = {}) {
  const W = 860, H = 300, L = 46, R = 14, T = 20, B = 46;
  if (!rows.length) return '<p class="hint">Sem dados.</p>';
  const max = Math.max(1, ...rows.map((r) => r.value || 0));
  const iw = W - L - R, ih = H - T - B;
  const bw = iw / rows.length;
  const ticks = 4;
  let grid = '';
  for (let i = 0; i <= ticks; i++) {
    const v = (max / ticks) * i, y = T + ih - (ih * i) / ticks;
    grid += `<line x1="${L}" y1="${y}" x2="${W - R}" y2="${y}" stroke="var(--border)" stroke-width="1"/>`
      + `<text x="${L - 8}" y="${y + 4}" text-anchor="end" fill="var(--muted)" font-size="12" style="${NS_TEXT}">${fmt(Math.round(v))}</text>`;
  }
  const step = Math.ceil(rows.length / 14) || 1;
  const bars = rows.map((r, i) => {
    const bh = ih * ((r.value || 0) / max);
    const x = L + i * bw, y = T + ih - bh;
    const cx = x + bw / 2;
    const lbl = i % step === 0 ? `<text x="${cx}" y="${H - B + 18}" text-anchor="middle" fill="var(--muted)" font-size="12" style="${NS_TEXT}">${esc(r.label)}</text>` : '';
    const val = bh > 18 ? `<text x="${cx}" y="${y - 6}" text-anchor="middle" fill="var(--text-2)" font-size="12" style="${NS_TEXT}">${fmt(r.value)}</text>` : '';
    return `<rect x="${x + 3}" y="${y}" width="${Math.max(1, bw - 6)}" height="${bh}" rx="3" fill="${color}"><title>${esc(r.label)}: ${fmt(r.value)}${unit}</title></rect>${val}${lbl}`;
  }).join('');
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img">${grid}${bars}</svg>`;
}

/** Line chart. rows: [{label, value}] (value may be null → skipped) */
export function lineChart(rows, { color = 'var(--warm)', fmt = (v) => v } = {}) {
  const W = 860, H = 300, L = 46, R = 14, T = 20, B = 46;
  const pts = rows.filter((r) => r.value != null);
  if (pts.length < 2) return '<p class="hint">Amostra insuficiente.</p>';
  const max = Math.max(1, ...pts.map((r) => r.value));
  const iw = W - L - R, ih = H - T - B;
  const X = (i) => L + iw * (i / (pts.length - 1));
  const Y = (v) => T + ih - ih * (v / max);
  const ticks = 4; let grid = '';
  for (let i = 0; i <= ticks; i++) {
    const v = (max / ticks) * i, y = T + ih - (ih * i) / ticks;
    grid += `<line x1="${L}" y1="${y}" x2="${W - R}" y2="${y}" stroke="var(--border)" stroke-width="1"/>`
      + `<text x="${L - 8}" y="${y + 4}" text-anchor="end" fill="var(--muted)" font-size="12" style="${NS_TEXT}">${fmt(Math.round(v))}</text>`;
  }
  const line = pts.map((r, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(r.value).toFixed(1)}`).join(' ');
  const dots = pts.map((r, i) => `<circle cx="${X(i).toFixed(1)}" cy="${Y(r.value).toFixed(1)}" r="3.5" fill="${color}"><title>${esc(r.label)}: ${fmt(r.value)}</title></circle>`).join('');
  const step = Math.ceil(pts.length / 12) || 1;
  const labels = pts.map((r, i) => i % step === 0 ? `<text x="${X(i)}" y="${H - B + 18}" text-anchor="middle" fill="var(--muted)" font-size="12" style="${NS_TEXT}">${esc(r.label)}</text>` : '').join('');
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img">${grid}<path d="${line}" fill="none" stroke="${color}" stroke-width="2.5"/>${dots}${labels}</svg>`;
}

/** Horizontal bars. items: [{label, value, color?}] */
export function hbars(items, { fmt = (v) => v } = {}) {
  if (!items.length) return '<p class="hint">Sem dados.</p>';
  const max = Math.max(1, ...items.map((i) => i.value));
  return `<div class="hbars">` + items.map((it) => `
    <div class="bar-row">
      <div class="bar-label" title="${esc(it.label)}">${esc(it.label)}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${(it.value / max * 100).toFixed(1)}%;background:${it.color || 'var(--accent)'}"></div></div>
      <div class="bar-val">${fmt(it.value)}</div>
    </div>`).join('') + `</div>`;
}
