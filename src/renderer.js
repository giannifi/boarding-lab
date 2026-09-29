/* Boarding Lab — cabin renderer
 * ---------------------------------------------------------------
 * Draws one recorded simulation at an arbitrary time t (seconds) on a canvas.
 * Horizontal cabin, nose on the left. Playback is pure: the sim was recorded
 * up front, so scrubbing backwards and forwards is free.
 */
(function (root) {
  'use strict';
  const BS = (root.BS = root.BS || {});
  const S = BS.STATE;

  const css = (name, el) => getComputedStyle(el || document.documentElement).getPropertyValue(name).trim();

  const hexToRgb = (hex) => {
    const h = hex.replace('#', '');
    const v = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  };
  const mix = (a, b, f) => {
    const A = hexToRgb(a), B = hexToRgb(b);
    return `rgb(${Math.round(A[0] + (B[0] - A[0]) * f)},${Math.round(A[1] + (B[1] - A[1]) * f)},${Math.round(A[2] + (B[2] - A[2]) * f)})`;
  };

  // perceptual-ish sequential ramp for "boarding order" colouring
  const RAMP = ['#1E3A8A', '#2563EB', '#06B6D4', '#10B981', '#84CC16', '#EAB308', '#F97316', '#EF4444'];
  const ramp = (f) => {
    f = Math.max(0, Math.min(1, f)) * (RAMP.length - 1);
    const i = Math.min(RAMP.length - 2, Math.floor(f));
    return mix(RAMP[i], RAMP[i + 1], f - i);
  };
  BS.ramp = ramp;
  BS.GROUP_COLORS = ['#2563EB', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#06B6D4', '#EC4899', '#84CC16'];
  BS.PRE_COLOR = '#64748B';

  class CabinRenderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.res = null;
      this.binT = -1;
      this.readTheme();
    }

    readTheme() {
      this.theme = {
        fuselage: css('--cabin-fuselage') || '#fff',
        fuselageStroke: css('--cabin-stroke') || '#d0d5dd',
        aisle: css('--cabin-aisle') || '#f2f4f7',
        seat: css('--seat-empty') || '#e4e7ec',
        seatNone: css('--seat-none') || '#f2f4f7',
        text: css('--text-3') || '#98a2b3',
        walk: css('--agent-walk') || '#2563eb',
        blocked: css('--agent-blocked') || '#ef4444',
        stow: css('--agent-stow') || '#f59e0b',
        shuffle: css('--agent-shuffle') || '#a855f7',
        stand: css('--agent-stand') || '#f59e0b',
        incident: css('--agent-incident') || '#dc2626',
        bg: css('--surface') || '#fff',
      };
    }

    /** Attach a recorded result. */
    setResult(ac, res, strategy) {
      this.ac = ac;
      this.res = res;
      this.strategy = strategy;
      this.seatAgent = new Int32Array(ac.seats.length).fill(-1);
      if (res) res.agents.forEach((a) => { this.seatAgent[a.seatIdx] = a.id; });
      // compact group numbers → palette index (pre-boarders get their own neutral colour)
      const gs = res ? [...new Set(res.agents.filter((a) => !a.pre).map((a) => a.group))].sort((x, y) => x - y) : [];
      this.groupIdx = new Map(gs.map((g, i) => [g, i]));
      this.groupCount = gs.length;
      this.binFill = res ? new Float32Array(res.binCap.length) : null;
      this.binPtr = 0;
      this.binT = -1;
      this.layout();
    }

    layout() {
      const ac = this.ac;
      if (!ac) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const W = Math.max(320, this.canvas.parentElement.clientWidth);
      const nose = 34, tail = 22, padX = 10;
      const cellW = (W - nose - tail - padX * 2) / (ac.N + 2);
      const slotH = Math.max(7, Math.min(17, cellW * 0.78, 150 / ac.totalSlots + 6));
      const padTop = 16, padBottom = 18;
      const H = Math.round(padTop + ac.totalSlots * slotH + padBottom);
      this.g = { W, H, nose, tail, padX, cellW, slotH, padTop, x0: padX + nose };
      this.canvas.width = Math.round(W * dpr);
      this.canvas.height = Math.round(H * dpr);
      this.canvas.style.width = W + 'px';
      this.canvas.style.height = H + 'px';
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    cellX(c) { return this.g.x0 + c * this.g.cellW; }
    slotY(s) { return this.g.padTop + s * this.g.slotH; }

    /** Bin fill at time t (incremental forward, recompute on rewind). */
    updateBins(t) {
      const ev = this.res.binEvents;
      if (t < this.binT) { this.binFill.fill(0); this.binPtr = 0; }
      while (this.binPtr < ev.length && ev[this.binPtr].t <= t) {
        const e = ev[this.binPtr++];
        this.binFill[e.k] += e.u;
      }
      this.binT = t;
    }

    draw(t, opts) {
      opts = opts || {};
      const { ctx, ac, g, theme } = this;
      if (!ac) return;
      const res = this.res;
      ctx.clearRect(0, 0, g.W, g.H);

      // ---- fuselage
      const top = g.padTop - 7, bot = g.padTop + ac.totalSlots * g.slotH + 5;
      const xL = g.x0 - 4, xR = this.cellX(ac.N + 2) + 2;
      const mid = (top + bot) / 2, rad = (bot - top) / 2;
      ctx.beginPath();
      ctx.moveTo(xL, top);
      ctx.lineTo(xR - 8, top);
      ctx.quadraticCurveTo(xR + g.tail, top + 4, xR + g.tail, mid);
      ctx.quadraticCurveTo(xR + g.tail, bot - 4, xR - 8, bot);
      ctx.lineTo(xL, bot);
      ctx.bezierCurveTo(xL - g.nose * 0.9, bot, xL - g.nose, mid + rad * 0.35, xL - g.nose, mid);
      ctx.bezierCurveTo(xL - g.nose, mid - rad * 0.35, xL - g.nose * 0.9, top, xL, top);
      ctx.closePath();
      ctx.fillStyle = theme.fuselage;
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = theme.fuselageStroke;
      ctx.stroke();

      // ---- aisles
      ctx.fillStyle = theme.aisle;
      for (const s of ac.aisleSlots) ctx.fillRect(this.cellX(0), this.slotY(s) + 1, this.cellX(ac.N + 2) - this.cellX(0), g.slotH - 2);

      // ---- doors
      const doorCells = res ? res.doorCells : ac.doors.filter((d) => d.default).map((d) => ({ id: d.id, cell: d.cell }));
      ctx.font = '600 9px Inter, system-ui, sans-serif';
      ctx.textAlign = 'center';
      for (const d of doorCells) {
        const x = this.cellX(d.cell) + g.cellW / 2;
        ctx.fillStyle = css('--accent') || '#2563eb';
        ctx.fillRect(x - Math.max(4, g.cellW * 0.35), top - 3, Math.max(8, g.cellW * 0.7), 4);
        ctx.fillText(d.id, x, top - 6);
      }

      // ---- bins
      if (res && opts.bins !== false) {
        this.updateBins(t);
        const cells = res.cells;
        for (let lane = 0; lane < ac.lanes; lane++) {
          const aisleSlot = ac.aisleSlots[lane];
          for (let side = 0; side < 2; side++) {
            const y = side === 0 ? this.slotY(aisleSlot) - 1.5 : this.slotY(aisleSlot + 1) - 0.5;
            for (let r = 1; r <= ac.N; r++) {
              const k = (lane * 2 + side) * cells + r;
              const cap = res.binCap[k];
              if (cap <= 0) continue;
              const f = Math.min(1, this.binFill[k] / cap);
              if (f <= 0) continue;
              ctx.fillStyle = f >= 0.999 ? '#EF4444' : f > 0.7 ? '#F59E0B' : '#22C55E';
              ctx.globalAlpha = 0.35 + 0.65 * f;
              ctx.fillRect(this.cellX(r) + 1, y, (g.cellW - 2) * f, 2);
            }
          }
        }
        ctx.globalAlpha = 1;
      }

      // ---- seats
      const n = res ? res.n : 0;
      let frame = null, frame2 = null, ff = 0;
      if (res) {
        const fi = t / res.frameDt;
        const i0 = Math.max(0, Math.min(res.frames.length - 1, Math.floor(fi)));
        frame = res.frames[i0];
        frame2 = res.frames[Math.min(res.frames.length - 1, i0 + 1)];
        ff = Math.max(0, Math.min(1, fi - i0));
      }
      const mode = opts.colorBy || 'status';
      const accent = this.strategy ? this.strategy.color : '#2563eb';
      const sw = g.cellW - Math.max(1.5, g.cellW * 0.14);
      const sh = g.slotH - Math.max(1.5, g.slotH * 0.16);
      const rr = Math.min(3, sh * 0.25);
      for (const s of ac.seats) {
        const x = this.cellX(s.row) + (g.cellW - sw) / 2;
        const y = this.slotY(s.slot) + (g.slotH - sh) / 2;
        const aid = this.seatAgent[s.idx];
        let fill;
        let stroke = null;
        if (aid < 0) {
          fill = theme.seatNone;
          stroke = theme.seat;
        } else {
          const a = res.agents[aid];
          const st = frame.st[aid];
          const seated = st === S.SEATED || st === S.STANDING;
          const useRamp = mode === 'order' || (mode === 'group' && this.groupCount > 8);
          const base = useRamp ? ramp(a.order / Math.max(1, n - 1))
            : mode === 'group' ? (a.pre ? BS.PRE_COLOR : BS.GROUP_COLORS[this.groupIdx.get(a.group) % BS.GROUP_COLORS.length])
            : accent;
          if (seated) fill = base;
          else if (mode === 'status') fill = theme.seat;
          else { fill = base; ctx.globalAlpha = 0.22; }
          if (st === S.STANDING) stroke = theme.stand;
        }
        ctx.fillStyle = fill;
        roundRect(ctx, x, y, sw, sh, rr);
        ctx.fill();
        ctx.globalAlpha = 1;
        if (stroke) { ctx.lineWidth = aid < 0 ? 1 : 2; ctx.strokeStyle = stroke; ctx.stroke(); }
      }

      // ---- row labels
      ctx.fillStyle = theme.text;
      ctx.font = '500 9px Inter, system-ui, sans-serif';
      ctx.textAlign = 'center';
      const step = g.cellW < 14 ? 10 : 5;
      for (let r = 1; r <= ac.N; r++) {
        if (r === 1 || r % step === 0) ctx.fillText(String(r), this.cellX(r) + g.cellW / 2, bot + 11);
      }

      // ---- passengers in the aisle
      if (res) {
        const rad = Math.max(2.5, Math.min(g.slotH * 0.36, g.cellW * 0.36));
        for (let i = 0; i < n; i++) {
          const st = frame.st[i];
          if (st === S.QUEUED || st === S.SEATED || st === S.STANDING) continue;
          const a = res.agents[i];
          let p = frame.pos[i];
          const st2 = frame2.st[i];
          if (st2 !== S.QUEUED && st2 !== S.SEATED && st2 !== S.STANDING) p = p + (frame2.pos[i] - p) * ff;
          const x = this.cellX(p) + g.cellW / 2;
          const y = this.slotY(ac.aisleSlots[a.lane]) + g.slotH / 2;
          const c = st === S.BLOCKED ? theme.blocked : st === S.STOW ? theme.stow : st === S.SHUFFLE ? theme.shuffle
            : st === S.INCIDENT ? theme.incident : theme.walk;
          if (st === S.INCIDENT) { // halo so disruptions stand out
            ctx.beginPath();
            ctx.arc(x, y, rad * 1.9, 0, Math.PI * 2);
            ctx.fillStyle = c;
            ctx.globalAlpha = 0.18;
            ctx.fill();
            ctx.globalAlpha = 1;
          }
          ctx.beginPath();
          ctx.arc(x, y, rad, 0, Math.PI * 2);
          ctx.fillStyle = c;
          ctx.fill();
          ctx.lineWidth = 1.25;
          ctx.strokeStyle = theme.fuselage;
          ctx.stroke();
          if (st === S.STOW && a.bagUnits > 0 && rad > 3) { // little bag
            ctx.fillStyle = theme.fuselage;
            ctx.fillRect(x - rad * 0.35, y - rad * 0.35, rad * 0.7, rad * 0.7);
          }
        }
      }
    }
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /** Small static seat map coloured by boarding order (used in the Methods guide). */
  BS.drawPattern = function (canvas, ac, strategy, cfg) {
    const pax = BS.generatePassengers(ac, { ...cfg, loadFactor: 1, partyShare: 0, prmShare: 0 }, 7);
    const q = BS.buildQueue(ac, pax, strategy, { ...cfg, compliance: 1, preboard: false, partyShare: 0 }, 7);
    const orderOf = new Map();
    q.forEach((e, i) => orderOf.set(e.p.seat.idx, i));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = canvas.parentElement.clientWidth || 280;
    const cellW = (W - 8) / ac.N;
    const slotH = Math.min(10, cellW * 0.9);
    const H = ac.totalSlots * slotH + 6;
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const n = q.length;
    for (const s of ac.seats) {
      const o = orderOf.get(s.idx);
      ctx.fillStyle = strategy.openSeating ? '#CBD5E1' : ramp(o / Math.max(1, n - 1));
      roundRect(ctx, 4 + (s.row - 1) * cellW + 0.75, 3 + s.slot * slotH + 0.75, cellW - 1.5, slotH - 1.5, 1.5);
      ctx.fill();
    }
  };

  BS.CabinRenderer = CabinRenderer;
})(typeof window !== 'undefined' ? window : globalThis);
