/* Boarding Lab — UI controller
 * Wires the sidebar, the five views (Simulate / Analyze / Risk / Plan / Methods),
 * playback, URL state and the Monte Carlo runner.
 */
(function () {
  'use strict';
  const BS = window.BS;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const pct = (v) => Math.round(v * 100) + '%';
  const fmt = BS.fmtTime;
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const MAX_LANES = 4;

  // ---------------------------------------------------------------- params
  const PARAMS = {
    pax: [
      { key: 'loadFactor', label: 'Load factor', min: 0.3, max: 1, step: 0.01, fmt: pct, help: 'Share of seats occupied' },
      { key: 'carryOnShare', label: 'Roller bags', min: 0, max: 1, step: 0.05, fmt: pct, help: 'Passengers with a bag for the overhead bin' },
      { key: 'binCapacity', label: 'Bin space', min: 0.3, max: 1.2, step: 0.05, fmt: (v) => v.toFixed(2) + ' / seat', help: 'Roller bags that fit per seat' },
      { key: 'partyShare', label: 'Travel parties', min: 0, max: 0.8, step: 0.05, fmt: pct, help: 'Couples and families who sit together and board together' },
      { key: 'slowShare', label: 'Slow walkers', min: 0, max: 0.3, step: 0.01, fmt: pct },
    ],
    ops: [
      { key: 'compliance', label: 'Group discipline', min: 0.4, max: 1, step: 0.05, fmt: pct, help: 'Share of passengers who board with their own group' },
      { key: 'headway', label: 'Door flow', min: 1, max: 8, step: 0.1, fmt: (v) => v.toFixed(1) + ' s/pax', help: 'Minimum gap between passengers entering one door' },
      { key: 'eliteShare', label: 'Status holders', min: 0, max: 0.5, step: 0.01, fmt: pct, help: 'Frequent-flyer tiers boarding early. Used by the airline-group methods.' },
      { key: 'priorityShare', label: 'Paid priority / cards', min: 0, max: 0.4, step: 0.01, fmt: pct },
      { key: 'basicShare', label: 'Basic economy', min: 0, max: 0.5, step: 0.01, fmt: pct, help: 'Boards last; seats mostly middles towards the back' },
    ],
    adv: [
      { key: 'walkSec', label: 'Walk time per row', min: 0.5, max: 2, step: 0.05, fmt: (v) => v.toFixed(2) + ' s' },
      { key: 'stowSec', label: 'Bag stow time', min: 2, max: 15, step: 0.5, fmt: (v) => v.toFixed(1) + ' s', help: 'Mean time to stow into an empty bin' },
      { key: 'shuffleBase', label: 'Seat shuffle: fixed', min: 0, max: 10, step: 0.5, fmt: (v) => v.toFixed(1) + ' s' },
      { key: 'shufflePer', label: 'Seat shuffle: per person', min: 0, max: 8, step: 0.5, fmt: (v) => v.toFixed(1) + ' s' },
      { key: 'prmShare', label: 'Passengers needing assistance', min: 0, max: 0.05, step: 0.005, fmt: (v) => (v * 100).toFixed(1) + '%' },
    ],
  };
  const ALL_PARAMS = [...PARAMS.pax, ...PARAMS.ops, ...PARAMS.adv];
  const MODEL_KEYS = PARAMS.adv.map((p) => p.key);

  // ---------------------------------------------------------------- state
  const state = {
    acId: 'a320-lcc', preset: 'scheduled', cfg: null, strategies: ['airline-fare', 'btf-zones', 'wilma', 'steffen'],
    seed: 42, colorBy: 'status', bins: true, speed: 10, t: 0, tEnd: 1, playing: false,
    results: [], lanes: [], ac: null, mc: null, mcScope: 'all', mcReps: 50, mcRunning: false,
    view: 'simulate', plan: null, risk: null, riskLevel: 'realistic', riskReps: 50,
  };
  const cfgFromPreset = (p) => ({ ...BS.DEFAULTS, ...BS.PRESETS[p].cfg });

  // ---------------------------------------------------------------- URL state
  function readHash() {
    const h = new URLSearchParams(location.hash.slice(1));
    if (h.get('a') && BS.AIRCRAFT.some((a) => a.id === h.get('a'))) state.acId = h.get('a');
    if (h.get('p') && (BS.PRESETS[h.get('p')] || h.get('p') === 'custom')) state.preset = h.get('p');
    state.cfg = cfgFromPreset(state.preset === 'custom' ? 'scheduled' : state.preset);
    if (h.get('c')) { try { Object.assign(state.cfg, JSON.parse(atob(h.get('c')))); } catch (e) { /* ignore */ } }
    if (h.get('s')) {
      const ids = h.get('s').split(',').filter((id) => BS.getStrategy(id)).slice(0, MAX_LANES);
      if (ids.length) state.strategies = ids;
    }
    if (h.get('seed')) state.seed = Math.max(1, parseInt(h.get('seed'), 10) || 42);
    if (h.get('v') && ['simulate', 'analyze', 'risk', 'plan', 'methods'].includes(h.get('v'))) state.view = h.get('v');
  }
  function writeHash() {
    const base = cfgFromPreset(state.preset === 'custom' ? 'scheduled' : state.preset);
    const diff = {};
    for (const k of Object.keys(state.cfg)) {
      if (JSON.stringify(state.cfg[k]) !== JSON.stringify(base[k])) diff[k] = state.cfg[k];
    }
    const h = new URLSearchParams();
    h.set('a', state.acId); h.set('p', state.preset); h.set('s', state.strategies.join(',')); h.set('seed', state.seed);
    if (Object.keys(diff).length) h.set('c', btoa(JSON.stringify(diff)));
    if (state.view !== 'simulate') h.set('v', state.view);
    try { history.replaceState(null, '', '#' + h.toString()); } catch (e) { /* sandboxed embeds may forbid history access */ }
  }
  const scenarioKey = () => JSON.stringify([state.acId, state.cfg, state.seed]);

  // ---------------------------------------------------------------- sidebar
  function buildSidebar() {
    // presets
    const ps = $('#presetSelect');
    ps.innerHTML = Object.entries(BS.PRESETS).map(([k, p]) => `<option value="${k}">${esc(p.label)}</option>`).join('') + '<option value="custom">Custom</option>';
    ps.addEventListener('change', () => {
      if (ps.value === 'custom') return;
      const { doors, risk, riskEdits } = state.cfg;
      const model = Object.fromEntries(MODEL_KEYS.filter((k) => !(k in BS.PRESETS[ps.value].cfg)).map((k) => [k, state.cfg[k]]));
      state.preset = ps.value;
      state.cfg = { ...cfgFromPreset(ps.value), ...model, doors, risk, riskEdits };
      syncSidebar();
      rebuildSoon(0);
    });

    // aircraft
    const as = $('#aircraftSelect');
    const fams = [...new Set(BS.AIRCRAFT.map((a) => a.family))];
    as.innerHTML = fams.map((f) => `<optgroup label="${esc(f)}">${BS.AIRCRAFT.filter((a) => a.family === f).map((a) => `<option value="${a.id}">${esc(a.name)}: ${esc(a.variant)}</option>`).join('')}</optgroup>`).join('');
    as.addEventListener('change', () => {
      state.acId = as.value;
      state.cfg.doors = null;
      syncSidebar();
      rebuildSoon(0);
    });

    // strategies
    const sl = $('#stratList');
    sl.innerHTML = BS.STRATEGIES.map((s) => `
      <div class="strat-item" data-id="${s.id}" role="checkbox" tabindex="0" title="${esc(s.tagline)}">
        <span class="cb"></span><span class="sw" style="background:${s.color}"></span><span class="nm">${esc(s.name)}</span>
      </div>`).join('');
    sl.addEventListener('click', (e) => { const it = e.target.closest('.strat-item'); if (it) toggleStrategy(it.dataset.id); });
    sl.addEventListener('keydown', (e) => { if ((e.key === ' ' || e.key === 'Enter') && e.target.classList.contains('strat-item')) { e.preventDefault(); toggleStrategy(e.target.dataset.id); } });

    // params
    const mk = (list, host) => {
      host.innerHTML = list.map((p) => `
        <div class="param">
          <div class="param-top"><label for="p-${p.key}">${esc(p.label)}</label><span class="val" id="v-${p.key}"></span></div>
          <input type="range" id="p-${p.key}" min="${p.min}" max="${p.max}" step="${p.step}" />
          ${p.help ? `<small>${esc(p.help)}</small>` : ''}
        </div>`).join('');
      for (const p of list) {
        const inp = $(`#p-${p.key}`);
        inp.addEventListener('input', () => {
          state.cfg[p.key] = parseFloat(inp.value);
          if (!MODEL_KEYS.includes(p.key)) markCustom();
          paintParam(p);
          rebuildSoon();
        });
      }
    };
    mk(PARAMS.pax, $('#paxParams'));
    mk(PARAMS.ops, $('#opsParams'));
    mk(PARAMS.adv, $('#advParams'));

    $('#preboardToggle').addEventListener('change', (e) => { state.cfg.preboard = e.target.checked; markCustom(); rebuildSoon(0); });
    $$('#riskSeg button').forEach((b) => b.addEventListener('click', () => {
      state.cfg.risk = b.dataset.v;
      syncSidebar();
      rebuildSoon(0);
    }));
    $('#resetModelBtn').addEventListener('click', () => {
      for (const k of MODEL_KEYS) state.cfg[k] = BS.DEFAULTS[k];
      if (BS.PRESETS[state.preset]) Object.assign(state.cfg, Object.fromEntries(Object.entries(BS.PRESETS[state.preset].cfg).filter(([k]) => MODEL_KEYS.includes(k))));
      syncSidebar();
      rebuildSoon(0);
    });
    $('#seedInput').addEventListener('change', (e) => { state.seed = Math.max(1, parseInt(e.target.value, 10) || 1); rebuildSoon(0); });
    $('#diceBtn').addEventListener('click', () => { state.seed = 1 + Math.floor(Math.random() * 99999); $('#seedInput').value = state.seed; rebuildSoon(0); });
  }

  function paintParam(p) {
    const inp = $(`#p-${p.key}`);
    const v = state.cfg[p.key];
    inp.value = v;
    inp.style.setProperty('--p', ((v - p.min) / (p.max - p.min)) * 100 + '%');
    $(`#v-${p.key}`).textContent = p.fmt(v);
  }

  function markCustom() {
    if (state.preset !== 'custom') { state.preset = 'custom'; $('#presetSelect').value = 'custom'; $('#presetHint').textContent = 'Custom settings, based on the last preset you picked.'; }
  }

  function syncSidebar() {
    $('#presetSelect').value = state.preset;
    $('#presetHint').textContent = BS.PRESETS[state.preset] ? BS.PRESETS[state.preset].hint : 'Custom settings, based on the last preset you picked.';
    $('#aircraftSelect').value = state.acId;
    const ac = BS.getAircraft(state.acId);
    const aisles = ac.lanes === 1 ? 'Single aisle' : `${ac.lanes} aisles`;
    $('#acSpec').innerHTML = `<span>${ac.seats.length} seats</span><span>${ac.N} rows</span><span>${esc(ac.layoutLabel)}</span><span>${aisles}</span><p>${esc(ac.def.note || '')}</p>`;
    const active = state.cfg.doors || ac.doors.filter((d) => d.default).map((d) => d.id);
    $('#doorChips').innerHTML = ac.doors.map((d) => {
      const pos = d.cell === 0 ? 'front' : d.cell === ac.N + 1 ? 'rear' : `row ${d.cell}`;
      return `<span class="chip ${active.includes(d.id) ? 'on' : ''}" data-door="${esc(d.id)}">${esc(d.id)} <span class="pos">${pos}</span></span>`;
    }).join('');
    $$('#doorChips .chip').forEach((c) => c.addEventListener('click', () => {
      const cur = new Set(state.cfg.doors || ac.doors.filter((d) => d.default).map((d) => d.id));
      if (cur.has(c.dataset.door)) { if (cur.size === 1) return toast('At least one door must be open'); cur.delete(c.dataset.door); } else cur.add(c.dataset.door);
      state.cfg.doors = ac.doors.map((d) => d.id).filter((id) => cur.has(id));
      syncSidebar();
      rebuildSoon(0);
    }));
    ALL_PARAMS.forEach(paintParam);
    $('#preboardToggle').checked = !!state.cfg.preboard;
    $$('#riskSeg button').forEach((b) => b.classList.toggle('on', b.dataset.v === (state.cfg.risk || 'off')));
    $('#seedInput').value = state.seed;
    syncStrategies();
  }

  function syncStrategies() {
    $$('#stratList .strat-item').forEach((it) => {
      const on = state.strategies.includes(it.dataset.id);
      it.classList.toggle('on', on);
      it.setAttribute('aria-checked', on);
      it.classList.toggle('disabled', !on && state.strategies.length >= MAX_LANES);
    });
    $('#stratCount').textContent = `${state.strategies.length}/${MAX_LANES}`;
  }

  function toggleStrategy(id) {
    const i = state.strategies.indexOf(id);
    if (i >= 0) {
      if (state.strategies.length === 1) return toast('Select at least one method');
      state.strategies.splice(i, 1);
    } else {
      if (state.strategies.length >= MAX_LANES) return toast(`Compare up to ${MAX_LANES} methods at once. Deselect one first.`);
      state.strategies.push(id);
    }
    syncStrategies();
    rebuildSoon(0);
  }

  // ---------------------------------------------------------------- simulate
  let rebuildTimer = null;
  function rebuildSoon(delay = 180) {
    clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(rebuild, delay);
  }

  function rebuild() {
    const wasPlaying = state.playing;
    setPlaying(false);
    state.ac = BS.getAircraft(state.acId);
    const pax = BS.generatePassengers(state.ac, state.cfg, state.seed);
    state.results = state.strategies.map((id) => {
      const s = BS.getStrategy(id);
      return { s, r: BS.runSim(state.ac, pax, s, state.cfg, state.seed, { record: true }) };
    });
    state.tEnd = Math.ceil(Math.max(...state.results.map((x) => x.r.firstEnter + x.r.totalTime))) + 2;
    state.t = 0;
    buildLanes();
    buildMarkers();
    buildEvents();
    updateHeader();
    renderFrame(true);
    writeHash();
    updateMcStale();
    if (state.view === 'methods') buildMethods();
    if (wasPlaying) setPlaying(true);
  }

  function updateHeader() {
    const ac = state.ac;
    $('#simTitle').textContent = `${ac.name}`;
    const doors = state.results[0] ? state.results[0].r.doors.join(' + ') : '';
    const presetLabel = BS.PRESETS[state.preset] ? BS.PRESETS[state.preset].label : 'Custom scenario';
    const riskLabel = state.cfg.risk && state.cfg.risk !== 'off' ? ` · disruptions: ${BS.RISK_LEVELS[state.cfg.risk].toLowerCase()}` : '';
    $('#simSub').textContent = `${ac.variant} · ${state.results[0] ? state.results[0].r.n : 0} passengers · door ${doors} · ${presetLabel}${riskLabel}`;
    document.title = `${ac.name} · Boarding Lab`;
  }

  function buildLanes() {
    const host = $('#lanes');
    host.innerHTML = '';
    host.dataset.color = state.colorBy;
    state.lanes = state.results.map(({ s, r }) => {
      const card = document.createElement('div');
      card.className = 'lane-card';
      card.innerHTML = `
        <div class="lane-head">
          <span class="sw" style="background:${s.color}"></span>
          <div class="lane-name">${esc(s.name)}<span class="lane-tag">${esc(s.short)}</span></div>
          <div class="lane-stats">
            <span class="seatcount"></span>
            <span class="badge status"></span>
            <span class="clock">0:00</span>
          </div>
        </div>
        <div class="lane-progress"><div style="background:${s.color}"></div></div>
        <div class="canvas-wrap"><canvas></canvas></div>
        <div class="group-legend"></div>`;
      host.appendChild(card);
      const renderer = new BS.CabinRenderer($('canvas', card));
      renderer.setResult(state.ac, r, s);
      // boarding-call legend (shown in "Groups" colour mode)
      const labels = new Map(s.groupCalls || []);
      const chips = [];
      if (r.agents.some((a) => a.pre)) chips.push(`<span><i style="background:${BS.PRE_COLOR}"></i>Pre-boarding: assistance, families${s.preboard ? '' : ', premium'}</span>`);
      if (renderer.groupCount <= 8) {
        for (const [g, i] of renderer.groupIdx) chips.push(`<span><i style="background:${BS.GROUP_COLORS[i % BS.GROUP_COLORS.length]}"></i>${esc(labels.get(g) || `Group ${i + 1}`)}</span>`);
      } else chips.push('<span class="muted">Strict single-file order: seats coloured from first (blue) to last (red)</span>');
      $('.group-legend', card).innerHTML = chips.join('');
      return {
        s, r, card, renderer, clock: $('.clock', card), badge: $('.status', card),
        count: $('.seatcount', card), bar: $('.lane-progress div', card), finish: r.firstEnter + r.totalTime,
      };
    });
    const ranked = state.lanes.slice().sort((a, b) => a.finish - b.finish);
    ranked.forEach((l, i) => { l.rank = i + 1; });
  }

  const ordinal = (n) => n + (['th', 'st', 'nd', 'rd'][(n % 100 > 10 && n % 100 < 14) ? 0 : n % 10 < 4 ? n % 10 : 0] || 'th');

  let lastSide = 0;
  function renderFrame(force) {
    const t = state.t;
    for (const l of state.lanes) {
      l.renderer.draw(t, { colorBy: state.colorBy, bins: state.bins });
      const r = l.r;
      const sec = Math.min(r.series.seated.length - 1, Math.floor(t));
      const seated = r.series.seated[Math.max(0, sec)];
      const done = t >= l.finish;
      l.clock.textContent = fmt(done ? r.totalTime : Math.max(0, t - r.firstEnter));
      l.count.textContent = `${seated}/${r.n}`;
      l.bar.style.width = (seated / r.n) * 100 + '%';
      if (done) {
        l.badge.textContent = l.rank === 1 ? '1st · fastest' : `${ordinal(l.rank)} · +${fmt(l.finish - state.lanes.find((x) => x.rank === 1).finish)}`;
        l.badge.className = 'badge status ' + (l.rank === 1 ? 'good' : '');
        l.card.classList.toggle('winner', l.rank === 1);
      } else {
        const inAisle = r.series.inAisle[Math.max(0, sec)] || 0;
        const paused = r.series.paused && r.series.paused[Math.max(0, sec)];
        l.badge.textContent = t <= 0 ? 'Ready' : paused ? 'Boarding paused' : `${inAisle} in aisle`;
        l.badge.className = 'badge status ' + (paused ? 'bad' : 'accent');
        l.card.classList.remove('winner');
      }
    }
    // transport
    const f = Math.min(1, t / state.tEnd);
    $('#scrubFill').style.width = f * 100 + '%';
    $('#scrubThumb').style.left = f * 100 + '%';
    $('#tNow').textContent = fmt(t);
    $('#tEnd').textContent = fmt(state.tEnd);
    $('#liveClock').textContent = `t = ${fmt(t)}`;
    $('#scrubber').setAttribute('aria-valuenow', Math.round(t));
    // side panel (throttled while playing)
    const now = performance.now();
    if (force || !state.playing || now - lastSide > 220) {
      lastSide = now;
      renderLiveTable();
      renderLiveChart();
      $$('#eventList li').forEach((li) => li.classList.toggle('future', parseFloat(li.dataset.t) > t));
    }
  }

  function renderLiveTable() {
    const t = state.t;
    const rows = state.lanes.map((l) => {
      const r = l.r;
      const sec = Math.max(0, Math.min(r.series.seated.length - 1, Math.floor(t)));
      const done = t >= l.finish;
      return { l, done, time: done ? r.totalTime : Math.max(0, t - r.firstEnter), seated: r.series.seated[sec] / r.n, aisle: r.series.aisle[sec], seat: r.series.seat[sec] };
    });
    const allDone = rows.every((x) => x.done);
    $('#liveTable').innerHTML = `
      <thead><tr><th>Method</th><th>Time</th><th>Seated</th><th title="Aisle interferences: someone blocked ≥ 1 s">Aisle</th><th title="Seated neighbours who had to stand up">Seat</th></tr></thead>
      <tbody>${rows.map((x) => `
        <tr class="${allDone && x.l.rank === 1 ? 'best' : ''}">
          <td><span class="nm"><i style="background:${x.l.s.color}"></i>${esc(x.l.s.short)}</span></td>
          <td>${fmt(x.time)}${x.done ? '' : '…'}</td><td>${pct(x.seated)}</td><td>${x.aisle}</td><td>${x.seat}</td>
        </tr>`).join('')}</tbody>`;
  }

  function renderLiveChart() {
    const series = state.lanes.map((l) => {
      const s = l.r.series.seated;
      const step = Math.max(1, Math.ceil(s.length / 240));
      const pts = [];
      for (let i = 0; i < s.length; i += step) pts.push([i, (s[i] / l.r.n) * 100]);
      pts.push([s.length - 1, 100]);
      return { name: l.s.name, color: l.s.color, points: pts };
    });
    $('#liveChart').innerHTML = BS.lineChart({ series, xMax: state.tEnd, yMax: 100, height: 170, width: boxWidth('#liveChart', 320), xTime: true, xFmt: fmt, yFmt: (v) => v + '%', cursor: state.t, label: 'Passengers seated over time' });
  }

  function buildMarkers() {
    const host = $('#scrubMarkers');
    host.innerHTML = state.lanes.map((l) => `
      <i style="left:${(l.finish / state.tEnd) * 100}%;background:${l.s.color}" title="${esc(l.s.name)} finished ${fmt(l.r.totalTime)}"></i>
      <i class="half" style="left:${((l.r.firstEnter + l.r.t50) / state.tEnd) * 100}%;background:${l.s.color}" title="${esc(l.s.short)} 50% seated"></i>`).join('');
  }

  function buildEvents() {
    const evs = [];
    for (const l of state.lanes) for (const e of l.r.events) evs.push({ ...e, l });
    evs.sort((a, b) => a.t - b.t);
    $('#eventList').innerHTML = evs.map((e) => `
      <li data-t="${e.t}"><span class="t">${fmt(e.t)}</span><i style="background:${e.l.s.color}"></i><span><b>${esc(e.l.s.short)}</b> · ${esc(e.text)}</span></li>`).join('') || '<li class="muted">No events</li>';
    $$('#eventList li[data-t]').forEach((li) => li.addEventListener('click', () => { seek(parseFloat(li.dataset.t) + 0.01); }));
  }

  // ---------------------------------------------------------------- playback
  let lastTs = 0;
  function loop(ts) {
    if (!state.playing) return;
    const dt = lastTs ? Math.min(0.1, (ts - lastTs) / 1000) : 0;
    lastTs = ts;
    state.t = Math.min(state.tEnd, state.t + dt * state.speed);
    renderFrame();
    if (state.t >= state.tEnd) setPlaying(false);
    else requestAnimationFrame(loop);
  }
  function setPlaying(p) {
    if (p && state.t >= state.tEnd) state.t = 0;
    state.playing = p;
    $('#transport').classList.toggle('playing', p);
    $('#playBtn').setAttribute('aria-label', p ? 'Pause' : 'Play');
    lastTs = 0;
    if (p) requestAnimationFrame(loop);
    else if (state.lanes.length) renderFrame(true);
  }
  function seek(t) {
    state.t = Math.max(0, Math.min(state.tEnd, t));
    renderFrame(true);
  }

  function bindTransport() {
    $('#playBtn').addEventListener('click', () => setPlaying(!state.playing));
    $('#restartBtn').addEventListener('click', () => { seek(0); });
    $$('#speedSeg button').forEach((b) => b.addEventListener('click', () => {
      state.speed = parseFloat(b.dataset.v);
      $$('#speedSeg button').forEach((x) => x.classList.toggle('on', x === b));
    }));
    const sc = $('#scrubber');
    let dragging = false, resume = false;
    const at = (e) => {
      const r = sc.getBoundingClientRect();
      seek(((e.clientX - r.left) / r.width) * state.tEnd);
    };
    sc.addEventListener('pointerdown', (e) => { dragging = true; resume = state.playing; if (resume) setPlaying(false); sc.setPointerCapture(e.pointerId); at(e); });
    sc.addEventListener('pointermove', (e) => { if (dragging) at(e); });
    sc.addEventListener('pointerup', () => { dragging = false; if (resume) setPlaying(true); });
    sc.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft') { e.preventDefault(); seek(state.t - 10); }
      if (e.key === 'ArrowRight') { e.preventDefault(); seek(state.t + 10); }
    });
    $$('#colorBySeg button').forEach((b) => b.addEventListener('click', () => {
      state.colorBy = b.dataset.v;
      $('#lanes').dataset.color = state.colorBy;
      $$('#colorBySeg button').forEach((x) => x.classList.toggle('on', x === b));
      renderFrame(true);
    }));
    $('#binsToggle').addEventListener('change', (e) => { state.bins = e.target.checked; renderFrame(true); });

    document.addEventListener('keydown', (e) => {
      if (state.view !== 'simulate') return;
      if (/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return;
      if (e.key === ' ') { e.preventDefault(); setPlaying(!state.playing); }
      else if (e.key === 'ArrowLeft' && document.activeElement !== sc) seek(state.t - (e.shiftKey ? 60 : 10));
      else if (e.key === 'ArrowRight' && document.activeElement !== sc) seek(state.t + (e.shiftKey ? 60 : 10));
      else if (e.key === 'Home') seek(0);
      else if (e.key === 'End') seek(state.tEnd);
    });

    // relayout only when the width really changes, one frame later (avoids ResizeObserver feedback loops)
    let lastW = 0, pending = false;
    const ro = new ResizeObserver((entries) => {
      const w = Math.round(entries[0].contentRect.width);
      if (w === lastW || pending) return;
      pending = true;
      requestAnimationFrame(() => {
        pending = false;
        lastW = Math.round($('#lanes').getBoundingClientRect().width);
        for (const l of state.lanes) l.renderer.layout();
        if (state.lanes.length) renderFrame(true);
      });
    });
    ro.observe($('#lanes'));
  }

  // ---------------------------------------------------------------- analyze (Monte Carlo)
  function updateMcStale() {
    const fresh = state.mc && state.mc.key === scenarioKey();
    $('#mcRunBtn').textContent = state.mc && !fresh ? 'Re-run (settings changed)' : 'Run analysis';
  }

  async function runMonteCarlo(ids, reps, onProgress) {
    const ac = BS.getAircraft(state.acId);
    const cfg = { ...state.cfg };
    const strategies = ids.map((id) => BS.getStrategy(id));
    const data = {};
    const wins = {};
    ids.forEach((id) => { data[id] = { time: [], aisle: [], seat: [], wait: [], gate: [], lim: [], paxT: [], p90Pax: [] }; wins[id] = 0; });
    let lastYield = performance.now();
    for (let i = 0; i < reps; i++) {
      const seed = state.seed * 1009 + i * 7919 + 1;
      const pax = BS.generatePassengers(ac, cfg, seed);
      let best = Infinity, bestIds = [];
      for (const s of strategies) {
        const r = BS.runSim(ac, pax, s, cfg, seed);
        const d = data[s.id];
        d.time.push(r.totalTime); d.aisle.push(r.aisleInterf); d.seat.push(r.seatInterf); d.wait.push(r.avgAisleWait);
        d.gate.push(r.gateChecked); d.lim.push(r.aisleLimited); d.paxT.push(r.avgPaxTime); d.p90Pax.push(r.p90PaxTime);
        if (r.totalTime < best - 1e-9) { best = r.totalTime; bestIds = [s.id]; } else if (Math.abs(r.totalTime - best) < 1e-9) bestIds.push(s.id);
        if (performance.now() - lastYield > 40) { onProgress && onProgress((i + 0.5) / reps); await tick(); lastYield = performance.now(); }
      }
      bestIds.forEach((id) => { wins[id] += 1 / bestIds.length; });
      onProgress && onProgress((i + 1) / reps);
    }
    const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
    const out = { key: scenarioKey(), acId: state.acId, ids, reps, rows: {} };
    for (const id of ids) {
      const d = data[id];
      out.rows[id] = {
        id, s: BS.getStrategy(id), stats: BS.stats(d.time), times: d.time, win: wins[id] / reps,
        aisle: mean(d.aisle), seat: mean(d.seat), wait: mean(d.wait), gate: mean(d.gate), lim: mean(d.lim),
        paxT: mean(d.paxT), p90Pax: mean(d.p90Pax),
      };
    }
    return out;
  }

  const setProgress = (f) => { $('#mcProgress div').style.width = f >= 1 ? '0%' : f * 100 + '%'; };

  async function runAnalysis() {
    if (state.mcRunning) return;
    state.mcRunning = true;
    const btn = $('#mcRunBtn');
    btn.disabled = true;
    const ids = state.mcScope === 'all' ? BS.STRATEGIES.map((s) => s.id) : state.strategies.slice();
    const t0 = performance.now();
    try {
      btn.textContent = 'Running… 0%';
      state.mc = await runMonteCarlo(ids, state.mcReps, (f) => { setProgress(f); btn.textContent = `Running… ${Math.round(f * 100)}%`; });
      state.mc.ms = performance.now() - t0;
      renderMC();
    } finally {
      state.mcRunning = false;
      btn.disabled = false;
      setProgress(1);
      updateMcStale();
    }
  }

  function renderMC() {
    const mc = state.mc;
    if (!mc) return;
    $('#mcEmpty').hidden = true;
    $('#mcResults').hidden = false;
    const rows = Object.values(mc.rows).sort((a, b) => a.stats.p50 - b.stats.p50);
    const best = rows[0];
    const base = mc.rows.random || rows[rows.length - 1];
    const worst = rows[rows.length - 1];
    const saved = base.stats.p50 - best.stats.p50;
    const lim = best.lim;
    $('#mcKpis').innerHTML = `
      <div class="kpi"><div class="k-label"><i class="sw" style="background:${best.s.color}"></i>Fastest (median)</div>
        <div class="k-value">${esc(best.s.name)}</div><div class="k-foot"><span class="badge good">${fmt(best.stats.p50)}</span> wins ${pct(best.win)} of runs</div></div>
      <div class="kpi"><div class="k-label">vs ${esc(base.s.name)}</div>
        <div class="k-value">${saved >= 0 ? '−' : '+'}${fmt(Math.abs(saved))}</div><div class="k-foot"><span class="badge ${saved >= 0 ? 'good' : 'bad'}">${saved >= 0 ? '−' : '+'}${Math.abs((saved / base.stats.p50) * 100).toFixed(0)}%</span> median boarding time</div></div>
      <div class="kpi"><div class="k-label">Spread: best vs worst</div>
        <div class="k-value">${fmt(worst.stats.p50 - best.stats.p50)}</div><div class="k-foot">${esc(worst.s.short)} median ${fmt(worst.stats.p50)}</div></div>
      <div class="kpi"><div class="k-label">Bottleneck</div>
        <div class="k-value">${lim > 0.3 ? 'Aisle' : 'Door flow'}</div><div class="k-foot"><span class="badge ${lim > 0.3 ? 'accent' : 'warn'}">${pct(lim)}</span> of the time the door waited on the aisle</div></div>`;
    $('#mcBox').innerHTML = BS.boxPlot({ rows: rows.map((r) => ({ name: r.s.name, color: r.s.color, stats: r.stats })), width: boxWidth('#mcBox', 900) });
    $('#mcTable').innerHTML = `
      <thead><tr><th>Method</th><th>Median</th><th>Mean</th><th>p90</th><th>± SD</th><th>Δ vs ${esc(base.s.short)}</th><th>Win %</th><th title="Aisle interferences per flight">Aisle blocks</th><th title="Neighbours standing up per flight">Seat shuffles</th><th title="Average time a passenger stands blocked in the aisle">Aisle wait / pax</th><th title="Average time from entering the door to seated">Door→seat / pax</th><th>Gate-checked bags</th></tr></thead>
      <tbody>${rows.map((r, i) => {
        const d = r.stats.p50 - base.stats.p50;
        return `<tr class="${i === 0 ? 'best' : ''}">
          <td><span class="nm"><i style="background:${r.s.color}"></i>${esc(r.s.name)}</span></td>
          <td>${fmt(r.stats.p50)}</td><td>${fmt(r.stats.mean)}</td><td>${fmt(r.stats.p90)}</td><td>${Math.round(r.stats.sd)} s</td>
          <td class="${d < -0.5 ? 'delta-good' : d > 0.5 ? 'delta-bad' : ''}">${r === base ? '—' : (d < 0 ? '−' : '+') + fmt(Math.abs(d))}</td>
          <td>${pct(r.win)}</td><td>${r.aisle.toFixed(0)}</td><td>${r.seat.toFixed(0)}</td><td>${r.wait.toFixed(0)} s</td><td>${fmt(r.paxT)}</td><td>${r.gate.toFixed(1)}</td></tr>`;
      }).join('')}</tbody>`;
  }

  function downloadCsv() {
    const mc = state.mc;
    if (!mc) return;
    const head = ['method', 'runs', 'median_s', 'mean_s', 'p10_s', 'p90_s', 'sd_s', 'win_rate', 'aisle_interferences', 'seat_interferences', 'aisle_wait_per_pax_s', 'door_to_seat_per_pax_s', 'gate_checked_bags', 'aisle_limited_share'];
    const lines = [head.join(',')];
    for (const r of Object.values(mc.rows)) {
      lines.push([r.s.name, mc.reps, r.stats.p50.toFixed(1), r.stats.mean.toFixed(1), r.stats.p10.toFixed(1), r.stats.p90.toFixed(1), r.stats.sd.toFixed(1), r.win.toFixed(3), r.aisle.toFixed(1), r.seat.toFixed(1), r.wait.toFixed(1), r.paxT.toFixed(1), r.gate.toFixed(2), r.lim.toFixed(3)].map((v) => `"${v}"`).join(','));
    }
    const meta = `# Boarding Lab export · aircraft=${state.acId} · seed=${state.seed} · cfg=${JSON.stringify(state.cfg).replace(/"/g, "'")}`;
    const blob = new Blob([meta + '\n' + lines.join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `boarding-lab-${state.acId}-${state.seed}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  const SWEEPS = {
    carryOnShare: { values: [0, 0.2, 0.4, 0.6, 0.8, 1], fmt: pct, label: 'Roller-bag share' },
    loadFactor: { values: [0.5, 0.6, 0.7, 0.8, 0.9, 1], fmt: pct, label: 'Load factor' },
    compliance: { values: [0.5, 0.6, 0.7, 0.8, 0.9, 1], fmt: pct, label: 'Group discipline' },
    partyShare: { values: [0, 0.2, 0.4, 0.6, 0.8], fmt: pct, label: 'Travel parties' },
    headway: { values: [1.5, 2, 2.5, 3, 4, 5], fmt: (v) => v + ' s', label: 'Door flow' },
    binCapacity: { values: [0.4, 0.5, 0.6, 0.7, 0.8, 1.0], fmt: (v) => v.toFixed(1), label: 'Bin space per seat' },
  };

  async function runSensitivity() {
    const key = $('#sensParam').value;
    const sw = SWEEPS[key];
    const btn = $('#sensRunBtn');
    btn.disabled = true;
    const ac = BS.getAircraft(state.acId);
    const reps = 12;
    const series = state.strategies.map((id) => ({ s: BS.getStrategy(id), points: [] }));
    const total = sw.values.length * reps;
    let done = 0;
    for (const v of sw.values) {
      const cfg = { ...state.cfg, [key]: v };
      const sums = series.map(() => 0);
      for (let i = 0; i < reps; i++) {
        const seed = state.seed * 131 + i * 7919 + 3;
        const pax = BS.generatePassengers(ac, cfg, seed);
        series.forEach((se, j) => { sums[j] += BS.runSim(ac, pax, se.s, cfg, seed).totalTime; });
        done++;
        btn.textContent = `Running… ${Math.round((done / total) * 100)}%`;
        await tick();
      }
      series.forEach((se, j) => se.points.push([v, sums[j] / reps]));
    }
    state.sens = { series, sw, key, reps };
    renderSens();
    btn.disabled = false;
    btn.textContent = 'Run sweep';
  }

  function renderSens() {
    if (!state.sens) return;
    const { series, sw, key, reps } = state.sens;
    const all = series.flatMap((s) => s.points.map((p) => p[1]));
    $('#sensChart').innerHTML = BS.lineChart({
      series: series.map((s) => ({ name: s.s.name, color: s.s.color, points: s.points })),
      xMin: sw.values[0], xMax: sw.values[sw.values.length - 1], yMin: Math.max(0, Math.min(...all) * 0.9), yMax: Math.max(...all) * 1.05,
      xFmt: sw.fmt, yFmt: fmt, dots: true, cursor: state.cfg[key], width: boxWidth('#sensChart', 900), height: 260, label: 'Sensitivity',
    }) + `<div class="legend">${series.map((s) => `<span><i class="lg" style="background:${s.s.color}"></i>${esc(s.s.name)}</span>`).join('')}<span class="muted">Dashed line = current setting · ${reps} runs per point</span></div>`;
  }

  /** Current inner width of a chart container (charts are drawn 1:1 so text never scales). */
  function boxWidth(sel, fallback) {
    const el = $(sel);
    const w = el && el.clientWidth;
    return w && w > 50 ? Math.floor(w) : fallback;
  }

  // ---------------------------------------------------------------- risk
  /** Editable catalogue: values shown are the chosen level's defaults unless the user overrode them. */
  function renderRiskTable() {
    const level = state.riskLevel;
    const edits = state.cfg.riskEdits || {};
    const occ = state.risk && state.risk.key === riskKey() ? state.risk.perFlight : null;
    $('#riskTable').innerHTML = `
      <thead><tr><th>Event</th><th>Applies</th><th>Probability</th><th>Typical duration</th><th title="Average occurrences per flight in the last run">Per flight</th></tr></thead>
      <tbody>${BS.RISK_EVENTS.map((e) => {
        const ed = edits[e.id] || {};
        const on = ed.on !== undefined ? ed.on : true;
        const p = ed.p != null ? ed.p : e.p[level];
        const mean = ed.mean != null ? ed.mean : e.mean;
        const minutes = mean >= 120;
        return `<tr class="${on ? '' : 'off'}" data-id="${e.id}">
          <td><div class="ev-row"><input type="checkbox" data-k="on" ${on ? 'checked' : ''} aria-label="Enable ${esc(e.label)}"/>
            <div class="ev"><b>${esc(e.label)}</b><small>${esc(e.desc)}</small></div></div></td>
          <td><span class="scope">${e.scope === 'pax' ? 'per passenger' : 'per flight'}</span></td>
          <td><span class="num-in"><input type="number" data-k="p" min="0" max="100" step="${e.scope === 'pax' ? 0.1 : 1}" value="${+(p * 100).toFixed(2)}"/><span>%</span></span></td>
          <td><span class="num-in"><input type="number" data-k="mean" data-unit="${minutes ? 60 : 1}" min="0" step="${minutes ? 0.5 : 1}" value="${minutes ? +(mean / 60).toFixed(1) : Math.round(mean)}"/><span>${minutes ? 'min' : 's'}</span></span>
            ${e.count ? `<br><span class="muted sm">${e.count[level][0]}–${e.count[level][1]} passengers</span>` : ''}</td>
          <td>${occ ? (occ[e.id] || 0).toFixed(2) : '–'}</td>
        </tr>`;
      }).join('')}</tbody>`;
    $$('#riskTable input').forEach((inp) => inp.addEventListener('change', () => {
      const id = inp.closest('tr').dataset.id;
      const edits2 = { ...(state.cfg.riskEdits || {}) };
      const cur = { ...(edits2[id] || {}) };
      if (inp.dataset.k === 'on') cur.on = inp.checked;
      else if (inp.dataset.k === 'p') cur.p = Math.max(0, Math.min(100, parseFloat(inp.value) || 0)) / 100;
      else cur.mean = Math.max(0, parseFloat(inp.value) || 0) * (+inp.dataset.unit || 1);
      edits2[id] = cur;
      state.cfg.riskEdits = edits2;
      renderRiskTable();
      if (state.cfg.risk && state.cfg.risk !== 'off') rebuildSoon();
      else writeHash();
    }));
  }

  const riskKey = () => JSON.stringify([state.acId, state.cfg, state.seed, state.strategies, state.riskLevel]);

  async function runRisk() {
    const btn = $('#riskRunBtn');
    if (btn.disabled) return;
    btn.disabled = true;
    try {
      const ac = BS.getAircraft(state.acId);
      const level = state.riskLevel;
      const clean = { ...state.cfg, risk: 'off' };
      const dirty = { ...state.cfg, risk: level };
      const ids = state.strategies.slice();
      const reps = state.riskReps;
      const profile = BS.riskProfile(dirty);
      const attReps = Math.min(reps, 30);
      const total = reps * ids.length * 2 + profile.length * attReps;
      let done = 0, lastYield = performance.now();
      const step = async () => {
        done++;
        if (performance.now() - lastYield > 40) {
          const f = done / total;
          $('#riskProgress div').style.width = f * 100 + '%';
          btn.textContent = `Running… ${Math.round(f * 100)}%`;
          await tick();
          lastYield = performance.now();
        }
      };
      const data = Object.fromEntries(ids.map((id) => [id, { clean: [], dirty: [], cleanReady: [], dirtyReady: [] }]));
      const counts = {};
      const seeds = [];
      for (let i = 0; i < reps; i++) {
        const seed = state.seed * 7717 + i * 7919 + 9;
        seeds.push(seed);
        const pax = BS.generatePassengers(ac, clean, seed);
        for (const id of ids) {
          const s = BS.getStrategy(id);
          const r0 = BS.runSim(ac, pax, s, clean, seed); await step();
          const r1 = BS.runSim(ac, pax, s, dirty, seed); await step();
          const d = data[id];
          d.clean.push(r0.totalTime); d.dirty.push(r1.totalTime);
          d.cleanReady.push(r0.readyTime); d.dirtyReady.push(r1.readyTime);
          if (id === ids[0]) for (const [k, v] of Object.entries(r1.disruptions)) counts[k] = (counts[k] || 0) + v;
        }
      }
      // marginal impact of each event on the focus method (paired with the clean runs)
      const focus = BS.getStrategy(ids[0]);
      const impact = [];
      for (const e of profile) {
        let sum = 0;
        for (let i = 0; i < attReps; i++) {
          const seed = seeds[i];
          const pax = BS.generatePassengers(ac, clean, seed);
          const r = BS.runSim(ac, pax, focus, dirty, seed, { riskOnly: e.id });
          sum += e.afterBoarding ? r.readyTime - data[focus.id].cleanReady[i] : r.totalTime - data[focus.id].clean[i];
          await step();
        }
        impact.push({ id: e.id, label: e.label, value: sum / attReps, after: !!e.afterBoarding });
      }
      const perFlight = Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, v / reps]));
      state.risk = { key: riskKey(), level, reps, ids, data, impact, perFlight, focusId: focus.id };
      renderRiskTable();
      renderRisk();
    } finally {
      btn.disabled = false;
      btn.textContent = 'Run risk analysis';
      $('#riskProgress div').style.width = '0%';
    }
  }

  function renderRisk() {
    const R = state.risk;
    if (!R) return;
    $('#riskEmpty').hidden = true;
    $('#riskResults').hidden = false;
    const target = (+$('#planTarget').value || 15) * 60;
    const over = (arr) => arr.filter((x) => x > target).length / arr.length;
    const rows = R.ids.map((id) => {
      const d = R.data[id];
      const c = BS.stats(d.clean), x = BS.stats(d.dirty), rd = BS.stats(d.dirtyReady);
      return { s: BS.getStrategy(id), c, x, rd, dP50: x.p50 - c.p50, dP90: x.p90 - c.p90, overC: over(d.clean), overX: over(d.dirty) };
    });
    const focus = rows[0];
    const robust = rows.slice().sort((a, b) => a.x.p90 - b.x.p90)[0];
    const stale = R.key !== riskKey();
    $('#riskKpis').innerHTML = `
      <div class="kpi"><div class="k-label"><i class="sw" style="background:${focus.s.color}"></i>${esc(focus.s.short)}: median impact</div>
        <div class="k-value">+${fmt(focus.dP50)}</div><div class="k-foot">${fmt(focus.c.p50)} clean → ${fmt(focus.x.p50)} (${esc(BS.RISK_LEVELS[R.level].toLowerCase())})</div></div>
      <div class="kpi"><div class="k-label">Buffer to plan (p90)</div>
        <div class="k-value">+${fmt(focus.dP90)}</div><div class="k-foot">p90 ${fmt(focus.c.p90)} → <span class="badge bad">${fmt(focus.x.p90)}</span></div></div>
      <div class="kpi"><div class="k-label">Flights over ${fmt(target)} target</div>
        <div class="k-value">${pct(focus.overX)}</div><div class="k-foot">clean: ${pct(focus.overC)} · target set in Plan</div></div>
      <div class="kpi"><div class="k-label">Most robust (lowest disrupted p90)</div>
        <div class="k-value">${esc(robust.s.short)}</div><div class="k-foot"><span class="badge good">${fmt(robust.x.p90)}</span> p90 on a ${esc(BS.RISK_LEVELS[R.level].toLowerCase())}</div></div>
      ${stale ? '<p class="hint" style="grid-column:1/-1">Settings changed since this run. Run it again to update.</p>' : ''}`;
    const boxRows = [];
    for (const r of rows) {
      boxRows.push({ name: `${r.s.short} · clean`, color: '#98A2B3', stats: r.c });
      boxRows.push({ name: `${r.s.short} · disrupted`, color: r.s.color, stats: r.x });
    }
    $('#riskBox').innerHTML = BS.boxPlot({ rows: boxRows, width: boxWidth('#riskBox', 900), target });
    $('#riskFocusLabel').textContent = `for ${focus.s.name} · ${Math.min(R.reps, 30)} runs each`;
    const imp = R.impact.slice().sort((a, b) => b.value - a.value);
    $('#riskTornado').innerHTML = imp.length
      ? BS.barChart({ rows: imp.map((e) => ({ name: e.label, color: e.after ? '#F59E0B' : '#DC2626', value: Math.max(0, e.value) })), fmt: (v) => '+' + fmt(v), width: boxWidth('#riskTornado', 420), label: 'Delay by event' })
      : '<div class="placeholder">All events are switched off.</div>';
    $('#riskMethodTable').innerHTML = `
      <thead><tr><th>Method</th><th>p50 clean → disrupted</th><th>Δ p90</th><th title="Boarding plus offload: ready to close the doors">Door-close p90</th><th>Over target</th></tr></thead>
      <tbody>${rows.slice().sort((a, b) => a.x.p90 - b.x.p90).map((r, i) => `
        <tr class="${i === 0 ? 'best' : ''}"><td><span class="nm"><i style="background:${r.s.color}"></i>${esc(r.s.short)}</span></td>
          <td>${fmt(r.c.p50)} → ${fmt(r.x.p50)}</td><td class="delta-bad">+${fmt(r.dP90)}</td><td>${fmt(r.rd.p90)}</td><td>${pct(r.overC)} → ${pct(r.overX)}</td></tr>`).join('')}</tbody>`;
  }

  // ---------------------------------------------------------------- plan
  function fillPlanSelects() {
    const opts = BS.STRATEGIES.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
    $('#planBase').innerHTML = opts;
    $('#planCand').innerHTML = opts;
    $('#planBase').value = 'airline-fare';
    $('#planCand').value = 'wilma';
    ['#planBase', '#planCand', '#planCost', '#planDeps', '#planDays', '#planTarget', '#planStd', '#planDoorBuf', '#planLead'].forEach((s) => $(s).addEventListener('change', () => { if (state.plan && state.plan.key === scenarioKey()) renderPlan(); }));
  }

  async function runPlan() {
    const btn = $('#planRunBtn');
    if (btn.disabled) return;
    btn.disabled = true;
    try {
      if (!state.mc || state.mc.key !== scenarioKey() || state.mc.ids.length < BS.STRATEGIES.length) {
        state.mcScope = 'all';
        $$('#mcScopeSeg button').forEach((x) => x.classList.toggle('on', x.dataset.v === 'all'));
        btn.textContent = 'Simulating…';
        state.mc = await runMonteCarlo(BS.STRATEGIES.map((s) => s.id), Math.max(30, state.mcReps), (f) => { btn.textContent = `Simulating… ${Math.round(f * 70)}%`; });
        renderMC();
        updateMcStale();
      }
      // levers: what-if runs on the proposed method
      const ac = BS.getAircraft(state.acId);
      const cand = BS.getStrategy($('#planCand').value);
      const cur = state.cfg;
      const activeDoors = cur.doors || ac.doors.filter((d) => d.default).map((d) => d.id);
      const levers = [];
      if (ac.doors.length > activeDoors.length) levers.push({ name: 'Open every door', sub: `${ac.doors.map((d) => d.id).join(' + ')} (e.g. stairs at the rear)`, cfg: { doors: ac.doors.map((d) => d.id) } });
      if (cur.carryOnShare >= 0.2) levers.push({ name: '20 pts fewer roller bags', sub: 'Paid carry-on, free gate check, bag sizers', cfg: { carryOnShare: cur.carryOnShare - 0.2 } });
      levers.push({ name: 'Bigger bins (+0.2 bags/seat)', sub: 'Cabin retrofit (e.g. larger “XL” overhead bins)', cfg: { binCapacity: cur.binCapacity + 0.2 } });
      if (cur.compliance < 1) levers.push({ name: 'Enforce group calls', sub: 'Everyone boards with their own group', cfg: { compliance: 1 } });
      if (cur.headway > 1.6) levers.push({ name: 'Faster door flow (−0.5 s/pax)', sub: 'More scanners, open the gate earlier, pre-staged queue', cfg: { headway: Math.max(1, cur.headway - 0.5) } });
      if (cur.partyShare > 0.1) levers.push({ name: 'Parties board separately', sub: 'Travel parties split up like other passengers (policy test)', cfg: { partyShare: 0 } });
      const reps = 16;
      const run = async (over) => {
        const cfg = { ...cur, ...over };
        let s = 0, g = 0;
        for (let i = 0; i < reps; i++) {
          const seed = state.seed * 17 + i * 7919 + 5;
          const r = BS.runSim(ac, BS.generatePassengers(ac, cfg, seed), cand, cfg, seed);
          s += r.totalTime; g += r.gateChecked;
          if (i % 4 === 3) await tick();
        }
        return { mean: s / reps, gate: g / reps };
      };
      btn.textContent = 'Testing levers…';
      const baseRun = await run({});
      const baseMean = baseRun.mean;
      for (let i = 0; i < levers.length; i++) {
        const r = await run(levers[i].cfg);
        levers[i].mean = r.mean;
        levers[i].delta = r.mean - baseMean;
        levers[i].gateDelta = r.gate - baseRun.gate;
        btn.textContent = `Testing levers… ${Math.round(((i + 1) / levers.length) * 100)}%`;
      }
      levers.sort((a, b) => a.delta - b.delta);
      state.plan = { key: scenarioKey(), levers, baseMean, candId: cand.id };
      renderPlan();
    } finally {
      btn.disabled = false;
      btn.textContent = 'Update estimates';
    }
  }

  function renderPlan() {
    const mc = state.mc;
    if (!mc || !state.plan) return;
    const base = mc.rows[$('#planBase').value];
    const cand = mc.rows[$('#planCand').value];
    const cost = +$('#planCost').value || 0, deps = +$('#planDeps').value || 0, days = +$('#planDays').value || 0;
    const target = (+$('#planTarget').value || 15) * 60;
    const [hh, mm] = ($('#planStd').value || '10:00').split(':').map(Number);
    const std = hh * 60 + mm;
    const doorBuf = +$('#planDoorBuf').value || 0;
    const lead = +$('#planLead').value || 0;

    const dMed = base.stats.p50 - cand.stats.p50;
    const dP90 = base.stats.p90 - cand.stats.p90;
    const annualMin = (dMed / 60) * deps * days;
    const annualVal = annualMin * cost;
    const within = (r) => r.times.filter((x) => x <= target).length / r.times.length;
    const clock = (m) => { m = ((Math.round(m) % 1440) + 1440) % 1440; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };
    const callAt = (r) => std - doorBuf - r.stats.p90 / 60 - lead;
    const money = (v) => (Math.abs(v) >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : Math.abs(v) >= 1e3 ? `$${Math.round(v / 1e3)}k` : `$${Math.round(v)}`);

    const earliest = Math.min(callAt(base), callAt(cand));
    const span = std - earliest + 2;
    const seg = (from, to, color, label) => `<div class="tl-seg" style="left:${((from - earliest + 1) / span) * 100}%;width:${((to - from) / span) * 100}%;background:${color}" title="${esc(label)}">${esc(label)}</div>`;
    const tlRow = (r, label) => {
      const call = callAt(r);
      const on = call + lead, done = on + r.stats.p90 / 60;
      return `<div class="tl-row"><div><b>${esc(label)}</b><br><span class="muted">${esc(r.s.name)}</span></div><div class="tl-bar">
        ${seg(call, on, '#98A2B3', 'Gate')}${seg(on, done, r.s.color, `Boarding p90 ${fmt(r.stats.p90)}`)}${seg(done, std, '#475467', 'Doors')}</div></div>`;
    };

    const lim = cand.lim;
    const bottleneck = lim > 0.3
      ? { cls: 'info', title: 'Aisle-limited: the boarding method and bag policy matter most', text: `Passengers were ready at the door but the aisle was backed up ${pct(lim)} of the time. Methods that spread passengers along the cabin, and fewer or smaller cabin bags, cut the most time.` }
      : { cls: 'warn', title: 'Door-limited: the gate and the door are the constraint', text: `The aisle kept up with the door most of the time (backed up only ${pct(lim)} of the time), so passengers arrive more slowly than the cabin can absorb them. Another door or faster gate processing will help more than a new method.` };

    const targetRows = Object.values(mc.rows).map((r) => ({ name: r.s.short, color: r.s.color, value: within(r) })).sort((a, b) => b.value - a.value);

    $('#planOut').innerHTML = `
      <div class="kpis plan-kpis">
        <div class="kpi"><div class="k-label">Saved per departure</div><div class="k-value">${dMed >= 0 ? '' : '+'}${fmt(Math.abs(dMed))}</div>
          <div class="k-foot"><span class="badge ${dMed >= 0 ? 'good' : 'bad'}">${dMed >= 0 ? 'faster' : 'slower'}</span> median · p90 ${dP90 >= 0 ? '−' : '+'}${fmt(Math.abs(dP90))}</div></div>
        <div class="kpi"><div class="k-label">Yearly value</div><div class="k-value">${money(annualVal)}</div>
          <div class="k-foot">${Math.round(annualMin / 60).toLocaleString()} gate hours · ${deps}/day × ${days} days</div></div>
        <div class="kpi"><div class="k-label">Within ${fmt(target)} target</div><div class="k-value">${pct(within(cand))}</div>
          <div class="k-foot">of flights with ${esc(cand.s.short)} · ${esc(base.s.short)}: ${pct(within(base))}</div></div>
      </div>
      <div class="callout ${bottleneck.cls}"><div class="ico"><svg viewBox="0 0 24 24"><path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg></div>
        <div><h4>${esc(bottleneck.title)}</h4><p>${esc(bottleneck.text)}</p></div></div>
      <div class="card">
        <div class="card-head"><h3>When to call boarding</h3><span class="muted sm">based on p90, so 9 in 10 flights have doors closed on time</span></div>
        <div class="timeline-plan">
          ${tlRow(base, `Call ${clock(callAt(base))}`)}
          ${tlRow(cand, `Call ${clock(callAt(cand))}`)}
          <div class="tl-axis"><span>${clock(earliest - 1)}</span><span>STD ${clock(std)}</span></div>
        </div>
        <p class="hint">With ${esc(cand.s.name)} you can call boarding <b>${Math.round(callAt(cand) - callAt(base))} min ${callAt(cand) >= callAt(base) ? 'later' : 'earlier'}</b> than with ${esc(base.s.name)} and keep the same on-time reliability. That is less time passengers spend standing in the jet bridge.</p>
      </div>
      <div class="grid-2">
        <div class="card">
          <div class="card-head"><h3>What else helps (${esc(BS.getStrategy(state.plan.candId).short)})</h3><span class="muted sm">mean of 16 runs each</span></div>
          <div class="levers">${state.plan.levers.map((l) => `
            <div class="lever"><div><b>${esc(l.name)}</b><small>${esc(l.sub)}${Math.abs(l.gateDelta) >= 1 ? ` · <span class="${l.gateDelta < 0 ? '' : 'warn-text'}">${l.gateDelta > 0 ? '+' : '−'}${Math.round(Math.abs(l.gateDelta))} gate-checked bags</span>` : ''}</small></div>
              <span class="d ${l.delta < -2 ? 'delta-good' : l.delta > 2 ? 'delta-bad' : 'muted'}">${Math.abs(l.delta) <= 2 ? '±0:00' : (l.delta < 0 ? '−' : '+') + fmt(Math.abs(l.delta))}</span></div>`).join('')}</div>
          <p class="hint">A lever can add cabin time and still be worth it. Bigger bins, for example, mean fewer bags gate-checked (less ramp handling and waiting at the carousel) in exchange for more stowing on board. Differences within ±2 s are noise.</p>
        </div>
        <div class="card">
          <div class="card-head"><h3>Share of flights within target</h3><span class="muted sm">${mc.reps} runs per method</span></div>
          <div id="planBars" class="chart-box"></div>
        </div>
      </div>
      ${!state.cfg.risk || state.cfg.risk === 'off'
        ? '<p class="hint"><b>Disruptions are off</b>, so these times assume a clean boarding. Set <i>Disruptions</i> to Realistic in the sidebar and update the estimates to add a risk buffer. The Risk tab shows what drives it.</p>'
        : `<p class="hint">Includes disruptions (${esc(BS.RISK_LEVELS[state.cfg.risk].toLowerCase())}): boarding pauses, late passengers and incidents are part of every run above.</p>`}
      <p class="hint">These are planning estimates from the simulation model, not a guarantee. Before committing to a change, calibrate the behaviour settings against your own boarding timestamps.</p>`;
    $('#planBars').innerHTML = BS.barChart({ rows: targetRows, fmt: pct, width: boxWidth('#planBars', 420), label: 'Within target' });
  }

  // ---------------------------------------------------------------- methods
  function buildMethods() {
    const ac = BS.getAircraft(state.acId);
    const grid = $('#methodsGrid');
    grid.innerHTML = BS.STRATEGIES.map((s) => `
      <article class="method">
        <div class="method-top"><span class="sw" style="background:${s.color}"></span><h3>${esc(s.name)}</h3>
          <span class="dots" title="Practicality ${s.practicality}/5">${[1, 2, 3, 4, 5].map((i) => `<i class="${i <= s.practicality ? 'on' : ''}"></i>`).join('')}</span></div>
        <p class="tagline">${esc(s.tagline)}</p>
        <div class="pattern"><canvas data-id="${s.id}"></canvas></div>
        <p class="desc">${esc(s.desc)}</p>
        ${s.groupCalls ? `<ol class="calls"><li>Pre-boarding: assistance, families</li>${s.groupCalls.map(([, l]) => `<li>${esc(l)}</li>`).join('')}</ol>` : ''}
        <div class="pc"><div><b>Pros</b><ul>${s.pros.map((p) => `<li>${esc(p)}</li>`).join('')}</ul></div><div><b>Cons</b><ul>${s.cons.map((p) => `<li>${esc(p)}</li>`).join('')}</ul></div></div>
        <div class="method-foot"><span>${esc(s.usedBy)}<br>${esc(s.source)}</span>
          <button class="btn sm ${state.strategies.includes(s.id) ? '' : 'primary'}" data-add="${s.id}">${state.strategies.includes(s.id) ? 'In comparison' : 'Compare'}</button></div>
      </article>`).join('');
    requestAnimationFrame(() => {
      $$('#methodsGrid canvas').forEach((c) => BS.drawPattern(c, ac, BS.getStrategy(c.dataset.id), state.cfg));
    });
    $$('#methodsGrid [data-add]').forEach((b) => b.addEventListener('click', () => {
      const id = b.dataset.add;
      if (!state.strategies.includes(id)) {
        if (state.strategies.length >= MAX_LANES) state.strategies.pop();
        state.strategies.push(id);
        syncStrategies();
        rebuild();
      }
      switchView('simulate');
    }));
  }

  // ---------------------------------------------------------------- views, misc
  function switchView(v) {
    state.view = v;
    $$('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.view === v));
    $$('.view').forEach((s) => s.classList.toggle('active', s.id === 'view-' + v));
    if (v !== 'simulate') setPlaying(false);
    if (v === 'methods') buildMethods();
    if (v === 'analyze') { renderMC(); renderSens(); }
    if (v === 'risk') { renderRiskTable(); renderRisk(); }
    if (v === 'simulate') { for (const l of state.lanes) l.renderer.layout(); renderFrame(true); }
    if (v === 'plan' && state.plan && state.plan.key === scenarioKey()) renderPlan();
    $('#app').classList.remove('side-open');
    $('#main').scrollTop = 0;
    writeHash();
  }

  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
  }

  function setTheme(th) {
    document.documentElement.dataset.theme = th;
    try { localStorage.setItem('boarding-lab-theme', th); } catch (e) { /* storage unavailable */ }
    for (const l of state.lanes) l.renderer.readTheme();
    if (state.lanes.length) renderFrame(true);
    if (state.view === 'methods') buildMethods();
  }

  function bindChrome() {
    $$('#tabs button').forEach((b) => b.addEventListener('click', () => switchView(b.dataset.view)));
    $$('[data-goto]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); switchView(a.dataset.goto); }));
    $('#themeBtn').addEventListener('click', () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));
    $('#menuBtn').addEventListener('click', () => $('#app').classList.toggle('side-open'));
    $('#scrim').addEventListener('click', () => $('#app').classList.remove('side-open'));
    $('#mcRunBtn').addEventListener('click', runAnalysis);
    $$('[data-action="mc"]').forEach((b) => b.addEventListener('click', runAnalysis));
    $$('#mcScopeSeg button').forEach((b) => b.addEventListener('click', () => { state.mcScope = b.dataset.v; $$('#mcScopeSeg button').forEach((x) => x.classList.toggle('on', x === b)); }));
    $$('#mcRepsSeg button').forEach((b) => b.addEventListener('click', () => { state.mcReps = +b.dataset.v; $$('#mcRepsSeg button').forEach((x) => x.classList.toggle('on', x === b)); }));
    $('#csvBtn').addEventListener('click', downloadCsv);
    $('#sensRunBtn').addEventListener('click', runSensitivity);
    $('#planRunBtn').addEventListener('click', runPlan);
    $('#riskRunBtn').addEventListener('click', runRisk);
    $$('[data-action="risk"]').forEach((b) => b.addEventListener('click', runRisk));
    $$('#riskLevelSeg button').forEach((b) => b.addEventListener('click', () => {
      state.riskLevel = b.dataset.v;
      $$('#riskLevelSeg button').forEach((x) => x.classList.toggle('on', x === b));
      renderRiskTable();
    }));
    $$('#riskRepsSeg button').forEach((b) => b.addEventListener('click', () => { state.riskReps = +b.dataset.v; $$('#riskRepsSeg button').forEach((x) => x.classList.toggle('on', x === b)); }));
    $('#riskResetBtn').addEventListener('click', () => { state.cfg.riskEdits = null; renderRiskTable(); rebuildSoon(0); });

    // charts are drawn at their real pixel width, so redraw them when the panel changes size
    let rt, lastMainW = 0;
    new ResizeObserver((entries) => {
      const w = Math.round(entries[0].contentRect.width);
      if (w === lastMainW) return;
      lastMainW = w;
      clearTimeout(rt);
      rt = setTimeout(() => {
        if (state.view === 'analyze') { renderMC(); renderSens(); }
        else if (state.view === 'risk') renderRisk();
        else if (state.view === 'plan' && state.plan && state.plan.key === scenarioKey()) renderPlan();
        else if (state.view === 'simulate' && state.lanes.length) renderLiveChart();
      }, 150);
    }).observe($('#main'));
  }

  // ---------------------------------------------------------------- boot
  window.addEventListener('error', (e) => console.error('[BoardingLab] error:', e.message, e.filename + ':' + e.lineno));
  window.addEventListener('unhandledrejection', (e) => console.error('[BoardingLab] rejection:', e.reason && (e.reason.stack || e.reason)));

  function boot() {
    let th = null;
    try { th = localStorage.getItem('boarding-lab-theme'); } catch (e) { /* ignore */ }
    if (!th && window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches) th = 'dark';
    document.documentElement.dataset.theme = th || 'light';
    readHash();
    buildSidebar();
    syncSidebar();
    fillPlanSelects();
    bindTransport();
    bindChrome();
    rebuild();
    if (state.view !== 'simulate') switchView(state.view);
    BS.app = { state, rebuild, seek, setPlaying, runAnalysis, runPlan, switchView }; // handy for debugging / embedding
    console.info('[BoardingLab] ready', state.acId, state.strategies.join(','), state.results.map((x) => `${x.s.short}=${fmt(x.r.totalTime)}`).join(' '));
    if (window.BL_SELFTEST || /selftest/.test(location.search + location.hash)) selfTest();
  }

  // Exercise every view once and log the outcome (used for automated checks: add #selftest to the URL)
  async function selfTest() {
    try {
      seek(state.tEnd / 2); setPlaying(true); await new Promise((r) => setTimeout(r, 300)); setPlaying(false);
      for (const c of ['order', 'group', 'status']) { state.colorBy = c; renderFrame(true); }
      switchView('methods'); await new Promise((r) => setTimeout(r, 100));
      state.mcReps = 25; state.mcScope = 'all'; switchView('analyze'); await runAnalysis();
      $('#sensParam').value = 'carryOnShare'; await runSensitivity();
      switchView('plan'); await runPlan();
      state.riskReps = 25; switchView('risk'); await runRisk();
      if (!state.risk || !state.risk.impact.length) throw new Error('risk analysis produced no impact data');
      setTheme('dark'); setTheme('light');
      switchView('simulate');
      console.info('[BoardingLab] selftest OK', Object.values(state.mc.rows).map((r) => `${r.s.short}:${fmt(r.stats.p50)}`).join(' '), 'levers:', state.plan.levers.length, 'risk:', state.risk.impact.map((e) => `${e.id}+${Math.round(e.value)}s`).join(' '));
    } catch (e) { console.error('[BoardingLab] selftest FAILED', e && e.stack); }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
