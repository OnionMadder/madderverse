/* =====================================================================
 * game.js — pure game state + rules (no DOM)
 *   Keeps a single `Game` object. UI layer reads/writes it via methods.
 * ===================================================================== */

const Game = (() => {

  const {
    GOODS, LOCATIONS, EVENTS, TICKER_SEEDS, COMPETITORS,
    fmt, travelDays, travelFuel, fuelBasePrice,
  } = GAME_DATA;

  const BASE_CONFIG = {
    startCash:        5000,
    startDebt:        0,
    startCap:         60,
    startFuel:        100,
    maxDays:          60,
    goal:             150000,
    maxLoan:          25000,
    interestRate:     0.08,
    eventChance:      0.45,
    localEventChance: 0.55,
    shipFuelMod:      1.0,
    shipSpeedMod:     1.0,
  };

  const MODES = {
    tutorial: {
      startCash:        15000,
      startCap:         80,
      maxDays:          90,
      goal:             50000,
      maxLoan:          50000,
      interestRate:     0,
      eventChance:      0.20,
      localEventChance: 0.30,
    },
    beginner: {
      startCash:        10000,
      startCap:         70,
      maxDays:          75,
      goal:             100000,
      maxLoan:          30000,
      interestRate:     0.05,
      eventChance:      0.35,
      localEventChance: 0.45,
    },
    intermediate: {},
    advanced: {
      startCash:        2000,
      startDebt:        2000,
      startCap:         45,
      maxDays:          45,
      goal:             250000,
      maxLoan:          15000,
      interestRate:     0.12,
      eventChance:      0.65,
      localEventChance: 0.70,
    },
  };

  const CONFIG = { ...BASE_CONFIG };

  let state = null;

  // ---------- lifecycle ----------
  function newGame(modeName = "intermediate", shipId = "hauler", companyName = "ACME TRADING CO.") {
    Object.assign(CONFIG, BASE_CONFIG, MODES[modeName] || {});

    const ship = GAME_DATA.SHIPS.find(s => s.id === shipId) || GAME_DATA.SHIPS[0];
    CONFIG.startCap      = ship.cap;
    CONFIG.shipFuelMod   = ship.fuelMod  || 1.0;
    CONFIG.shipSpeedMod  = ship.speedMod || 1.0;
    if (ship.interestMod) CONFIG.interestRate = +(CONFIG.interestRate * ship.interestMod).toFixed(4);

    const startCash = Math.max(0, CONFIG.startCash - ship.cost);
    const fuelCap   = ship.fuelCap || 100;

    // procedurally seed each rival with a starting net worth that hovers
    // around the player's starting cash, then drifts each day
    const seededRivals = COMPETITORS.map(c => ({
      id: c.id,
      name: c.name,
      style: c.style,
      motto: c.motto,
      flavor: c.flavor,
      netWorth: Math.max(800, Math.round(startCash * (0.65 + Math.random() * 0.9))),
    }));

    state = {
      day: 1,
      maxDays: CONFIG.maxDays,
      goal:    CONFIG.goal,

      company: (companyName || "").trim() || "ACME TRADING CO.",

      cash:  startCash,
      debt:  CONFIG.startDebt,
      cap:   CONFIG.startCap,

      fuel:    fuelCap,            // tank starts full
      fuelCap: fuelCap,

      shipId:           ship.id,
      contrabandShield: ship.contrabandShield || false,
      betterEvents:     ship.betterEvents     || false,

      location: LOCATIONS[0].id,

      cargo:  Object.fromEntries(GOODS.map(g => [g.id, 0])),
      avgCost: Object.fromEntries(GOODS.map(g => [g.id, 0])),

      // planets the player has set foot on (for lore-on-arrival modal)
      visited: { [LOCATIONS[0].id]: true },

      // active price modifiers from events: id -> multiplier
      priceMods: {},
      priceModsExpire: {},

      // current market: location_id -> { good_id: price }
      market: {},

      // rival trading houses competing for the leaderboard
      competitors: seededRivals,

      tickerQueue: [...TICKER_SEEDS],
      log: [],
      gameOver: false,
      win: false,
    };

    rollAllMarkets();
    log(`${state.company}: trade run started. Goal: ${fmt(state.goal)} ¢ in ${state.maxDays} days.`, "warn");
    return state;
  }

  // ---------- market generation ----------
  function rollAllMarkets() {
    state.market = {};
    LOCATIONS.forEach(loc => {
      const m = {};
      GOODS.forEach(good => {
        let mult = 1.0;
        if (loc.produces.includes(good.id)) mult = 0.55 + Math.random() * 0.30; // cheap source
        else if (loc.demands.includes(good.id)) mult = 1.20 + Math.random() * 0.40; // pays well
        else mult = 0.85 + Math.random() * 0.30;

        // daily noise
        const noise = 1 + (Math.random() * 2 - 1) * good.volatility;
        // active event mods
        const evt = state.priceMods[good.id] || 1;

        const p = good.basePrice * mult * noise * evt;
        m[good.id] = Math.max(1, Math.round(p));
      });
      state.market[loc.id] = m;
    });
  }

  function expirePriceMods() {
    for (const gid of Object.keys(state.priceModsExpire)) {
      if (state.day >= state.priceModsExpire[gid]) {
        delete state.priceMods[gid];
        delete state.priceModsExpire[gid];
      }
    }
  }

  // ---------- queries ----------
  function priceOf(goodId, locId = state.location) {
    return state.market[locId][goodId];
  }

  function holdUsed() {
    let t = 0;
    for (const g of GOODS) t += (state.cargo[g.id] || 0) * g.bulk;
    return t;
  }

  function holdFree() { return state.cap - holdUsed(); }

  function netWorth() {
    let cargoVal = 0;
    for (const g of GOODS) cargoVal += (state.cargo[g.id] || 0) * priceOf(g.id);
    return state.cash + cargoVal - state.debt;
  }

  // ---------- trades ----------
  function buy(goodId, qty) {
    qty = Math.max(0, Math.floor(qty));
    if (!qty) return { ok: false, msg: "Quantity must be > 0." };
    const good = GOODS.find(g => g.id === goodId);
    const price = priceOf(goodId);
    const cost = price * qty;
    const tons = good.bulk * qty;

    if (cost > state.cash)   return { ok: false, msg: "Not enough cash." };
    if (tons > holdFree())   return { ok: false, msg: "Not enough cargo space." };

    // running average cost so we can show profit/loss
    const haveQty  = state.cargo[goodId];
    const haveCost = state.avgCost[goodId] * haveQty;
    state.cargo[goodId]  = haveQty + qty;
    state.avgCost[goodId] = (haveCost + cost) / state.cargo[goodId];

    state.cash -= cost;
    log(`Bought ${qty} ${good.name} @ ${fmt(price)} ¢ = ${fmt(cost)} ¢.`, "good");
    return { ok: true, msg: `Bought ${qty} ${good.name}.` };
  }

  function sell(goodId, qty) {
    qty = Math.max(0, Math.floor(qty));
    if (!qty) return { ok: false, msg: "Quantity must be > 0." };
    if ((state.cargo[goodId] || 0) < qty) return { ok: false, msg: "You don't have that many." };

    const good = GOODS.find(g => g.id === goodId);
    const price = priceOf(goodId);
    const revenue = price * qty;
    const profitPerUnit = price - state.avgCost[goodId];
    const totalProfit = profitPerUnit * qty;

    state.cargo[goodId] -= qty;
    if (state.cargo[goodId] === 0) state.avgCost[goodId] = 0;
    state.cash += revenue;

    const tag = totalProfit >= 0 ? "good" : "bad";
    log(
      `Sold ${qty} ${good.name} @ ${fmt(price)} ¢ = ${fmt(revenue)} ¢ ` +
      `(${totalProfit >= 0 ? "+" : ""}${fmt(totalProfit)} profit).`,
      tag
    );
    return { ok: true, msg: `Sold ${qty} ${good.name}.` };
  }

  // ---------- bank ----------
  function borrow(amt) {
    amt = Math.floor(amt);
    if (amt <= 0) return { ok: false, msg: "Invalid amount." };
    if (state.debt + amt > CONFIG.maxLoan) return { ok: false, msg: "Loan would exceed max." };
    state.debt += amt;
    state.cash += amt;
    log(`Borrowed ${fmt(amt)} ¢. Debt now ${fmt(state.debt)} ¢.`, "warn");
    return { ok: true };
  }

  function repay(amt) {
    amt = Math.floor(amt);
    if (amt <= 0) return { ok: false, msg: "Invalid amount." };
    amt = Math.min(amt, state.debt, state.cash);
    if (amt === 0) return { ok: false, msg: "Nothing to repay." };
    state.debt -= amt;
    state.cash -= amt;
    log(`Repaid ${fmt(amt)} ¢. Debt now ${fmt(state.debt)} ¢.`, "good");
    return { ok: true };
  }

  // ---------- fuel ----------
  function fuelPriceHere() {
    return fuelBasePrice(state.location);
  }
  function fuelMaxBuy() {
    return state.fuelCap - state.fuel;
  }
  function buyFuel(qty) {
    qty = Math.max(0, Math.floor(qty));
    if (!qty) return { ok: false, msg: "Quantity must be > 0." };
    const room = fuelMaxBuy();
    if (room <= 0) return { ok: false, msg: "Tank is full." };
    if (qty > room) qty = room;
    const price = fuelPriceHere();
    const cost  = price * qty;
    if (cost > state.cash) return { ok: false, msg: "Not enough cash for that fuel." };
    state.cash -= cost;
    state.fuel += qty;
    log(`Refueled ${qty} u @ ${price} ¢/u = ${fmt(cost)} ¢.`, "good");
    return { ok: true };
  }

  // ---------- travel & turn ----------
  // returns { ok, msg, event? }
  function travel(destId) {
    if (destId === state.location) return { ok: false, msg: "Already there." };
    const dest = LOCATIONS.find(l => l.id === destId);
    if (!dest) return { ok: false, msg: "Unknown destination." };

    const fuelNeed = travelFuel(state.location, destId, CONFIG.shipFuelMod);
    const days     = Math.max(1, Math.round(travelDays(state.location, destId) * CONFIG.shipSpeedMod));

    if (fuelNeed > state.fuel) {
      return { ok: false, msg: `Need ${fuelNeed} fuel — tank has ${state.fuel}. Refuel first.` };
    }

    state.fuel -= fuelNeed;
    state.location = destId;

    const firstVisit = !state.visited[destId];
    state.visited[destId] = true;

    log(`Traveled to ${dest.name} (${days}d, ${fuelNeed} fuel burned).`);

    // advance days; interest accrues each
    let event = null;
    let localEvent = null;
    for (let i = 0; i < days; i++) {
      advanceOneDay({ skipMarketReroll: i < days - 1 });
      if (state.gameOver) break;
    }
    rollAllMarkets();

    // global random event roll
    if (!state.gameOver && Math.random() < CONFIG.eventChance) {
      event = triggerRandomEvent();
    }
    // per-location flavor event roll — mutates current market for one visit
    if (!state.gameOver && Math.random() < CONFIG.localEventChance) {
      localEvent = triggerLocalEvent(dest);
    }

    checkEnd();
    return { ok: true, msg: `Arrived at ${dest.name}.`, event, localEvent, firstVisit, dest };
  }

  function waitOneDay() {
    advanceOneDay({});
    rollAllMarkets();
    log("You wait a day. The galaxy turns.", "warn");
    checkEnd();
  }

  function advanceOneDay({ skipMarketReroll = false } = {}) {
    state.day += 1;
    // interest on debt
    if (state.debt > 0) {
      const interest = Math.ceil(state.debt * CONFIG.interestRate);
      state.debt += interest;
    }
    // expire price events
    expirePriceMods();
    // rivals jockey for the leaderboard each day
    driftCompetitors();
    // market drift mid-trip is hidden until arrival; ui will reroll once
    if (!skipMarketReroll) {
      // no-op — caller decides when to rollAllMarkets()
    }
  }

  function driftCompetitors() {
    if (!state.competitors) return;
    state.competitors.forEach(c => {
      // each style picks a different daily volatility & drift bias
      const vol  = c.style === 'volatile'   ? 0.18
                : c.style === 'aggressive' ? 0.10
                                            : 0.05;
      const bias = c.style === 'volatile'   ? 0.005
                : c.style === 'aggressive' ? 0.012
                                            : 0.008;
      const swing = (Math.random() * 2 - 1) * vol;
      const next  = c.netWorth * (1 + swing + bias);
      c.netWorth  = Math.max(200, Math.round(next));
    });
  }

  // ---------- events ----------
  function triggerRandomEvent() {
    const evt = rollWeighted(EVENTS);
    if (state.betterEvents && evt && evt.type === "bad" && Math.random() < 0.40) return null;
    return evt;
  }

  function triggerLocalEvent(dest) {
    const list = (dest && dest.localEvents) || [];
    if (!list.length) return null;
    return rollWeighted(list);
  }

  function rollWeighted(list) {
    const total = list.reduce((s, e) => s + e.weight, 0);
    let r = Math.random() * total;
    let chosen = list[0];
    for (const e of list) {
      r -= e.weight;
      if (r <= 0) { chosen = e; break; }
    }
    const msg = chosen.apply(state);
    log(`[${chosen.title}] ${msg}`, chosen.type);
    return { ...chosen, resolvedMsg: msg };
  }

  // ---------- end conditions ----------
  function checkEnd() {
    if (state.gameOver) return;
    if (state.day > state.maxDays) {
      state.gameOver = true;
      state.win = netWorth() >= state.goal;
      log(state.win ? "TIME UP — you hit the goal!" : "TIME UP — you fell short.",
          state.win ? "good" : "bad");
      return;
    }
    if (state.cash <= 0 && state.debt > 0 && holdUsed() === 0) {
      state.gameOver = true;
      state.win = false;
      log("BANKRUPT — no cash, no cargo, debt remaining.", "bad");
    }
  }

  // ---------- log ----------
  function log(msg, kind) {
    state.log.push({ day: state.day, msg, kind: kind || "" });
    if (state.log.length > 200) state.log.shift();
  }

  // ---------- public ----------
  return {
    CONFIG, MODES,
    get state() { return state; },
    newGame,
    priceOf, holdUsed, holdFree, netWorth,
    buy, sell, borrow, repay,
    buyFuel, fuelPriceHere, fuelMaxBuy,
    travel, waitOneDay,
  };
})();
