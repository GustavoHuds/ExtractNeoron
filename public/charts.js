/** Tiny SVG chart helpers — no dependencies. */
(function () {
  const NS = 'http://www.w3.org/2000/svg';

  /** Line chart with area fill. points: [{x-label, value|null}] */
  function lineChart(points, { width = 520, height = 200, stroke = '#1D3E6E', label = '' } = {}) {
    const vals = points.map((p) => p.value).filter((v) => v != null);
    if (!vals.length) return `<div class="m-note">Sem dados suficientes ainda.</div>`;
    const max = Math.max(...vals, 1);
    const padL = 34, padR = 20, padT = 16, padB = 22;
    const iw = width - padL - padR, ih = height - padT - padB;
    const stepX = points.length > 1 ? iw / (points.length - 1) : 0;
    const y = (v) => padT + ih - (v / max) * ih;
    const pts = points.map((p, i) => p.value == null ? null : `${padL + i * stepX},${y(p.value)}`).filter(Boolean);
    const dots = points.map((p, i) => p.value == null ? '' :
      `<circle cx="${padL + i * stepX}" cy="${y(p.value)}" r="${i === points.length - 1 ? 5 : 3.5}" fill="${stroke}"></circle>`).join('');
    const lastIdx = points.length - 1;
    const lastVal = points[lastIdx]?.value;
    const gridLines = [0.25, 0.5, 0.75].map((f) =>
      `<line x1="${padL}" y1="${padT + ih * f}" x2="${width - padR}" y2="${padT + ih * f}" stroke="#EAE2D2" stroke-width="1"></line>`).join('');
    const xLabels = points.map((p, i) => (i % 2 === 0 || i === lastIdx)
      ? `<text x="${padL + i * stepX}" y="${height - 4}" text-anchor="middle" font-size="10" fill="#6B6355" font-family="Archivo">${esc(p.label)}</text>` : '').join('');
    return `<svg viewBox="0 0 ${width} ${height}" style="width:100%;height:auto" role="img" aria-label="${esc(label)}">
      ${gridLines}
      <line x1="${padL}" y1="${padT + ih}" x2="${width - padR}" y2="${padT + ih}" stroke="#CFC5B0" stroke-width="1.5"></line>
      ${pts.length > 1 ? `<polygon points="${pts.join(' ')} ${padL + lastIdx * stepX},${padT + ih} ${padL},${padT + ih}" fill="rgba(29,62,110,.08)"></polygon>
      <polyline points="${pts.join(' ')}" fill="none" stroke="${stroke}" stroke-width="2.5" stroke-linecap="round"></polyline>` : ''}
      ${dots}
      ${lastVal != null ? `<text x="${padL + lastIdx * stepX}" y="${y(lastVal) - 12}" text-anchor="middle" font-size="12" font-weight="800" fill="#0A1F3C" font-family="Archivo">${lastVal} min</text>` : ''}
      ${xLabels}
    </svg>`;
  }

  /** Inline sparkline for table rows. */
  function sparkline(values, { width = 120, height = 28 } = {}) {
    const max = Math.max(...values, 1);
    const stepX = values.length > 1 ? (width - 8) / (values.length - 1) : 0;
    const pts = values.map((v, i) => `${4 + i * stepX},${height - 6 - (v / max) * (height - 12)}`).join(' ');
    const first = values[0] || 0, last = values[values.length - 1] || 0;
    const color = last > first ? '#2F6E4F' : last < first ? '#A63A2B' : '#CFC5B0';
    return `<svg viewBox="0 0 ${width} ${height}" style="width:${width}px;height:${height}px;justify-self:end">
      <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round"></polyline></svg>`;
  }

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  window.Charts = { lineChart, sparkline };
})();
