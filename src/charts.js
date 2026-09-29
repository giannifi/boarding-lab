/* Boarding Lab — tiny dependency-free SVG charts */
(function (root) {
  'use strict';
  const BS = (root.BS = root.BS || {});
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const niceStep = (range, target) => {
    const raw = range / Math.max(1, target);
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const n = raw / mag;
    return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * mag;
  };
  // Row labels: margin sized to the longest label (≈6.6 px/char at 12 px), capped at 42% of the width;
  // labels that still don't fit are truncated with an ellipsis and keep the full name as a tooltip.
  const CHAR_W = 6.6;
  const labelMargin = (rows, W) => Math.round(Math.max(70, Math.min(W * 0.42, Math.max(...rows.map((r) => r.name.length)) * CHAR_W + 18)));
  const labelText = (name, x, y, maxW) => {
    const maxChars = Math.max(4, Math.floor(maxW / CHAR_W));
    const shown = name.length > maxChars ? name.slice(0, maxChars - 1).trimEnd() + '…' : name;
    return `<text x="${x}" y="${y}" text-anchor="end" class="label"><title>${esc(name)}</title>${esc(shown)}</text>`;
  };

  const timeStep = (range, target) => {
    const steps = [30, 60, 120, 180, 300, 600, 900, 1200, 1800];
    const raw = range / Math.max(1, target);
    return steps.find((s) => s >= raw) || 3600;
  };

  /**
   * Line chart.
   * series: [{ name, color, points: [[x,y],...], dash? }]
   */
  BS.lineChart = function (o) {
    const W = o.width || 560, H = o.height || 220;
    const m = { l: 44, r: 12, t: 12, b: 26 };
    const xMax = o.xMax || Math.max(1, ...o.series.flatMap((s) => s.points.map((p) => p[0])));
    const xMin = o.xMin || 0;
    const yMax = o.yMax != null ? o.yMax : Math.max(1, ...o.series.flatMap((s) => s.points.map((p) => p[1])));
    const yMin = o.yMin || 0;
    const X = (x) => m.l + ((x - xMin) / (xMax - xMin || 1)) * (W - m.l - m.r);
    const Y = (y) => H - m.b - ((y - yMin) / (yMax - yMin || 1)) * (H - m.t - m.b);
    const nx = Math.max(3, Math.min(8, Math.floor(W / 80)));
    const xStep = o.xTime ? timeStep(xMax - xMin, nx) : niceStep(xMax - xMin, nx);
    const yStep = niceStep(yMax - yMin, 4);
    let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(o.label || 'chart')}">`;
    for (let y = Math.ceil(yMin / yStep) * yStep; y <= yMax + 1e-9; y += yStep) {
      s += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(y)}" y2="${Y(y)}" class="grid"/>`;
      s += `<text x="${m.l - 6}" y="${Y(y) + 3}" text-anchor="end" class="tick">${esc(o.yFmt ? o.yFmt(y) : y)}</text>`;
    }
    for (let x = Math.ceil(xMin / xStep) * xStep; x <= xMax + 1e-9; x += xStep) {
      s += `<text x="${X(x)}" y="${H - 8}" text-anchor="middle" class="tick">${esc(o.xFmt ? o.xFmt(x) : x)}</text>`;
    }
    for (const se of o.series) {
      if (!se.points.length) continue;
      const d = se.points.map((p, i) => `${i ? 'L' : 'M'}${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join('');
      s += `<path d="${d}" fill="none" stroke="${se.color}" stroke-width="${se.width || 2}" stroke-linejoin="round" stroke-linecap="round" ${se.dash ? 'stroke-dasharray="4 3"' : ''}/>`;
      if (o.dots) for (const p of se.points) s += `<circle cx="${X(p[0])}" cy="${Y(p[1])}" r="3" fill="${se.color}"/>`;
    }
    if (o.cursor != null) s += `<line x1="${X(o.cursor)}" x2="${X(o.cursor)}" y1="${m.t}" y2="${H - m.b}" class="cursor"/>`;
    if (o.hline != null) s += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(o.hline)}" y2="${Y(o.hline)}" class="target"/>`;
    s += '</svg>';
    return s;
  };

  /**
   * Horizontal box plot: whiskers p10–p90, box p25–p75, line median, dot mean.
   * rows: [{ name, color, stats }]
   */
  BS.boxPlot = function (o) {
    const rows = o.rows;
    const W = Math.max(280, o.width || 640), rowH = 32;
    const m = { l: labelMargin(rows, W), r: 14, t: 8, b: 26 };
    const H = m.t + m.b + rows.length * rowH;
    const lo = Math.min(...rows.map((r) => r.stats.min));
    const hi = Math.max(...rows.map((r) => r.stats.max));
    const pad = (hi - lo) * 0.06 || 30;
    const xMin = Math.max(0, lo - pad), xMax = hi + pad;
    const X = (x) => m.l + ((x - xMin) / (xMax - xMin)) * (W - m.l - m.r);
    const step = timeStep(xMax - xMin, Math.max(3, Math.min(8, Math.floor((W - m.l) / 70))));
    let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Boarding time distribution">`;
    for (let x = Math.ceil(xMin / step) * step; x <= xMax; x += step) {
      s += `<line x1="${X(x)}" x2="${X(x)}" y1="${m.t}" y2="${H - m.b}" class="grid"/>`;
      s += `<text x="${X(x)}" y="${H - 8}" text-anchor="middle" class="tick">${BS.fmtTime(x)}</text>`;
    }
    if (o.target) s += `<line x1="${X(o.target)}" x2="${X(o.target)}" y1="${m.t}" y2="${H - m.b}" class="target"/>`;
    rows.forEach((r, i) => {
      const y = m.t + i * rowH + rowH / 2;
      const st = r.stats;
      s += labelText(r.name, m.l - 12, y + 4, m.l - 16);
      s += `<line x1="${X(st.p10)}" x2="${X(st.p90)}" y1="${y}" y2="${y}" stroke="${r.color}" stroke-width="1.5"/>`;
      s += `<line x1="${X(st.p10)}" x2="${X(st.p10)}" y1="${y - 6}" y2="${y + 6}" stroke="${r.color}" stroke-width="1.5"/>`;
      s += `<line x1="${X(st.p90)}" x2="${X(st.p90)}" y1="${y - 6}" y2="${y + 6}" stroke="${r.color}" stroke-width="1.5"/>`;
      s += `<rect x="${X(st.p25)}" y="${y - 10}" width="${Math.max(2, X(st.p75) - X(st.p25))}" height="20" rx="4" fill="${r.color}" fill-opacity="0.18" stroke="${r.color}" stroke-width="1.5"/>`;
      s += `<line x1="${X(st.p50)}" x2="${X(st.p50)}" y1="${y - 10}" y2="${y + 10}" stroke="${r.color}" stroke-width="2.5"/>`;
      s += `<circle cx="${X(st.mean)}" cy="${y}" r="3" fill="var(--surface)" stroke="${r.color}" stroke-width="1.5"/>`;
      // jittered raw samples
      if (st.values.length <= 400) {
        const rnd = BS.rng(i + 1);
        for (const v of st.values) s += `<circle cx="${X(v).toFixed(1)}" cy="${(y + (rnd() - 0.5) * 16).toFixed(1)}" r="1.2" fill="${r.color}" fill-opacity="0.35"/>`;
      }
    });
    s += '</svg>';
    return s;
  };

  /** Simple horizontal bars (value per row). */
  BS.barChart = function (o) {
    const rows = o.rows;
    const W = Math.max(240, o.width || 360), rowH = 26, m = { l: labelMargin(rows, W), r: 48, t: 4, b: 4 };
    const H = m.t + m.b + rows.length * rowH;
    const max = Math.max(1e-9, ...rows.map((r) => r.value));
    let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(o.label || 'bars')}">`;
    rows.forEach((r, i) => {
      const y = m.t + i * rowH;
      const w = ((W - m.l - m.r) * r.value) / max;
      s += labelText(r.name, m.l - 8, y + rowH / 2 + 4, m.l - 12);
      s += `<rect x="${m.l}" y="${y + 5}" width="${Math.max(2, w)}" height="${rowH - 10}" rx="4" fill="${r.color}"/>`;
      s += `<text x="${m.l + w + 6}" y="${y + rowH / 2 + 4}" class="value">${esc(o.fmt ? o.fmt(r.value) : r.value)}</text>`;
    });
    return s + '</svg>';
  };
})(typeof window !== 'undefined' ? window : globalThis);
