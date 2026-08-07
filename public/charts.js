// Hand-drawn SVG charts: readable labels, axes, gridlines, value labels. No deps.
// Colors are RESOLVED from CSS variables to real values because var() does not
// work inside SVG presentation attributes; font sizes use inline style so the
// global `svg text {}` rule can't shrink them.
const esc = (s) => String(s ?? '').replace(/[&<>"'`]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' }[c]));
const FONT = 'font-family:Inter,Segoe UI,system-ui,sans-serif';

function cssVar(name, fallback) {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  } catch { return fallback; }
}
function resolveColor(c) {
  if (typeof c === 'string' && c.startsWith('var(')) return cssVar(c.slice(4, -1).trim(), '#8ab4ff');
  return c || '#8ab4ff';
}
function palette() {
  return { muted: cssVar('--muted', '#838d9e'), text2: cssVar('--text-2', '#b9c0cd'), border: cssVar('--border', '#232a3a') };
}
function txt(x, y, s, { anchor = 'middle', size = 12, color = '#999' } = {}) {
  return `<text x="${x}" y="${y}" text-anchor="${anchor}" style="font-size:${size}px;fill:${color};${FONT}">${s}</text>`;
}
const num = (v) => (typeof v === 'number' ? v : 0);

/** Vertical bars with y-gridlines + value labels. rows: [{label, value}] */
export function barChart(rows, { color = 'var(--accent)', fmt = (v) => v, unit = '' } = {}) {
  const W = 860, H = 300, L = 48, R = 14, T = 22, B = 46;
  if (!rows.length) return '<p class="hint">Sem dados.</p>';
  const P = palette(), col = resolveColor(color);
  const max = Math.max(1, ...rows.map((r) => num(r.value)));
  const iw = W - L - R, ih = H - T - B, bw = iw / rows.length;
  let grid = '';
  const ticks = 4;
  for (let i = 0; i <= ticks; i++) {
    const v = (max / ticks) * i, y = T + ih - (ih * i) / ticks;
    grid += `<line x1="${L}" y1="${y}" x2="${W - R}" y2="${y}" style="stroke:${P.border};stroke-width:1"/>`
      + txt(L - 8, y + 4, esc(String(fmt(Math.round(v)))), { anchor: 'end', color: P.muted });
  }
  const step = Math.ceil(rows.length / 14) || 1;
  const bars = rows.map((r, i) => {
    const bh = ih * (num(r.value) / max);
    const x = L + i * bw, y = T + ih - bh, cx = x + bw / 2;
    const lbl = i % step === 0 ? txt(cx, H - B + 18, esc(r.label), { color: P.muted }) : '';
    const val = bh > 18 ? txt(cx, y - 6, esc(String(fmt(r.value))), { color: P.text2 }) : '';
    return `<rect x="${x + 3}" y="${y}" width="${Math.max(1, bw - 6)}" height="${bh}" rx="3" style="fill:${col}"><title>${esc(r.label)}: ${esc(String(fmt(r.value)))}${esc(unit)}</title></rect>${val}${lbl}`;
  }).join('');
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img">${grid}${bars}</svg>`;
}

/** Line chart. rows: [{label, value}] (value may be null → skipped) */
export function lineChart(rows, { color = 'var(--warm)', fmt = (v) => v } = {}) {
  const W = 860, H = 300, L = 48, R = 14, T = 22, B = 46;
  const pts = rows.filter((r) => r.value != null);
  if (pts.length < 2) return '<p class="hint">Amostra insuficiente.</p>';
  const P = palette(), col = resolveColor(color);
  const max = Math.max(1, ...pts.map((r) => r.value));
  const iw = W - L - R, ih = H - T - B;
  const X = (i) => L + iw * (i / (pts.length - 1));
  const Y = (v) => T + ih - ih * (v / max);
  let grid = '';
  const ticks = 4;
  for (let i = 0; i <= ticks; i++) {
    const v = (max / ticks) * i, y = T + ih - (ih * i) / ticks;
    grid += `<line x1="${L}" y1="${y}" x2="${W - R}" y2="${y}" style="stroke:${P.border};stroke-width:1"/>`
      + txt(L - 8, y + 4, esc(String(fmt(Math.round(v)))), { anchor: 'end', color: P.muted });
  }
  const line = pts.map((r, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(r.value).toFixed(1)}`).join(' ');
  const dots = pts.map((r, i) => `<circle cx="${X(i).toFixed(1)}" cy="${Y(r.value).toFixed(1)}" r="3.5" style="fill:${col}"><title>${esc(r.label)}: ${esc(String(fmt(r.value)))}</title></circle>`).join('');
  const step = Math.ceil(pts.length / 12) || 1;
  const labels = pts.map((r, i) => i % step === 0 ? txt(X(i), H - B + 18, esc(r.label), { color: P.muted }) : '').join('');
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img">${grid}<path d="${line}" fill="none" style="stroke:${col};stroke-width:2.5"/>${dots}${labels}</svg>`;
}

/** Multi-series line chart. series: [{label, color, points:[{label,value}]}] — points aligned by index. */
export function multiLineChart(series, { fmt = (v) => v } = {}) {
  const W = 860, H = 300, L = 48, R = 14, T = 16, B = 46;
  const cleaned = (series || []).map((s) => ({ label: s.label, color: resolveColor(s.color), pts: s.points || [] }));
  const len = Math.max(0, ...cleaned.map((s) => s.pts.length));
  const allVals = cleaned.flatMap((s) => s.pts.map((p) => p.value).filter((v) => v != null));
  if (len < 2 || allVals.length < 2) return '<p class="hint">Amostra insuficiente. O histórico acumula a cada extração.</p>';
  const P = palette();
  const max = Math.max(1, ...allVals);
  const iw = W - L - R, ih = H - T - B;
  const X = (i) => L + iw * (i / (len - 1));
  const Y = (v) => T + ih - ih * (v / max);
  let grid = '';
  const ticks = 4;
  for (let i = 0; i <= ticks; i++) {
    const v = (max / ticks) * i, y = T + ih - (ih * i) / ticks;
    grid += `<line x1="${L}" y1="${y}" x2="${W - R}" y2="${y}" style="stroke:${P.border};stroke-width:1"/>`
      + txt(L - 8, y + 4, esc(String(fmt(Math.round(v)))), { anchor: 'end', color: P.muted });
  }
  const paths = cleaned.map((s) => {
    const pts = s.pts.map((p, i) => ({ i, v: p.value, label: p.label })).filter((p) => p.v != null);
    if (!pts.length) return '';
    const d = pts.map((p, k) => `${k ? 'L' : 'M'}${X(p.i).toFixed(1)},${Y(p.v).toFixed(1)}`).join(' ');
    const dots = pts.map((p) => `<circle cx="${X(p.i).toFixed(1)}" cy="${Y(p.v).toFixed(1)}" r="3" style="fill:${s.color}"><title>${esc(s.label)} · ${esc(p.label)}: ${esc(String(fmt(p.v)))}</title></circle>`).join('');
    return `<path d="${d}" fill="none" style="stroke:${s.color};stroke-width:2.5"/>${dots}`;
  }).join('');
  const longest = cleaned.reduce((a, b) => (b.pts.length > a.pts.length ? b : a), cleaned[0]);
  const step = Math.ceil(len / 12) || 1;
  const xlabels = longest.pts.map((p, i) => i % step === 0 ? txt(X(i), H - B + 18, esc(p.label), { color: P.muted }) : '').join('');
  const legend = `<div class="chart-legend">${cleaned.map((s) => `<span><i style="background:${s.color}"></i>${esc(s.label)}</span>`).join('')}</div>`;
  return `${legend}<svg viewBox="0 0 ${W} ${H}" width="100%" role="img">${grid}${paths}${xlabels}</svg>`;
}

/** Horizontal bars. items: [{label, value, color?}] */
export function hbars(items, { fmt = (v) => v } = {}) {
  if (!items || !items.length) return '<p class="hint">Sem dados.</p>';
  const max = Math.max(1, ...items.map((i) => num(i.value)));
  return `<div class="hbars">` + items.map((it) => `
    <div class="bar-row">
      <div class="bar-label" title="${esc(it.label)}">${esc(it.label)}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${(num(it.value) / max * 100).toFixed(1)}%;background:${it.color || 'var(--accent)'}"></div></div>
      <div class="bar-val">${esc(String(fmt(it.value)))}</div>
    </div>`).join('') + `</div>`;
}
