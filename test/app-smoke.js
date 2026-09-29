// Headless smoke test for the UI controller: runs app.js against a permissive fake DOM
// and drives every view (simulate, methods, analyze, sensitivity, plan, risk) through selfTest().
// Catches logic errors (TypeError / ReferenceError); it does not check pixels.
// Run: node test/app-smoke.js
const path = require('path');

const els = new Map();
function makeEl(sel) {
  const store = { value: '', textContent: '', innerHTML: '', dataset: {}, style: { setProperty() {} }, checked: false, disabled: false, hidden: false };
  const noop = () => {};
  const classList = { add: noop, remove: noop, toggle: noop, contains: () => false };
  return new Proxy(store, {
    get(t, k) {
      if (k in t) return t[k];
      if (k === 'classList') return classList;
      if (k === 'querySelector') return (s) => getEl(sel + ' ' + s);
      if (k === 'querySelectorAll') return () => [];
      if (k === 'getContext') return () => ctx;
      if (k === 'getBoundingClientRect') return () => ({ left: 0, width: 800, top: 0, height: 20 });
      if (k === 'parentElement') return { clientWidth: 900 };
      if (k === 'clientWidth') return 900;
      if (k === 'tagName') return 'DIV';
      if (k === 'closest') return () => null;
      if (typeof k === 'symbol') return undefined;
      return noop;
    },
    set(t, k, v) { t[k] = v; return true; },
  });
}
function getEl(sel) { if (!els.has(sel)) els.set(sel, makeEl(sel)); return els.get(sel); }
const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => {}), set: (t, k, v) => { t[k] = v; return true; } });

const logs = [];
global.window = global;
global.document = {
  readyState: 'complete',
  documentElement: { dataset: {} },
  activeElement: { tagName: 'BODY' },
  querySelector: getEl,
  querySelectorAll: () => [],
  createElement: (tag) => makeEl('new-' + tag + Math.random()),
  addEventListener() {},
  title: '',
};
global.location = { hash: '', search: '?selftest', href: 'http://x/' };
global.history = { replaceState() {} };
global.getComputedStyle = () => ({ getPropertyValue: () => '#ffffff' });
global.requestAnimationFrame = (f) => setTimeout(() => f(Date.now()), 16);
global.ResizeObserver = class { observe() {} };
global.matchMedia = () => ({ matches: false });
global.localStorage = { getItem: () => null, setItem() {} };
global.devicePixelRatio = 1;
global.navigator = {};
global.addEventListener = () => {};
const origInfo = console.info, origErr = console.error;
console.info = (...a) => { logs.push(a.join(' ')); origInfo(...a); };
console.error = (...a) => { logs.push('ERR ' + a.join(' ')); origErr(...a); };

for (const f of ['aircraft', 'strategies', 'engine', 'renderer', 'charts', 'app']) require(path.join(__dirname, '..', 'src', f + '.js'));

const t0 = Date.now();
const wait = setInterval(() => {
  const ok = logs.find((l) => l.includes('selftest OK'));
  const bad = logs.find((l) => l.startsWith('ERR'));
  if (ok || bad || Date.now() - t0 > 240000) {
    clearInterval(wait);
    console.log(ok ? `\nPASS (${((Date.now() - t0) / 1000).toFixed(1)} s)` : '\nFAIL');
    process.exit(ok && !bad ? 0 : 1);
  }
}, 100);
