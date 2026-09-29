/* Boarding Lab — aircraft library
 * ---------------------------------------------------------------
 * An aircraft is pure data. To add one, append an object to BS.AIRCRAFT.
 *
 *   cabins : ordered front → back. Each cabin has a class (F/J/W/Y), a row
 *            count and a layout string. Letters are seats, "|" is an aisle.
 *            "ABC|DEF" = single aisle 3-3, "ABC|DEFG|HJK" = twin aisle 3-4-3.
 *            Premium cabins may use a subset of letters ("AC|DF") so they line
 *            up with the economy columns.
 *   doors  : where passengers can enter. `at` is "front" (forward galley),
 *            "rear" (aft galley) or a row number (door sits at that row's aisle
 *            position, e.g. the L2 door behind business on a widebody).
 *            `default: true` marks doors that are used unless the user changes it.
 *
 * Layouts are representative, not a specific airline's LOPA.
 */
(function (root) {
  'use strict';
  const BS = (root.BS = root.BS || {});

  BS.AIRCRAFT = [
    {
      id: 'steffen-757', name: 'Steffen test cabin', variant: '12 rows · 72 seats (research mock-up)',
      family: 'Research', note: 'Mock 757 fuselage used in the Steffen & Hotchkiss (2011) boarding experiment. Use it to compare against real measured times.',
      cabins: [{ cls: 'Y', rows: 12, layout: 'ABC|DEF' }],
      doors: [{ id: 'L1', at: 'front', default: true }],
    },
    {
      id: 'atr72', name: 'ATR 72-600', variant: '2-2 · 72 seats',
      family: 'Regional', note: 'Turboprop that boards through the rear left door.',
      cabins: [{ cls: 'Y', rows: 18, layout: 'AC|DF' }],
      doors: [{ id: 'L2 rear', at: 'rear', default: true }],
    },
    {
      id: 'e190', name: 'Embraer E190-E2', variant: '2-2 · 100 seats',
      family: 'Regional', note: 'Regional jet, 2-2 cabin, front door boarding.',
      cabins: [{ cls: 'Y', rows: 25, layout: 'AC|DF' }],
      doors: [{ id: 'L1', at: 'front', default: true }, { id: 'L2', at: 'rear' }],
    },
    {
      id: 'a220-300', name: 'Airbus A220-300', variant: '2-3 · 135 seats',
      family: 'Narrowbody', note: 'Asymmetric 2-3 cabin: a single middle seat per row.',
      cabins: [{ cls: 'Y', rows: 27, layout: 'AC|DEF' }],
      doors: [{ id: 'L1', at: 'front', default: true }, { id: 'L2', at: 'rear' }],
    },
    {
      id: 'a320-lcc', name: 'Airbus A320neo', variant: 'All-economy · 186 seats',
      family: 'Narrowbody', note: 'Typical low-cost layout.',
      cabins: [{ cls: 'Y', rows: 31, layout: 'ABC|DEF' }],
      doors: [{ id: 'L1', at: 'front', default: true }, { id: 'L4', at: 'rear' }],
    },
    {
      id: 'a320-2c', name: 'Airbus A320neo', variant: '12 J + 150 Y · 162 seats',
      family: 'Narrowbody', note: 'European-style business class: 3-3 seats with the middle seat blocked.',
      cabins: [{ cls: 'J', rows: 3, layout: 'AC|DF' }, { cls: 'Y', rows: 25, layout: 'ABC|DEF' }],
      doors: [{ id: 'L1', at: 'front', default: true }, { id: 'L4', at: 'rear' }],
    },
    {
      id: 'a321-lcc', name: 'Airbus A321neo', variant: 'All-economy · 228 seats',
      family: 'Narrowbody', note: 'Long single-aisle cabin. The aisle is the bottleneck.',
      cabins: [{ cls: 'Y', rows: 38, layout: 'ABC|DEF' }],
      doors: [{ id: 'L1', at: 'front', default: true }, { id: 'L4', at: 'rear' }],
    },
    {
      id: 'b737-800', name: 'Boeing 737-800', variant: 'All-economy · 186 seats',
      family: 'Narrowbody', note: 'High-density low-cost layout. Often boarded front and rear by stairs.',
      cabins: [{ cls: 'Y', rows: 31, layout: 'ABC|DEF' }],
      doors: [{ id: 'L1', at: 'front', default: true }, { id: 'L2', at: 'rear' }],
    },
    {
      id: 'b737max8', name: 'Boeing 737 MAX 8', variant: '16 F + 156 Y · 172 seats',
      family: 'Narrowbody', note: 'US two-class layout with a 2-2 first class.',
      cabins: [{ cls: 'F', rows: 4, layout: 'AC|DF' }, { cls: 'Y', rows: 26, layout: 'ABC|DEF' }],
      doors: [{ id: 'L1', at: 'front', default: true }, { id: 'L2', at: 'rear' }],
    },
    {
      id: 'b787-9', name: 'Boeing 787-9', variant: '32 J + 261 Y · 293 seats',
      family: 'Widebody', note: 'Twin aisle 3-3-3. Boards through L2, behind business class.',
      cabins: [{ cls: 'J', rows: 8, layout: 'A|DF|K' }, { cls: 'Y', rows: 29, layout: 'ABC|DEF|HJK' }],
      doors: [{ id: 'L1', at: 'front' }, { id: 'L2', at: 9, default: true }],
    },
    {
      id: 'a350-900', name: 'Airbus A350-900', variant: '32 J + 270 Y · 302 seats',
      family: 'Widebody', note: 'Twin aisle 3-3-3.',
      cabins: [{ cls: 'J', rows: 8, layout: 'A|DF|K' }, { cls: 'Y', rows: 30, layout: 'ABC|DEF|HJK' }],
      doors: [{ id: 'L1', at: 'front' }, { id: 'L2', at: 9, default: true }],
    },
    {
      id: 'b777-300er', name: 'Boeing 777-300ER', variant: '40 J + 340 Y · 380 seats',
      family: 'Widebody', note: 'Twin aisle 3-4-3 economy.',
      cabins: [{ cls: 'J', rows: 10, layout: 'A|DG|K' }, { cls: 'Y', rows: 34, layout: 'ABC|DEFG|HJK' }],
      doors: [{ id: 'L1', at: 'front' }, { id: 'L2', at: 11, default: true }],
    },
    {
      id: 'a380-main', name: 'Airbus A380', variant: 'Main deck · 440 Y',
      family: 'Widebody', note: 'Main deck only, 3-4-3. Usually boarded through two doors.',
      cabins: [{ cls: 'Y', rows: 44, layout: 'ABC|DEFG|HJK' }],
      doors: [{ id: 'M1', at: 'front', default: true }, { id: 'M2', at: 14, default: true }],
    },
  ];

  /** Parse one layout string into per-letter seat metadata. */
  function parseLayout(layout) {
    const groups = layout.split('|');
    const out = [];
    groups.forEach((g, gi) => {
      const n = g.length;
      for (let i = 0; i < n; i++) {
        const letter = g[i];
        let lane, side, fromAisle;
        if (gi === 0) { lane = 0; side = 0; fromAisle = n - 1 - i; }                 // left block, aisle on its right
        else if (gi === groups.length - 1) { lane = gi - 1; side = 1; fromAisle = i; } // right block, aisle on its left
        else {                                                                       // centre block, split between the two aisles
          const half = Math.ceil(n / 2);
          if (i < half) { lane = gi - 1; side = 1; fromAisle = i; }
          else { lane = gi; side = 0; fromAisle = n - 1 - i; }
        }
        const outer = gi === 0 || gi === groups.length - 1;
        out.push({ letter, lane, side, fromAisle, isWindow: outer && fromAisle === n - 1 });
      }
    });
    return out;
  }

  /** Turn an aircraft definition into a geometry the engine and renderer can use. */
  BS.compileAircraft = function (def) {
    const count = (l) => l.replace(/\|/g, '').length;
    const widest = def.cabins.reduce((a, c) => (count(c.layout) > count(a) ? c.layout : a), '');
    const groups = widest.split('|');
    const lanes = groups.length - 1;

    // vertical "slots": one per seat letter plus one per aisle (renderer uses these)
    const slotOf = {};
    const aisleSlots = [];
    let slot = 0;
    groups.forEach((g, gi) => {
      for (const ch of g) slotOf[ch] = slot++;
      if (gi < groups.length - 1) aisleSlots.push(slot++);
    });

    const seats = [];
    const rows = [];
    let r = 0;
    let maxFromAisle = 0;
    def.cabins.forEach((cab, ci) => {
      const meta = parseLayout(cab.layout);
      for (let i = 0; i < cab.rows; i++) {
        r++;
        rows.push({ row: r, cls: cab.cls, cabin: ci, seats: meta.length });
        for (const m of meta) {
          if (slotOf[m.letter] === undefined) throw new Error(`Seat ${m.letter} not in widest layout of ${def.id}`);
          maxFromAisle = Math.max(maxFromAisle, m.fromAisle);
          seats.push({
            idx: seats.length, id: r + m.letter, row: r, letter: m.letter, slot: slotOf[m.letter],
            lane: m.lane, side: m.side, fromAisle: m.fromAisle, isWindow: m.isWindow, cls: cab.cls,
          });
        }
      }
    });
    const N = r;
    const doors = def.doors.map((d) => ({
      id: d.id, default: !!d.default,
      cell: d.at === 'front' ? 0 : d.at === 'rear' ? N + 1 : Math.max(0, Math.min(N + 1, d.at)),
    }));

    return {
      def, id: def.id, name: def.name, variant: def.variant, family: def.family,
      N, lanes, slotOf, aisleSlots, totalSlots: slot, seats, rows, doors, maxFromAisle,
      premiumRows: rows.filter((x) => x.cls !== 'Y').length,
      layoutLabel: def.cabins.map((c) => c.layout.split('|').map((g) => g.length).join('-')).filter((v, i, a) => a.indexOf(v) === i).join(' / '),
    };
  };

  BS.getAircraft = function (id) {
    const def = BS.AIRCRAFT.find((a) => a.id === id) || BS.AIRCRAFT[4];
    return BS.compileAircraft(def);
  };
})(typeof window !== 'undefined' ? window : globalThis);
