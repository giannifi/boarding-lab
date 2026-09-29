// Calibration check against Steffen & Hotchkiss (2011), "Experimental test of airplane boarding methods".
// 72 passengers, 12-row 3-3 mock-up, single front door. Measured "official" times (seconds):
//   Back-to-front (row by row) 371 · Blocks 414 · WilMA 253 · Steffen 216 · Random 284
// Run: node test/calibrate.js [reps]
require('../src/aircraft.js');
require('../src/strategies.js');
require('../src/engine.js');
const BS = globalThis.BS;

const MEASURED = { 'btf-strict': 371, blocks: 414, wilma: 253, steffen: 216, random: 284 };
const reps = Number(process.argv[2] || 60);
const ac = BS.getAircraft('steffen-757');
// The experiment: almost everyone carried a bag, bins ended up full, 3 parent/child pairs boarded first.
const cfg = { ...BS.DEFAULTS, carryOnShare: 0.8, loadFactor: 1, slowShare: 0.06 };

const out = {};
const t0 = Date.now();
for (const id of Object.keys(MEASURED)) {
  const s = BS.getStrategy(id);
  const times = [];
  for (let i = 0; i < reps; i++) {
    const seed = 1000 + i * 7919;
    const pax = BS.generatePassengers(ac, cfg, seed);
    times.push(BS.runSim(ac, pax, s, cfg, seed).totalTime);
  }
  out[id] = BS.stats(times);
}
const ms = Date.now() - t0;

let err = 0;
console.log('method        measured   sim mean   sim p10–p90     ratio');
for (const [id, m] of Object.entries(MEASURED)) {
  const st = out[id];
  const r = st.mean / m;
  err += Math.abs(Math.log(r));
  console.log(`${id.padEnd(13)} ${BS.fmtTime(m).padStart(6)}   ${BS.fmtTime(st.mean).padStart(8)}   ${BS.fmtTime(st.p10)}–${BS.fmtTime(st.p90)}   ${r.toFixed(2)}`);
}
const rank = (o) => Object.keys(MEASURED).sort((a, b) => o[a] - o[b]).join(' < ');
console.log('\nmeasured rank:', rank(MEASURED));
console.log('sim rank     :', rank(Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.mean]))));
console.log(`mean |log error|: ${(err / 5).toFixed(3)}   (${reps} reps × 5 methods in ${ms} ms)`);

// Smoke test every aircraft × strategy (record mode) for crashes / deadlocks
let bad = 0;
const t1 = Date.now();
for (const def of BS.AIRCRAFT) {
  const a = BS.compileAircraft(def);
  for (const pre of Object.keys(BS.PRESETS)) {
    const c = { ...BS.DEFAULTS, ...BS.PRESETS[pre].cfg, doors: a.doors.map((d) => d.id), risk: pre === 'leisure' ? 'bad' : pre === 'scheduled' ? 'realistic' : 'off' };
    const pax = BS.generatePassengers(a, c, 42);
    for (const s of BS.STRATEGIES) {
      const r = BS.runSim(a, pax, s, c, 42, { record: pre === 'scheduled' });
      if (!(r.totalTime > 0 && r.totalTime < 3 * 3600)) { bad++; console.log('FAIL', def.id, pre, s.id, r.totalTime); }
    }
  }
}
console.log(`smoke: ${BS.AIRCRAFT.length} aircraft × ${Object.keys(BS.PRESETS).length} presets × ${BS.STRATEGIES.length} strategies, all doors, failures: ${bad} (${Date.now() - t1} ms)`);
