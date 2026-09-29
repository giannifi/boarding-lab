/* Boarding Lab — boarding strategies
 * ---------------------------------------------------------------
 * A strategy is pure data plus one function:
 *
 *   order(pax, ac, rng) -> Array<{ p, g }>
 *
 * It receives the passengers (each has row, lane, side, fromAisle, cls, …),
 * the compiled aircraft and a seeded RNG. It returns them in the order they
 * reach the door, each with a group number `g` (used for colouring and for
 * modelling passengers who board with the wrong group).
 *
 * Strategies never touch the simulation. Real-world effects (pre-boarding,
 * travel parties, passengers ignoring their group) are applied afterwards by
 * the engine, so every strategy gets them for free.
 *
 * Set `openSeating: true` for unassigned seating. Passengers then pick a seat
 * when they walk in.
 */
(function (root) {
  'use strict';
  const BS = (root.BS = root.BS || {});

  const shuffle = (arr, rng) => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  };
  BS.shuffle = shuffle;

  /** Group passengers with groupFn, board groups in ascending order, random inside each group. */
  const byGroups = (pax, groupFn, rng) => {
    const tagged = shuffle(pax.slice(), rng).map((p) => ({ p, g: groupFn(p) }));
    return tagged.sort((a, b) => a.g - b.g);
  };

  /** Strict ordering by key tuple (no randomness). */
  const byKey = (pax, keyFn) => {
    const arr = pax.map((p) => ({ p, k: keyFn(p) }));
    arr.sort((a, b) => {
      for (let i = 0; i < a.k.length; i++) if (a.k[i] !== b.k[i]) return a.k[i] - b.k[i];
      return 0;
    });
    return arr.map((x, i) => ({ p: x.p, g: i + 1 }));
  };

  const zoneFromBack = (p, ac, zones) => {
    const fromBack = (ac.N - p.row) / ac.N; // 0 = last row
    return Math.min(zones, Math.floor(fromBack * zones) + 1);
  };
  const seatRank = (p, ac) => ac.maxFromAisle - p.fromAisle; // 0 = window, higher = closer to aisle

  /**
   * Typical airline group structure (numbers follow the gate announcement):
   *   pre-boarding (assistance, families: applied by the engine) → G1 premium cabin →
   *   G2 status holders → G3 paid priority / cards → main cabin (econFn decides how
   *   it is split) → basic economy last.
   * Tiers come from the passenger model, where status holders cluster at the front of economy.
   */
  const airlineGroups = (econFn, econGroups) => (pax, ac, rng) => byGroups(pax, (p) => {
    if (p.cls !== 'Y' || p.tier === 'premium') return 1;
    if (p.tier === 'elite') return 2;
    if (p.tier === 'priority') return 3;
    if (p.tier === 'basic') return 4 + econGroups;
    return 4 + econFn(p, ac);
  }, rng);
  const coin = (p) => ((p.id * 2654435761) >>> 0) / 4294967296; // stable pseudo-random split per passenger

  BS.STRATEGIES = [
    {
      id: 'random', name: 'Random', short: 'RND', color: '#8B5CF6',
      tagline: 'Assigned seats, no boarding order.',
      desc: 'Everyone has a seat but walks on in whatever order they reach the gate. This is the usual research baseline, and it is what boarding turns into when nobody enforces groups.',
      pros: ['Nothing to explain or enforce', 'Spreads people along the cabin, so several can stow bags at once'],
      cons: ['Lots of seat shuffles (the window passenger turns up last)', 'Unpredictable, with wide spread between flights'],
      practicality: 5, usedBy: 'Default when groups aren’t enforced',
      source: 'Steffen & Hotchkiss (2011): measured 4:44 on a 72-seat mock-up.',
      order: (pax, ac, rng) => shuffle(pax.slice(), rng).map((p) => ({ p, g: 1 })),
    },
    {
      id: 'btf-zones', name: 'Back-to-Front (3 zones)', short: 'BTF3', color: '#EF4444',
      tagline: 'The rear third first, then the middle, then the front.',
      desc: 'The classic airline zone call. It feels logical, but everyone in a zone is aimed at the same short stretch of aisle, so they queue behind each other while bags are stowed.',
      pros: ['Easy to announce', 'Familiar to passengers'],
      cons: ['Concentrates the aisle into one section at a time', 'Usually no better than random'],
      practicality: 5, usedBy: 'Many legacy and regional carriers',
      source: 'van den Briel et al. (2005); Steffen (2008).',
      order: (pax, ac, rng) => byGroups(pax, (p) => zoneFromBack(p, ac, 3), rng),
    },
    {
      id: 'btf-5', name: 'Back-to-Front (5 zones)', short: 'BTF5', color: '#F97316',
      tagline: 'The same idea sliced into five smaller zones.',
      desc: 'Smaller zones make the jam worse. Each group only has a few rows to spread out in.',
      pros: ['Easy to announce'],
      cons: ['Even more aisle congestion than 3 zones'],
      practicality: 4, usedBy: 'Some legacy carriers',
      source: 'Steffen & Hotchkiss (2011): 4-row blocks measured 6:54, the slowest tested.',
      order: (pax, ac, rng) => byGroups(pax, (p) => zoneFromBack(p, ac, 5), rng),
    },
    {
      id: 'ftb-zones', name: 'Front-to-Back (3 zones)', short: 'FTB3', color: '#DC2626',
      tagline: 'Front third first. The textbook worst case.',
      desc: 'Early boarders block the aisle right at the door, so everyone behind them waits.',
      pros: ['Nothing, apart from being a useful worst-case benchmark'],
      cons: ['Slowest method in almost every study'],
      practicality: 5, usedBy: 'Accidental result of premium-first boarding',
      source: 'Steffen (2008), Journal of Air Transport Management 14(3).',
      order: (pax, ac, rng) => byGroups(pax, (p) => 4 - zoneFromBack(p, ac, 3), rng),
    },
    {
      id: 'btf-strict', name: 'Back-to-Front (row by row)', short: 'BTF-R', color: '#B91C1C',
      tagline: 'A perfect single file from the last row to the first, window to aisle.',
      desc: 'Looks perfectly organised: no seat shuffles at all. But every passenger waits for the one in front to stow a bag, so bags go in one at a time.',
      pros: ['Zero seat interference'],
      cons: ['The aisle is fully serialised', 'Very slow'],
      practicality: 1, usedBy: 'Research only',
      source: 'Steffen & Hotchkiss (2011): measured 6:11.',
      order: (pax, ac) => byKey(pax, (p) => [-p.row, p.fromAisle === undefined ? 0 : -p.fromAisle, p.side, p.lane]),
    },
    {
      id: 'wilma', name: 'WilMA (Outside-in)', short: 'WMA', color: '#0EA5E9',
      tagline: 'Window seats, then middle, then aisle.',
      desc: 'Three groups by seat position. There are no seat shuffles, and passengers in each group land all along the cabin, so bags are stowed in parallel.',
      pros: ['No seat interference', 'Simple: three calls', 'Robust'],
      cons: ['Splits couples and families across groups'],
      practicality: 4, usedBy: 'United Airlines (economy, since 2023)',
      source: 'Steffen & Hotchkiss (2011): measured 4:13.',
      order: (pax, ac, rng) => byGroups(pax, (p) => seatRank(p, ac) + 1, rng),
    },
    {
      id: 'rev-pyramid', name: 'Reverse Pyramid', short: 'RPY', color: '#06B6D4',
      tagline: 'Back windows first, front aisles last, in a diagonal wave.',
      desc: 'Combines back-to-front with outside-in in about five groups. It was developed with America West Airlines and is one of the best practical group methods.',
      pros: ['Fast with only a few groups', 'Works well on widebodies'],
      cons: ['Group assignment is harder to explain'],
      practicality: 3, usedBy: 'America West (historic)',
      source: 'van den Briel et al. (2005), Interfaces 35(3).',
      order: (pax, ac, rng) => byGroups(pax, (p) => {
        const back = ac.N > 1 ? (p.row - 1) / (ac.N - 1) : 1;
        const s = ac.maxFromAisle > 0 ? seatRank(p, ac) / ac.maxFromAisle : 0;
        return Math.min(5, Math.floor(((s + (1 - back)) / 2) * 5) + 1);
      }, rng),
    },
    {
      id: 'blocks', name: 'Blocks (back · front · middle)', short: 'BLK', color: '#EAB308',
      tagline: 'Three blocks of rows, in the order back, front, middle.',
      desc: 'The block method used in the Steffen experiment. Each block works like a small plane, so it has a lot of seat interference.',
      pros: ['Easy to announce'],
      cons: ['One of the slowest measured methods'],
      practicality: 5, usedBy: 'Legacy zone boarding variants',
      source: 'Steffen & Hotchkiss (2011): measured 6:54.',
      order: (pax, ac, rng) => byGroups(pax, (p) => {
        const z = zoneFromBack(p, ac, 3); // 1 back, 2 middle, 3 front
        return z === 1 ? 1 : z === 3 ? 2 : 3;
      }, rng),
    },
    {
      id: 'steffen', name: 'Steffen (perfect)', short: 'STF', color: '#10B981',
      tagline: 'A fixed line where neighbours in the queue sit two rows apart.',
      desc: 'Window to aisle, alternating sides and row parity, back to front. Each passenger in line has two rows of aisle to stow a bag in, so many stow at once. It is the fastest known method for a single door and a single aisle.',
      pros: ['Fastest in theory and in experiment', 'No seat interference'],
      cons: ['Needs a strict single-file line', 'Breaks up families and travel parties'],
      practicality: 1, usedBy: 'Research, demos, some trials',
      source: 'Steffen (2008); measured 3:36 in Steffen & Hotchkiss (2011).',
      order: (pax, ac) => {
        const lastParity = ac.N % 2;
        return byKey(pax, (p) => [
          seatRank(p, ac),
          p.row % 2 === lastParity ? 0 : 1,
          p.side === 1 ? p.lane * 2 : p.lane * 2 + 1, // right side first, as in the paper's figure
          -p.row,
        ]);
      },
    },
    {
      id: 'steffen-mod', name: 'Steffen (modified, 4 groups)', short: 'STF4', color: '#22C55E',
      tagline: 'Four groups by aircraft side and row parity. Random inside each group.',
      desc: 'A practical version of Steffen: even rows on the right side, even rows on the left, odd right, odd left. Travel parties sitting in the same half-row stay in one group.',
      pros: ['Most of Steffen’s parallel stowing', 'Keeps half-row families together', 'Only four calls'],
      cons: ['Has seat interference inside groups'],
      practicality: 3, usedBy: 'Proposed; trialled by several carriers',
      source: 'Steffen (2008), “modified optimal” method.',
      order: (pax, ac, rng) => {
        const lastParity = ac.N % 2;
        return byGroups(pax, (p) => {
          const par = p.row % 2 === lastParity ? 0 : 1;
          const sideR = p.side === 1 ? 0 : 1;
          return par * 2 + sideR + 1;
        }, rng);
      },
    },
    {
      id: 'wilma-btf', name: 'WilMA + Back-to-Front', short: 'WMB', color: '#3B82F6',
      tagline: 'Six groups: windows (back half, then front half), then middles, then aisles.',
      desc: 'WilMA with each seat group split into back and front halves. It is a common hybrid in simulation studies.',
      pros: ['No seat interference', 'Slightly faster than plain WilMA on long cabins'],
      cons: ['Six calls'],
      practicality: 3, usedBy: 'Hybrid studied in literature',
      source: 'Van Landeghem & Beuselinck (2002).',
      order: (pax, ac, rng) => byGroups(pax, (p) => seatRank(p, ac) * 2 + zoneFromBack(p, ac, 2), rng),
    },
    {
      id: 'airline-fare', name: 'Airline groups (fare & status)', short: 'AGF', color: '#78716C',
      tagline: 'Pre-board, then First/Business, status, priority, main cabin, and basic economy last.',
      desc: 'How most major airlines actually board. Groups are set by what you paid and your loyalty status, not by where you sit. Seat position is almost random within each group, and status holders sit towards the front, so the result behaves like random boarding with a front-first tilt.',
      pros: ['Rewards status and premium fares (the commercial reason it exists)', 'Familiar to passengers'],
      cons: ['Close to random, or worse, for boarding speed', 'Front-seated elites board first and block the aisle at the door'],
      practicality: 5, usedBy: 'American, Delta, Lufthansa, BA and most full-service carriers',
      source: 'Airline boarding policies; modelled here with status/fare tiers.',
      preboard: true,
      groupCalls: [[1, 'Group 1: First / Business'], [2, 'Group 2: status holders'], [3, 'Group 3: priority, cards'], [4, 'Group 4: main cabin A'], [5, 'Group 5: main cabin B'], [6, 'Group 6: basic economy']],
      order: airlineGroups((p) => (coin(p) < 0.5 ? 0 : 1), 2),
    },
    {
      id: 'airline-wilma', name: 'Airline groups + WilMA economy', short: 'AGW', color: '#0369A1',
      tagline: 'Same priority groups, then the main cabin called window → middle → aisle.',
      desc: 'Keeps the commercial priority groups but calls the regular main cabin by seat position, the way United does since 2023. The priority groups still disturb the order, but the bulk of the cabin boards without seat shuffles.',
      pros: ['Keeps status benefits', 'Removes most seat shuffles in the main cabin'],
      cons: ['Priority groups up front still board in random seat order'],
      practicality: 4, usedBy: 'United Airlines (economy WILMA since 2023)',
      source: 'United boarding process; Steffen & Hotchkiss (2011) for WilMA.',
      preboard: true,
      groupCalls: [[1, 'Group 1: First / Business'], [2, 'Group 2: status holders'], [3, 'Group 3: priority, cards'], [4, 'Group 4: windows'], [5, 'Group 5: middles'], [6, 'Group 6: aisles'], [7, 'Group 7: basic economy']],
      order: airlineGroups((p, ac) => Math.min(2, seatRank(p, ac)), 3),
    },
    {
      id: 'airline-btf', name: 'Airline groups + back-to-front', short: 'AGB', color: '#BE185D',
      tagline: 'Same priority groups, then the main cabin in rear, middle and front zones.',
      desc: 'Priority groups first, then the regular main cabin called by row zones from the back. This is common at carriers that use zone numbers printed on the boarding pass.',
      pros: ['Keeps status benefits', 'Easy zone announcements'],
      cons: ['Zones concentrate the aisle', 'Priority passengers at the front block the zone boarders behind them'],
      practicality: 5, usedBy: 'Many legacy and regional carriers',
      source: 'Airline boarding policies; van den Briel et al. (2005).',
      preboard: true,
      groupCalls: [[1, 'Group 1: First / Business'], [2, 'Group 2: status holders'], [3, 'Group 3: priority, cards'], [4, 'Group 4: rear rows'], [5, 'Group 5: middle rows'], [6, 'Group 6: front rows'], [7, 'Group 7: basic economy']],
      order: airlineGroups((p, ac) => zoneFromBack(p, ac, 3) - 1, 3),
    },
    {
      id: 'open', name: 'Open seating', short: 'OPEN', color: '#EC4899',
      tagline: 'No assigned seats. First come, first choice.',
      desc: 'Passengers pick a seat as they walk in. They prefer window and aisle seats near the front and avoid middle seats until they have to take one.',
      pros: ['People self-organise and avoid blocked rows', 'Often fast'],
      cons: ['Stressful gate queues', 'Families struggle to sit together'],
      practicality: 4, usedBy: 'Southwest (historic open seating)',
      source: 'Steffen (2008b), statistical-mechanics model of free-for-all boarding.',
      openSeating: true,
      order: (pax, ac, rng) => shuffle(pax.slice(), rng).map((p) => ({ p, g: 1 })),
    },
  ];

  BS.getStrategy = (id) => BS.STRATEGIES.find((s) => s.id === id);
})(typeof window !== 'undefined' ? window : globalThis);
