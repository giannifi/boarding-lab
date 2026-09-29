/* Boarding Lab — simulation engine
 * ---------------------------------------------------------------
 * Agent-based, fixed time step (dt = 0.25 s), deterministic for a given seed.
 *
 * Space: each aisle is a line of cells, one per seat row, plus a galley cell
 * at each end (cell 0 = forward, cell N+1 = aft). One passenger per cell,
 * so a passenger stowing a bag blocks everyone behind them (aisle interference).
 *
 * Passenger lifecycle:
 *   QUEUED → WALK (1 cell per `walk` seconds, waits if the next cell is taken)
 *          → STOW (bag in overhead bin; slower when bins are full; may have to
 *                  use a bin a few rows away, or the bag gets gate-checked)
 *          → SHUFFLE (seated neighbours between them and their seat must stand
 *                     up = seat interference)
 *          → INCIDENT (optional disruption holding the aisle: wrong seat, bag to
 *                      the hold, seat swap, crew assistance, medical)
 *          → SEATED
 * Flight-level disruptions (boarding pause, late passengers, no-show offload)
 * are drawn per seed in BS.drawDisruptions, so methods face identical events.
 *
 * Calibration defaults reproduce the ranking and rough magnitudes of the
 * Steffen & Hotchkiss (2011) mock-up experiment (see test/calibrate.js).
 */
(function (root) {
  'use strict';
  const BS = (root.BS = root.BS || {});

  // ---------- RNG ----------
  BS.rng = function (seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  BS.hashStr = function (s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  };
  const normal = (rng) => {
    let u = 0, v = 0;
    while (u === 0) u = rng();
    while (v === 0) v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  const lognorm = (rng, mean, cv) => {
    const s2 = Math.log(1 + cv * cv);
    return Math.exp(Math.log(mean) - s2 / 2 + Math.sqrt(s2) * normal(rng));
  };

  // ---------- parameters ----------
  BS.DEFAULTS = {
    loadFactor: 1.0,       // share of seats occupied
    carryOnShare: 0.6,     // passengers with a roller bag for the overhead bin
    backpackBinShare: 0.3, // of the others: share putting a backpack/coat in the bin (0.5 bin units)
    binCapacity: 0.65,     // roller-bag units of bin space per seat
    walkSec: 0.9,          // seconds to walk one row (unhindered)
    slowShare: 0.08,       // elderly / slow walkers
    stowSec: 5.0,          // mean time to stow a roller bag into an empty bin
    shuffleBase: 3.0,      // fixed cost when seated neighbours must stand up
    shufflePer: 2.0,       // additional seconds per neighbour who has to get up
    headway: 2.0,          // min seconds between passengers entering through one door
    partyShare: 0.0,       // share of passengers travelling in parties sitting together
    preboard: false,       // PRM + families + premium cabin board first
    prmShare: 0.01,        // passengers needing assistance
    compliance: 1.0,       // share boarding with their own group
    eliteShare: 0.15,      // economy passengers with frequent-flyer status (boarding priority)
    priorityShare: 0.10,   // bought priority / co-brand credit card / extra-legroom seat
    basicShare: 0.15,      // basic-economy fares, boarded last
    doors: null,           // array of door ids; null = aircraft defaults
    risk: 'off',           // disruption level: 'off' | 'realistic' | 'bad'  (see BS.RISK_EVENTS)
    riskEdits: null,       // optional per-event overrides { id: { on, p, mean } }
  };

  BS.PRESETS = {
    lab: { label: 'Ideal lab', hint: 'Everyone follows instructions. No families, no incidents.', cfg: { partyShare: 0, preboard: false, compliance: 1, carryOnShare: 0.6, slowShare: 0.05, loadFactor: 1, headway: 2.0, walkSec: 0.9, eliteShare: 0.15, priorityShare: 0.1, basicShare: 0.15 } },
    scheduled: { label: 'Typical scheduled flight', hint: 'Pre-boarding, some travel parties, 85% of passengers board with their group.', cfg: { partyShare: 0.3, preboard: true, compliance: 0.85, carryOnShare: 0.6, slowShare: 0.08, loadFactor: 0.88, headway: 2.5, walkSec: 0.9, eliteShare: 0.15, priorityShare: 0.1, basicShare: 0.15 } },
    leisure: { label: 'Leisure / holiday charter', hint: 'Families, heavy cabin bags, full flight.', cfg: { partyShare: 0.6, preboard: true, compliance: 0.8, carryOnShare: 0.8, slowShare: 0.1, loadFactor: 0.97, headway: 2.8, walkSec: 1.0, eliteShare: 0.05, priorityShare: 0.15, basicShare: 0.25 } },
    shuttle: { label: 'Business shuttle', hint: 'Frequent flyers, light bags, fast walkers.', cfg: { partyShare: 0.05, preboard: true, compliance: 0.9, carryOnShare: 0.45, slowShare: 0.03, loadFactor: 0.8, headway: 2.2, walkSec: 0.8, eliteShare: 0.35, priorityShare: 0.15, basicShare: 0.05 } },
  };

  // ---------- disruptions ----------
  /**
   * Irregular events that happen during real boardings. Probabilities are planning assumptions
   * (per passenger for scope 'pax', per flight for scope 'flight'); calibrate them against your
   * own irregularity reports. `mean` is seconds (lognormal with coefficient of variation `cv`).
   */
  BS.RISK_EVENTS = [
    { id: 'wrongSeat', label: 'Someone in my seat', scope: 'pax', p: { realistic: 0.02, bad: 0.04 }, mean: 12, cv: 0.35,
      desc: 'A passenger sits in the wrong seat; the owner waits in the aisle while it is sorted out.' },
    { id: 'bagToHold', label: 'Bag doesn’t fit: crew takes it to the hold', scope: 'pax', needsBag: true, p: { realistic: 0.015, bad: 0.035 }, mean: 25, cv: 0.4,
      desc: 'An oversized or late bag won’t fit. Crew tags it and carries it forward against the flow.' },
    { id: 'seatSwap', label: 'Seat-swap negotiation', scope: 'pax', p: { realistic: 0.01, bad: 0.025 }, mean: 20, cv: 0.5,
      desc: 'A passenger asks others to swap seats (sitting together, window, legroom).' },
    { id: 'crewAssist', label: 'Crew assistance at the seat', scope: 'pax', p: { realistic: 0.01, bad: 0.02 }, mean: 18, cv: 0.4,
      desc: 'Help lifting a bag, a seat-belt extender, a question about the seat.' },
    { id: 'medical', label: 'Medical / assistance incident in the aisle', scope: 'flight', p: { realistic: 0.05, bad: 0.15 }, mean: 120, cv: 0.4,
      desc: 'A passenger feels unwell or needs substantial help. The aisle is blocked at their row.' },
    { id: 'gatePause', label: 'Boarding paused at the door', scope: 'flight', p: { realistic: 0.15, bad: 0.35 }, mean: 180, cv: 0.5,
      desc: 'Flow stops mid-boarding: cabin not ready, catering or cleaning still on board, security check, load-sheet hold.' },
    { id: 'latePax', label: 'Late passengers', scope: 'flight', p: { realistic: 0.35, bad: 0.6 }, count: { realistic: [1, 3], bad: [2, 5] }, mean: 150, cv: 0.6,
      desc: 'Passengers from a late connection or the lounge arrive after the queue has cleared.' },
    { id: 'offload', label: 'No-show with checked bag: offload', scope: 'flight', p: { realistic: 0.05, bad: 0.12 }, mean: 600, cv: 0.3, afterBoarding: true,
      desc: 'A checked-in passenger never shows up. Their bag must be found and offloaded before the doors close. It adds to door-close time, not to boarding time.' },
  ];
  BS.RISK_LEVELS = { off: 'Off', realistic: 'Realistic day', bad: 'Bad day' };

  /** Active events for a config: level defaults + user edits (optionally one event only). */
  BS.riskProfile = function (cfg, level, onlyId) {
    level = level || cfg.risk;
    if (!level || level === 'off') return [];
    const edits = cfg.riskEdits || {};
    return BS.RISK_EVENTS.map((e) => {
      const ed = edits[e.id] || {};
      return {
        ...e,
        on: ed.on !== undefined ? ed.on : true,
        p: ed.p != null ? ed.p : e.p[level],
        mean: ed.mean != null ? ed.mean : e.mean,
        count: e.count ? e.count[level] : null,
      };
    }).filter((e) => e.on && e.p > 0 && (!onlyId || e.id === onlyId));
  };

  /**
   * Draw which disruptions hit this flight. Uses its own RNG stream with a fixed number of draws
   * per passenger and event, so the same seed gives the same events whichever method is boarding,
   * and a "bad day" contains every event of a "realistic day" (same uniforms, higher thresholds).
   */
  BS.drawDisruptions = function (pax, profile, seed) {
    const rng = BS.rng(seed ^ 0x7f4a7c15);
    const active = new Map(profile.map((e) => [e.id, e]));
    const holds = new Map();     // pax id → [{ type, dur }]
    const late = new Map();      // pax id → seconds after the regular queue has cleared
    const flight = { pause: null, offload: 0, noShowId: -1 };
    const addHold = (id, type, dur) => { if (!holds.has(id)) holds.set(id, []); holds.get(id).push({ type, dur }); };

    const paxEvents = BS.RISK_EVENTS.filter((e) => e.scope === 'pax');
    for (const p of pax) {
      for (const def of paxEvents) {
        const u = rng(), m = lognorm(rng, 1, def.cv);
        const e = active.get(def.id);
        if (!e || (def.needsBag && p.bagUnits < 1)) continue;
        if (u < e.p) addHold(p.id, def.id, e.mean * m);
      }
    }
    for (const def of BS.RISK_EVENTS.filter((e) => e.scope === 'flight')) {
      const u = rng(), m = lognorm(rng, 1, def.cv), u2 = rng(), u3 = rng();
      const e = active.get(def.id);
      if (!e || u >= e.p || !pax.length) continue;
      const dur = e.mean * m;
      if (def.id === 'medical') addHold(pax[Math.floor(u2 * pax.length)].id, 'medical', dur);
      else if (def.id === 'gatePause') flight.pause = { atFrac: 0.2 + 0.5 * u2, dur };
      else if (def.id === 'offload') { flight.offload = dur; flight.noShowId = pax[Math.floor(u2 * pax.length)].id; }
      else if (def.id === 'latePax') {
        const [lo, hi] = e.count || [1, 3];
        const k = Math.min(pax.length - 1, lo + Math.floor(u3 * (hi - lo + 1)));
        const lr = BS.rng((seed ^ 0x3c6ef372) + 1);
        const pool = pax.map((p) => p.id);
        for (let i = 0; i < k; i++) {
          const j = i + Math.floor(lr() * (pool.length - i));
          [pool[i], pool[j]] = [pool[j], pool[i]];
          late.set(pool[i], e.mean * lognorm(lr, 1, def.cv));
        }
      }
    }
    return { holds, late, flight };
  };

  BS.STATE = { QUEUED: 0, WALK: 1, BLOCKED: 2, STOW: 3, SHUFFLE: 4, SEATED: 5, STANDING: 6, INCIDENT: 7 };
  const S = BS.STATE;
  const EARLY_STOW_ROWS = 2; // a blocked passenger this close to their row stows the bag where they stand

  // ---------- passengers ----------
  /** Deterministic passenger population for (aircraft, cfg, seed). Shared by all strategies in a comparison. */
  BS.generatePassengers = function (ac, cfg, seed) {
    const rng = BS.rng(seed ^ 0x9e3779b9);
    const idx = BS.shuffle(ac.seats.map((_, i) => i), rng);
    const nOcc = Math.max(1, Math.round(ac.seats.length * cfg.loadFactor));
    const occ = new Uint8Array(ac.seats.length);
    for (let i = 0; i < nOcc; i++) occ[idx[i]] = 1;

    const pax = [];
    for (const s of ac.seats) {
      if (!occ[s.idx]) continue;
      const prm = rng() < cfg.prmShare;
      const slow = !prm && rng() < cfg.slowShare;
      const walkMean = prm ? cfg.walkSec * 2.8 : slow ? cfg.walkSec * 1.9 : cfg.walkSec;
      const walk = Math.min(6, Math.max(0.45, lognorm(rng, walkMean, 0.18)));
      const r = rng();
      const roller = r < cfg.carryOnShare;
      const bp = rng(); // always drawn, so changing the bag share doesn't reshuffle everyone else's traits
      const backpack = !roller && bp < cfg.backpackBinShare;
      const bagUnits = roller ? 1 : backpack ? 0.5 : 0;
      let stowBase = roller ? lognorm(rng, cfg.stowSec, 0.45) : backpack ? lognorm(rng, cfg.stowSec * 0.45, 0.4) : 0;
      if (prm) stowBase += 4;
      const settle = lognorm(rng, 1.6, 0.35);            // turning, sitting down
      const shuffleJ = lognorm(rng, 1, 0.3);             // personal factor for seat shuffles
      pax.push({
        id: pax.length, seat: s, row: s.row, lane: s.lane, side: s.side, fromAisle: s.fromAisle,
        slot: s.slot, cls: s.cls, walk, bagUnits, stowBase, settle, shuffleJ,
        prm, slow, party: -1, family: false,
      });
    }

    // fare / status tiers (separate RNG stream so the other passenger traits stay identical).
    // Status holders cluster in the front of economy and avoid middle seats; basic-economy
    // passengers get seats assigned at check-in, mostly middles towards the back.
    const trng = BS.rng(seed ^ 0x2545f491);
    const econRows = ac.rows.filter((r) => r.cls === 'Y').map((r) => r.row);
    const eFirst = econRows.length ? econRows[0] : 1;
    const eSpan = Math.max(1, econRows.length - 1);
    for (const p of pax) {
      if (p.cls !== 'Y') { p.tier = 'premium'; continue; }
      const pos = (p.row - eFirst) / eSpan;          // 0 = front of economy, 1 = last row
      const middle = !p.seat.isWindow && p.fromAisle > 0;
      const pElite = (cfg.eliteShare || 0) * (pos < 0.2 ? 1.8 : pos > 0.6 ? 0.6 : 1) * (middle ? 0.4 : 1.25);
      const pPrio = (cfg.priorityShare || 0) * (pos < 0.2 ? 1.3 : 1);
      const pBasic = (cfg.basicShare || 0) * (middle ? 1.9 : 0.6) * (pos > 0.5 ? 1.25 : 0.75);
      const u = trng();
      p.tier = u < pElite ? 'elite' : u < pElite + pPrio ? 'priority' : u < pElite + pPrio + pBasic ? 'basic' : 'main';
    }

    // travel parties: contiguous seats in one half-row
    if (cfg.partyShare > 0) {
      const halves = new Map();
      for (const p of pax) {
        const k = p.row * 64 + p.lane * 2 + p.side;
        if (!halves.has(k)) halves.set(k, []);
        halves.get(k).push(p);
      }
      let partyId = 0;
      const pRow = Math.min(1, cfg.partyShare * 1.25);
      for (const list of halves.values()) {
        if (list.length < 2 || rng() >= pRow) continue;
        list.sort((a, b) => b.fromAisle - a.fromAisle);
        const size = list.length >= 3 && rng() < 0.4 ? 3 : 2;
        const members = list.slice(0, size);
        let contiguous = true;
        for (let i = 1; i < members.length; i++) if (members[i - 1].fromAisle - members[i].fromAisle !== 1) contiguous = false;
        if (!contiguous) continue;
        const family = size === 3 && rng() < 0.5;
        for (const m of members) { m.party = partyId; m.family = family; }
        partyId++;
      }
    }
    return pax;
  };

  // ---------- boarding queue ----------
  /** Strategy order + real-world effects → final door queue. */
  BS.buildQueue = function (ac, pax, strategy, cfg, seed) {
    const rng = BS.rng((seed * 2654435761) ^ BS.hashStr(strategy.id));
    let seq = strategy.order(pax, ac, rng).map((e) => ({ p: e.p, g: e.g, pre: 0 }));
    const nGroups = new Set(seq.map((e) => e.g)).size;

    // 1. Passengers who ignore their group call (they board early)
    if (cfg.compliance < 1 && nGroups > 1) {
      const out = seq.slice();
      for (let i = 0; i < seq.length; i++) {
        if (rng() < cfg.compliance) continue;
        const e = seq[i];
        const cur = out.indexOf(e);
        out.splice(cur, 1);
        out.splice(Math.floor(rng() * (cur + 1)), 0, e);
      }
      seq = out;
    }

    // 2. Travel parties walk on together (window seat first)
    if (!strategy.openSeating && seq.some((e) => e.p.party >= 0)) {
      const byParty = new Map();
      for (const e of seq) if (e.p.party >= 0) {
        if (!byParty.has(e.p.party)) byParty.set(e.p.party, []);
        byParty.get(e.p.party).push(e);
      }
      const done = new Set();
      const out = [];
      for (const e of seq) {
        if (e.p.party < 0) { out.push(e); continue; }
        if (done.has(e.p.party)) continue;
        done.add(e.p.party);
        const members = byParty.get(e.p.party).sort((a, b) => b.p.fromAisle - a.p.fromAisle);
        for (const m of members) out.push({ ...m, g: e.g });
      }
      seq = out;
    }

    // 3. Pre-boarding: assistance, families, premium cabins (always on for airline group methods)
    if (cfg.preboard || strategy.preboard) {
      const rank = (e) => (e.p.prm ? 0 : e.p.family ? 1 : e.p.cls !== 'Y' ? 2 : 3);
      seq = seq.map((e, i) => ({ e, i, r: rank(e) }))
        .sort((a, b) => a.r - b.r || a.i - b.i)
        .map((x) => { if (x.r < 2) x.e.pre = x.r + 1; else if (x.r === 2 && !strategy.preboard) x.e.pre = 3; return x.e; });
    }
    return seq;
  };

  // ---------- simulation ----------
  /**
   * Run one boarding to completion.
   * opts.record: keep frames for playback (0.5 s) and per-second series.
   */
  BS.runSim = function (ac, pax, strategy, cfg, seed, opts) {
    opts = opts || {};
    const record = !!opts.record;
    const dt = 0.25;
    const frameDt = 0.5;
    // disruptions (opts.riskOnly = one event id, used to measure each event's marginal impact)
    const profile = BS.riskProfile(cfg, null, opts.riskOnly);
    const dis = profile.length ? BS.drawDisruptions(pax, profile, seed) : null;
    let queue = BS.buildQueue(ac, pax, strategy, cfg, seed);
    if (dis && dis.flight.noShowId >= 0) queue = queue.filter((e) => e.p.id !== dis.flight.noShowId);
    const n = queue.length;
    const N = ac.N;
    const cells = N + 2;
    const lanes = ac.lanes;
    const rng = BS.rng(seed ^ 0x51ed270b ^ BS.hashStr(strategy.id));

    // doors
    let doors = ac.doors.filter((d) => (cfg.doors ? cfg.doors.includes(d.id) : d.default));
    if (!doors.length) doors = ac.doors.filter((d) => d.default);
    if (!doors.length) doors = [ac.doors[0]];

    // agents (copy of passenger + dynamic state)
    const agents = queue.map((e, i) => ({
      ...e.p, pid: e.p.id, id: i, order: i, group: e.g, pre: e.pre,
      state: S.QUEUED, cell: -1, prevCell: -1, moveStart: 0, nextAt: 0, busyUntil: 0,
      blocked: false, blockedSince: 0, waitAisle: 0, enterAt: -1, seatedAt: -1,
      standUntil: 0, door: 0, dir: 1, gateChecked: false, bagDone: false, early: false, seatPicked: false,
      holds: dis ? dis.holds.get(e.p.id) || null : null,
      lateDelay: dis ? dis.late.get(e.p.id) || 0 : 0,
    }));

    // assign doors
    const openSeating = !!strategy.openSeating;
    const doorQueues = doors.map(() => []);
    agents.forEach((a, i) => {
      let best = 0;
      if (openSeating) best = i % doors.length;
      else {
        let bd = Infinity;
        doors.forEach((d, di) => { const dd = Math.abs(a.row - d.cell); if (dd < bd) { bd = dd; best = di; } });
      }
      a.door = best;
      doorQueues[best].push(a);
    });
    // late passengers join the back of their door queue and only arrive after the regular queue has cleared
    for (let d = 0; d < doorQueues.length; d++) {
      doorQueues[d] = doorQueues[d].filter((a) => !a.lateDelay).concat(doorQueues[d].filter((a) => a.lateDelay));
    }
    let regularLeft = agents.filter((a) => !a.lateDelay).length;
    let regularDoneAt = regularLeft === 0 ? 0 : -1;
    let entered = 0, pauseUntil = -1, pauseDone = false;
    const doorNext = doors.map(() => 0);
    const doorHead = doors.map(() => 0);

    // open seating: seat pool
    const seatTaken = new Uint8Array(ac.seats.length);
    const seatScore = (s, doorCell) => {
      const dist = Math.abs(s.row - doorCell) / N;
      const type = s.isWindow ? 1.0 : s.fromAisle === 0 ? 0.85 : 0.2;
      return type * 1.2 - dist * 0.9 + rng() * 0.6;
    };
    const pickSeat = (a) => {
      const dc = doors[a.door].cell;
      const nearestDoor = (s) => {
        let bd = Infinity, bi = 0;
        doors.forEach((d, di) => { const dd = Math.abs(s.row - d.cell); if (dd < bd) { bd = dd; bi = di; } });
        return bi;
      };
      let best = null, bs = -Infinity;
      for (const own of [true, false]) { // prefer seats served by this door
        for (const s of ac.seats) {
          if (seatTaken[s.idx]) continue;
          if (own && doors.length > 1 && nearestDoor(s) !== a.door) continue;
          const sc = seatScore(s, dc);
          if (sc > bs) { bs = sc; best = s; }
        }
        if (best) break;
      }
      seatTaken[best.idx] = 1;
      a.seat = best; a.row = best.row; a.lane = best.lane; a.side = best.side;
      a.fromAisle = best.fromAisle; a.slot = best.slot; a.cls = best.cls;
    };

    // occupancy
    const occ = [];
    for (let l = 0; l < lanes; l++) occ.push(new Int32Array(cells).fill(-1));

    // overhead bins per (lane, side, row)
    const binIdx = (lane, side, row) => (lane * 2 + side) * cells + row;
    const binCap = new Float32Array(lanes * 2 * cells);
    const binFill = new Float32Array(lanes * 2 * cells);
    for (const s of ac.seats) binCap[binIdx(s.lane, s.side, s.row)] += cfg.binCapacity;
    const binEvents = [];

    // seated per half-row
    const halfSeated = new Map();
    const hk = (a) => a.row * 64 + a.lane * 2 + a.side;

    // metrics
    let t = 0, seated = 0, firstEnter = -1, aisleInterf = 0, seatInterf = 0,
      gateChecked = 0, binAway = 0, firstBinFull = -1, doorBlocked = 0;
    const events = [];
    const disCount = {};   // disruption id → occurrences
    const disSec = {};     // disruption id → seconds of aisle blocking / pause
    const countDis = (id, sec) => { disCount[id] = (disCount[id] || 0) + 1; disSec[id] = (disSec[id] || 0) + sec; };
    const RISK_TEXT = { wrongSeat: 'Someone in the wrong seat', bagToHold: 'Bag doesn’t fit: crew takes it to the hold', seatSwap: 'Seat-swap negotiation', crewAssist: 'Crew assisting at the seat', medical: 'Medical incident: aisle blocked' };
    let active = [];

    // recording
    const frames = [];
    const series = { seated: [], aisle: [], seat: [], inAisle: [], queued: [], paused: [] };
    let nextFrame = 0, nextSec = 0;

    // bag into overhead bin near `row`; returns seconds spent
    const doStow = (a, row) => {
      let t0 = 0;
      if (a.bagUnits > 0 && !a.bagDone) {
        a.bagDone = true;
        const u = a.bagUnits;
        const tries = [];
        for (let d = 0; d <= 3; d++) {
          for (const sgn of d === 0 ? [0] : [-1, 1]) {
            const r = row + sgn * d;
            if (r < 1 || r > N) continue;
            tries.push([a.lane, a.side, r, d]);
            tries.push([a.lane, 1 - a.side, r, d + 0.5]);
          }
        }
        let placed = false;
        for (const [l, sd, r, d] of tries) {
          const k = binIdx(l, sd, r);
          if (binCap[k] <= 0) continue;
          if (binFill[k] + u <= binCap[k] + 1e-6) {
            const ratio = binFill[k] / binCap[k];
            binFill[k] += u;
            if (binFill[k] >= binCap[k] - 1e-6 && firstBinFull < 0) {
              firstBinFull = t;
              events.push({ t, type: 'bin', text: `First bin full (row ${r})` });
            }
            if (record) binEvents.push({ t, k, u });
            t0 += a.stowBase * (1 + 0.9 * ratio * ratio) + (d > 0 ? 2 + 1.8 * d : 0);
            if (d > 0) binAway++;
            placed = true;
            break;
          }
        }
        if (!placed) { // bins full nearby → bag goes in the hold
          gateChecked++;
          a.gateChecked = true;
          t0 += 4; // hand over bag to crew
          if (gateChecked === 1) events.push({ t, type: 'gate', text: 'Bins full: bags now being checked into the hold' });
        }
      }
      return t0;
    };

    const seatAgent = (a) => {
      occ[a.lane][a.cell] = -1;
      a.state = S.SEATED;
      a.seatedAt = t;
      a.cell = a.row;
      seated++;
      const k = hk(a);
      if (!halfSeated.has(k)) halfSeated.set(k, []);
      halfSeated.get(k).push(a);
      if (seated === Math.ceil(n / 2)) events.push({ t, type: 'half', text: '50% seated' });
      if (seated === n) events.push({ t, type: 'done', text: 'Boarding complete' });
    };

    const snapshot = () => {
      const pos = new Float32Array(n);
      const st = new Uint8Array(n);
      for (let i = 0; i < n; i++) {
        const a = agents[i];
        let s = a.state;
        if (s === S.WALK && a.blocked) s = S.BLOCKED;
        if (s === S.SEATED && a.standUntil > t) s = S.STANDING;
        st[i] = s;
        if (s === S.WALK && t < a.nextAt && a.prevCell >= 0) {
          const f = Math.min(1, (t - a.moveStart) / Math.max(0.01, a.nextAt - a.moveStart));
          pos[i] = a.prevCell + (a.cell - a.prevCell) * f;
        } else pos[i] = a.cell;
      }
      frames.push({ pos, st });
    };

    const LIMIT = 3 * 3600;
    while (seated < n && t < LIMIT) {
      // --- boarding pause (disruption): the door stops admitting passengers for a while
      if (dis && dis.flight.pause && !pauseDone && entered >= Math.floor(dis.flight.pause.atFrac * n)) {
        pauseDone = true;
        pauseUntil = t + dis.flight.pause.dur;
        countDis('gatePause', dis.flight.pause.dur);
        events.push({ t, type: 'risk', text: `Boarding paused at the door for ${BS.fmtTime(dis.flight.pause.dur)}` });
      }
      const paused = t < pauseUntil;

      // --- spawn at doors
      for (let d = 0; d < doors.length && !paused; d++) {
        const q = doorQueues[d];
        if (doorHead[d] >= q.length || t < doorNext[d]) continue;
        const a = q[doorHead[d]];
        if (a.lateDelay && (regularDoneAt < 0 || t < regularDoneAt + a.lateDelay)) continue; // late passenger not here yet
        if (openSeating && !a.seatPicked) { pickSeat(a); a.seatPicked = true; }
        const cell = doors[d].cell;
        if (occ[a.lane][cell] !== -1) { doorBlocked += dt; continue; } // aisle backed up to the door
        doorHead[d]++;
        occ[a.lane][cell] = a.id;
        a.cell = cell; a.prevCell = cell; a.state = S.WALK; a.enterAt = t; a.moveStart = t;
        a.dir = a.row >= cell ? 1 : -1;
        a.nextAt = t + a.walk;
        if (firstEnter < 0) firstEnter = t;
        doorNext[d] = t + cfg.headway * (0.75 + rng() * 0.5);
        active.push(a);
        entered++;
        if (a.lateDelay) { countDis('latePax', a.lateDelay); events.push({ t, type: 'risk', text: `Late passenger arrives (row ${a.row})` }); }
        else if (--regularLeft === 0) regularDoneAt = t;
      }

      // --- move: process agents closest to their destination side first so trains flow
      active.sort((x, y) => (x.dir === y.dir ? (y.cell - x.cell) * x.dir : x.dir - y.dir));
      for (const a of active) {
        if (a.state === S.WALK) {
          if (t < a.nextAt) continue;
          if (a.cell === a.row) {
            if (a.blocked) { if (t - a.blockedSince >= 1) aisleInterf++; a.blocked = false; }
            a.state = S.STOW;
            a.early = false;
            a.busyUntil = t + doStow(a, a.row) + a.settle;
            continue;
          }
          const nxt = a.cell + a.dir;
          const lane = occ[a.lane];
          const o = lane[nxt] === -1 ? null : agents[lane[nxt]];
          if (!o) {
            lane[a.cell] = -1;
            lane[nxt] = a.id;
            a.prevCell = a.cell; a.cell = nxt; a.moveStart = t;
            a.nextAt = t + a.walk;
            if (a.blocked) {
              if (t - a.blockedSince >= 1) aisleInterf++;
              a.blocked = false;
            }
          } else if (o.state === S.WALK && o.dir === -a.dir && t >= o.nextAt && o.cell !== o.row) {
            // two people walking towards each other squeeze past (swap cells)
            lane[a.cell] = o.id; lane[nxt] = a.id;
            o.prevCell = nxt; o.cell = a.cell; o.moveStart = t; o.nextAt = t + o.walk * 1.5;
            a.prevCell = a.cell; a.cell = nxt; a.moveStart = t; a.nextAt = t + a.walk * 1.5;
            a.blocked = false; o.blocked = false;
          } else {
            if (!a.blocked) { a.blocked = true; a.blockedSince = t; }
            a.waitAisle += dt;
            // stuck one row short of their seat: use the time to stow the bag here
            if (a.bagUnits > 0 && !a.bagDone && Math.abs(a.row - a.cell) <= EARLY_STOW_ROWS && a.cell >= 1 && a.cell <= N && t - a.blockedSince >= 1) {
              a.state = S.STOW; a.early = true;
              a.busyUntil = t + doStow(a, a.cell);
            }
          }
        } else if (a.state === S.STOW && a.early) {
          if (t < a.busyUntil) continue;
          a.state = S.WALK; a.early = false; a.nextAt = t; // bag done, carry on (still blocked until the cell frees)
        } else if (a.state === S.STOW) {
          if (t < a.busyUntil) continue;
          const list = halfSeated.get(hk(a)) || [];
          const blockers = list.filter((b) => b.fromAisle < a.fromAisle);
          let extra = 0;
          if (blockers.length) {
            extra += (cfg.shuffleBase + cfg.shufflePer * blockers.length) * a.shuffleJ;
            seatInterf += blockers.length;
            for (const b of blockers) b.standUntil = t + extra;
          }
          let hold = 0;
          if (a.holds) {
            for (const h of a.holds) {
              hold += h.dur;
              countDis(h.type, h.dur);
              events.push({ t, type: 'risk', text: `${RISK_TEXT[h.type] || h.type} (row ${a.row}, ${BS.fmtTime(h.dur)})` });
            }
          }
          if (hold > 0) { a.state = S.INCIDENT; a.busyUntil = t + extra + hold; }
          else if (extra > 0) { a.state = S.SHUFFLE; a.busyUntil = t + extra; }
          else seatAgent(a);
        } else if (a.state === S.SHUFFLE || a.state === S.INCIDENT) {
          if (t >= a.busyUntil) seatAgent(a);
        }
      }
      if (active.some((a) => a.state === S.SEATED)) active = active.filter((a) => a.state !== S.SEATED);

      // --- record
      if (record) {
        if (t >= nextFrame - 1e-9) { snapshot(); nextFrame += frameDt; }
        if (t >= nextSec - 1e-9) {
          series.seated.push(seated); series.aisle.push(aisleInterf); series.seat.push(seatInterf);
          series.inAisle.push(active.length);
          let qd = 0; for (let d = 0; d < doors.length; d++) qd += doorQueues[d].length - doorHead[d];
          series.queued.push(qd);
          series.paused.push(paused ? 1 : 0);
          nextSec += 1;
        }
      }
      t += dt;
    }
    if (record) { snapshot(); series.seated.push(seated); series.aisle.push(aisleInterf); series.seat.push(seatInterf); series.inAisle.push(0); series.queued.push(0); series.paused.push(0); }
    const offloadDelay = dis ? dis.flight.offload : 0;
    if (offloadDelay > 0) {
      countDis('offload', offloadDelay);
      events.push({ t, type: 'risk', text: `No-show with checked bag: offload adds ${BS.fmtTime(offloadDelay)} before doors close` });
    }

    // --- metrics
    const lastSeat = agents.reduce((m, a) => Math.max(m, a.seatedAt), 0);
    const paxTimes = agents.map((a) => a.seatedAt - a.enterAt).sort((x, y) => x - y);
    const waitTimes = agents.map((a) => a.waitAisle);
    const seatedTimes = agents.map((a) => a.seatedAt).sort((x, y) => x - y);
    const q = (arr, p) => arr[Math.min(arr.length - 1, Math.floor(p * arr.length))];
    const res = {
      strategyId: strategy.id, n, seed,
      totalTime: lastSeat - Math.max(0, firstEnter),
      firstEnter,
      t50: seatedTimes[Math.ceil(n * 0.5) - 1] - firstEnter,
      t90: seatedTimes[Math.ceil(n * 0.9) - 1] - firstEnter,
      aisleInterf, seatInterf, gateChecked, binAway,
      // disruptions: boarding time already includes them; offload only delays door close
      disruptions: disCount, disruptionSec: disSec,
      incidents: Object.values(disCount).reduce((x, y) => x + y, 0),
      offloadDelay,
      firstBinFull: firstBinFull < 0 ? null : firstBinFull - firstEnter,
      avgAisleWait: waitTimes.reduce((s, x) => s + x, 0) / n,
      avgPaxTime: paxTimes.reduce((s, x) => s + x, 0) / n,
      p90PaxTime: q(paxTimes, 0.9),
      doors: doors.map((d) => d.id),
      // share of the boarding window in which passengers were ready at the door but the aisle was backed up.
      // High → aisle-limited (the boarding method matters). Low → door/gate-limited (add a door or speed up the gate).
      aisleLimited: Math.min(1, doorBlocked / Math.max(1, (lastSeat - Math.max(0, firstEnter)) * doors.length)),
    };
    res.readyTime = res.totalTime + offloadDelay; // boarding complete → ready to close doors
    if (record) {
      res.frames = frames;
      res.frameDt = frameDt;
      res.series = series;
      res.events = events;
      res.binEvents = binEvents;
      res.binCap = binCap;
      res.cells = cells;
      res.doorCells = doors.map((d) => ({ id: d.id, cell: d.cell }));
      res.agents = agents.map((a) => ({
        id: a.id, row: a.row, lane: a.lane, side: a.side, slot: a.slot, fromAisle: a.fromAisle,
        seatIdx: a.seat.idx, group: a.group, pre: a.pre, order: a.order, enterAt: a.enterAt,
        seatedAt: a.seatedAt, party: a.party, gateChecked: a.gateChecked, bagUnits: a.bagUnits,
      }));
      res.duration = t;
    }
    return res;
  };

  // ---------- statistics helpers ----------
  BS.stats = function (values) {
    const v = values.slice().sort((a, b) => a - b);
    const n = v.length;
    const mean = v.reduce((s, x) => s + x, 0) / n;
    const sd = Math.sqrt(v.reduce((s, x) => s + (x - mean) * (x - mean), 0) / Math.max(1, n - 1));
    const q = (p) => {
      const i = (n - 1) * p, lo = Math.floor(i), hi = Math.ceil(i);
      return v[lo] + (v[hi] - v[lo]) * (i - lo);
    };
    return { n, mean, sd, min: v[0], max: v[n - 1], p10: q(0.1), p25: q(0.25), p50: q(0.5), p75: q(0.75), p90: q(0.9), values: v };
  };

  BS.fmtTime = function (sec) {
    if (sec == null || !isFinite(sec)) return '–';
    const s = Math.max(0, Math.round(sec));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };
})(typeof window !== 'undefined' ? window : globalThis);
