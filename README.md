# Boarding Lab

An agent-based aircraft boarding simulator for the web. Race boarding methods side by side on real cabin layouts, check how robust the result is with Monte Carlo analysis, and turn it into turnaround-planning numbers.

No framework and no runtime dependencies. It's plain HTML, CSS and JavaScript, and it runs from a single file.

---

## Features

| View | What you get |
|---|---|
| **Simulate** | Up to 4 methods board the same passengers (same seats, bags and walking speeds). Scrubbable timeline with finish markers, 1–60× playback, a live comparison table, a seated-over-time chart and a clickable event log. Seats can be coloured by status, by boarding order or by boarding group. |
| **Analyze** | 25–200 runs per method. Box plots with the raw samples, median / mean / p90 / win rate, aisle and seat interferences, gate-checked bags, and a bottleneck diagnosis (aisle-limited vs door-limited). One-factor sensitivity sweeps. CSV export. |
| **Risk** | Each method boards the same passengers twice, clean and with disruptions (realistic day or bad day). You get the median impact, the p90 buffer to plan for, the share of flights over target, the most robust method, and a ranking of which event drives the delay. The event catalogue is editable (on/off, probability, duration). |
| **Plan** | Minutes saved per departure, yearly value at your cost per minute, share of flights within a boarding-time target, recommended boarding-call time (from p90), and a ranked list of levers: open more doors, fewer cabin bags, bigger bins, enforced groups, faster door flow. |
| **Methods** | A guide to all 15 methods. Each has a seat map of its boarding sequence on the current aircraft, the group calls, pros and cons, practicality, real-world use and the source. |

**Boarding methods:**
- Random
- Back-to-front: 3 zones, 5 zones, and row by row
- Front-to-back
- WilMA (outside-in)
- WilMA + back-to-front
- Reverse Pyramid
- Blocks
- Steffen (perfect)
- Steffen (modified, 4 groups)
- Open seating
- Three **airline group** variants: pre-boarding → First/Business → status → paid priority → main cabin → basic economy. The main cabin is called by fare group, by WilMA (United-style), or by back-to-front zones.

**Aircraft:**
- Research: Steffen test cabin (12 × 6)
- Regional: ATR 72-600 (rear door), E190-E2
- Narrowbody: A220-300, A320neo (all-economy and two-class), A321neo, 737-800, 737 MAX 8
- Widebody: 787-9, A350-900, 777-300ER, A380 main deck

Premium cabins, mid-cabin doors, multi-door boarding and twin aisles are all supported.

**Scenario presets:** Ideal lab, Typical scheduled flight, Leisure / holiday charter, Business shuttle. Every parameter can be adjusted in the sidebar.

---

## Quick start

```bash
# run locally: just open the file, no server needed
open index.html            # macOS
start index.html           # Windows

# build a single self-contained file for hosting
npm run build              # → dist/index.html

# tests
npm test                   # calibration vs. published experiment + headless UI run
```

Node ≥ 18 is only needed for the build and the tests. The app itself runs in any modern browser.

### Deploy

`dist/index.html` is the whole app in one file. It works on any static host:

- **GitHub Pages:** commit `dist/` and set Pages to serve from `/dist` (or copy the file to `/docs`).
- **Netlify / Vercel / Cloudflare Pages:** set the build command to `node build.js` and the publish directory to `dist`.
- **S3 / any web server:** upload `dist/index.html`.

The page loads Inter and JetBrains Mono from Google Fonts. If they can't load, it falls back to system fonts. For sandboxed hosts that block external requests, build with `node build.js <out.html> --no-fonts`.

The current scenario (aircraft, preset, methods, seed and any changed parameters) is stored in the URL hash, so a copied address reopens the same setup.

---

## Project structure

```
boarding-lab/
├── index.html          # app shell and markup for the five views
├── styles.css          # design tokens (light/dark), components, responsive rules
├── src/
│   ├── aircraft.js     # aircraft library + layout compiler
│   ├── strategies.js   # boarding methods (pure ordering functions + guide metadata)
│   ├── engine.js       # passenger model, queue building, agent simulation, statistics
│   ├── renderer.js     # canvas cabin renderer (pure playback of recorded frames)
│   ├── charts.js       # dependency-free SVG charts (line, box plot, bars)
│   └── app.js          # UI state, URL state, playback, Monte Carlo, planner
├── test/
│   ├── calibrate.js    # model vs. Steffen & Hotchkiss (2011) + smoke run of every combination
│   └── app-smoke.js    # headless run through all views against a stub DOM
├── build.js            # inlines CSS + JS into dist/index.html
└── dist/index.html     # build output
```

The scripts are classic `<script>` files that share a single `window.BS` namespace, so `index.html` also works when opened from `file://`. The engine files do not touch the DOM, so they run unchanged in Node.

---

## How the model works

- **Aisle.** Every aisle is a line of cells, one per seat row, plus a galley cell at each end. Only one passenger fits in a cell, so someone stowing a bag blocks everyone behind them. The simulation advances in 0.25 s steps.
- **Passenger lifecycle.** queued → walking (≈0.9 s per row; slow walkers ×1.9, assistance ×2.8) → stowing (bin fill slows it down; a bin up to 3 rows away is used if yours is full; the bag is gate-checked if nothing is free) → seat shuffle (seated neighbours between you and your seat have to stand up) → seated.
- **Stowing while stuck.** A passenger blocked within 2 rows of their seat stows the bag where they're standing.
- **Real-world effects.** These are applied on top of any method: pre-boarding (assistance, families, premium), travel parties who board together, passengers who board with the wrong group, load factor, and fare/status tiers. Status holders cluster at the front of economy, and basic economy skews to middle seats at the back.
- **Disruptions** (optional, sidebar → *Disruptions*). The catalogue is `BS.RISK_EVENTS` in `src/engine.js`:

  | Event | Scope | Realistic / Bad day | Typical duration |
  |---|---|---|---|
  | Someone in my seat | per passenger | 2% / 4% | 12 s |
  | Bag doesn't fit: crew takes it to the hold | per passenger with bag | 1.5% / 3.5% | 25 s |
  | Seat-swap negotiation | per passenger | 1% / 2.5% | 20 s |
  | Crew assistance at the seat | per passenger | 1% / 2% | 18 s |
  | Medical / assistance incident | per flight | 5% / 15% | 2 min |
  | Boarding paused at the door | per flight | 15% / 35% | 3 min |
  | Late passengers (1–3 / 2–5) | per flight | 35% / 60% | 2.5 min after queue clears |
  | No-show with checked bag: offload | per flight | 5% / 12% | 10 min (door-close, not boarding) |

  The rates are planning assumptions, not measured data. Replace them with figures from your own irregularity reports, either in the Risk tab or in code. Events are drawn from a dedicated random stream, so every method faces identical events and a bad day contains every event of a realistic day.
- **Determinism.** Everything is seeded. Each Monte Carlo run shares one passenger set across all methods, so comparisons are paired.

### Calibration

```bash
node test/calibrate.js 100
```

The 12-row research cabin is compared against the times measured by Steffen & Hotchkiss (2011) with 72 passengers:

| Method | Measured | Simulated (mean) |
|---|---|---|
| Steffen | 3:36 | ≈3:35 |
| WilMA | 4:13 | ≈4:17 |
| Random | 4:44 | ≈5:18 |
| Back-to-front (row by row) | 6:11 | ≈6:39 |
| Blocks | 6:54 | ≈6:12 |

The simulation reproduces the measured order Steffen < WilMA < Random < {back-to-front, blocks}, with a mean absolute log error of about 0.06. The one mismatch is that blocks and back-to-front swap places; the experiment ran each method only once, with about 10% uncertainty.

### Limits

This is a planning model, not a digital twin. It does not include:

- jet-bridge queues or gate-scan rate (both are folded into "door flow")
- passengers overtaking each other in the aisle
- crew interventions
- bin sizes that differ by cabin class

Use it to compare options and understand sensitivities. Before relying on absolute times, calibrate the behaviour settings (sidebar → *Behaviour model*) against your own boarding timestamps.

---

## Extending

### Add an aircraft (`src/aircraft.js`)

```js
{
  id: 'a321xlr', name: 'Airbus A321XLR', variant: '14 J + 180 Y', family: 'Narrowbody',
  note: 'Long-range single aisle.',
  cabins: [
    { cls: 'J', rows: 7,  layout: 'A|D' },      // letters must exist in the widest layout
    { cls: 'Y', rows: 30, layout: 'ABC|DEF' },  // "|" = aisle
  ],
  doors: [{ id: 'L1', at: 'front', default: true }, { id: 'L4', at: 'rear' }], // or at: <row number>
}
```

### Add a boarding method (`src/strategies.js`)

A method returns passengers in the order they reach the door, each with a group number:

```js
{
  id: 'odd-even', name: 'Odd rows first', short: 'ODD', color: '#0EA5E9',
  tagline: '…', desc: '…', pros: ['…'], cons: ['…'],
  practicality: 3, usedBy: '…', source: '…',
  // optional: preboard: true, openSeating: true, groupCalls: [[1, 'Group 1: …'], …]
  order: (pax, ac, rng) => byGroups(pax, (p) => (p.row % 2 ? 1 : 2), rng),
}
```

Each passenger has `row`, `lane`, `side`, `fromAisle` (0 = aisle seat), `cls`, `tier`, `party` and `prm`. Pre-boarding, travel parties and passengers ignoring their group are applied by the engine, so a new method gets them automatically.

### Add behaviour (`src/engine.js`)

Parameters live in `BS.DEFAULTS` and `BS.PRESETS`. The per-tick agent logic is in `BS.runSim`. To make a new parameter adjustable, add it to `PARAMS` in `src/app.js` and a slider appears in the sidebar.

---

## References

- Steffen, J. H. (2008). *Optimal boarding method for airline passengers.* Journal of Air Transport Management 14(3).
- Steffen, J. H., & Hotchkiss, J. (2011). *Experimental test of airplane boarding methods.* Journal of Air Transport Management. [arXiv:1108.5211](https://arxiv.org/abs/1108.5211)
- van den Briel, M. H. L., et al. (2005). *America West Airlines develops efficient boarding strategies.* Interfaces 35(3).
- Van Landeghem, H., & Beuselinck, A. (2002). *Reducing passenger boarding time in airplanes: a simulation based approach.* EJOR 142(2).
- Airlines for America. *U.S. Passenger Carrier Delay Costs* (2025).
