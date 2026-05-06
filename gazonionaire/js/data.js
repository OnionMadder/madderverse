/* =====================================================================
 * data.js — static game definitions
 *   Customize / expand these tables to retheme the game.
 *   Prices are in credits (¢). Distances drive fuel/time costs.
 *
 *   Trade-route design:
 *     - Each planet `produces` 2 goods (cheap, scarcity LOW there).
 *     - Each planet `demands`  2 goods (premium prices, scarcity HIGH).
 *     - Every good has at least one producer and one demander somewhere.
 * ===================================================================== */

const GAME_DATA = (() => {

  // =====================================================================
  // 24 commodities
  //   tier 1 basics (≤ 100¢)  ·  tier 2 industrial (100–400¢)
  //   tier 3 advanced (400–1500¢)  ·  tier 4 luxury (1500–5000¢)
  //   contraband (legal:false) — risk customs seizure & fines
  // =====================================================================
  const GOODS = [
    // --- tier 1: basics ---
    { id: "water",    name: "Water",            basePrice:    20, volatility: 0.10, bulk: 1, legal: true,  icon: "water.png"    },
    { id: "grain",    name: "Grain",            basePrice:    45, volatility: 0.15, bulk: 1, legal: true,  icon: "grain.png"    },
    { id: "algae",    name: "Algae Paste",      basePrice:    60, volatility: 0.15, bulk: 1, legal: true,  icon: "algae.png"    },
    { id: "salt",     name: "Salt",             basePrice:    35, volatility: 0.12, bulk: 1, legal: true,  icon: "salt.png"     },
    { id: "ore",      name: "Raw Ore",          basePrice:   110, volatility: 0.20, bulk: 2, legal: true,  icon: "ore.png"      },
    { id: "hydrogen", name: "Hydrogen Slush",   basePrice:    90, volatility: 0.18, bulk: 1, legal: true,  icon: "hydrogen.png" },

    // --- tier 2: industrial ---
    { id: "fuel",     name: "Fuel Cells",       basePrice:   180, volatility: 0.18, bulk: 1, legal: true,  icon: "fuel.png"     },
    { id: "plastics", name: "Polyplastics",     basePrice:   160, volatility: 0.18, bulk: 1, legal: true,  icon: "plastics.png" },
    { id: "glass",    name: "Plate Glass",      basePrice:   140, volatility: 0.20, bulk: 2, legal: true,  icon: "glass.png"    },
    { id: "textiles", name: "Smartfiber",       basePrice:   220, volatility: 0.20, bulk: 1, legal: true,  icon: "textiles.png" },
    { id: "lumber",   name: "Yoxai Lumber",     basePrice:   280, volatility: 0.22, bulk: 2, legal: true,  icon: "lumber.png"   },
    { id: "medicine", name: "Pharmaceuticals",  basePrice:   380, volatility: 0.22, bulk: 1, legal: true,  icon: "medicine.png" },

    // --- tier 3: advanced ---
    { id: "tech",     name: "Tech Parts",       basePrice:   420, volatility: 0.25, bulk: 1, legal: true,  icon: "tech.png"     },
    { id: "solar",    name: "Solar Arrays",     basePrice:   520, volatility: 0.22, bulk: 2, legal: true,  icon: "solar.png"    },
    { id: "organs",   name: "Bio-Print Organs", basePrice:  1100, volatility: 0.30, bulk: 1, legal: true,  icon: "organs.png"   },
    { id: "robots",   name: "Service Robots",   basePrice:  1400, volatility: 0.28, bulk: 2, legal: true,  icon: "robots.png"   },
    { id: "cyber",    name: "Cybernetic Limbs", basePrice:  1600, volatility: 0.30, bulk: 1, legal: true,  icon: "cyber.png"    },

    // --- tier 4: luxury ---
    { id: "qchip",    name: "Quantum Chips",    basePrice:  2200, volatility: 0.32, bulk: 1, legal: true,  icon: "qchip.png"    },
    { id: "art",      name: "Alien Artifacts",  basePrice:  2800, volatility: 0.38, bulk: 1, legal: true,  icon: "art.png"      },
    { id: "holo",     name: "Holo-Crystals",    basePrice:  3400, volatility: 0.35, bulk: 1, legal: true,  icon: "holo.png"     },
    { id: "lace",     name: "Neural Lace",      basePrice:  3800, volatility: 0.38, bulk: 1, legal: true,  icon: "lace.png"     },
    { id: "antim",    name: "Antimatter Vial",  basePrice:  4500, volatility: 0.40, bulk: 1, legal: true,  icon: "antim.png"    },

    // --- contraband (risky) ---
    { id: "spice",    name: "Spice",            basePrice:  2200, volatility: 0.45, bulk: 1, legal: false, icon: "spice.png"    },
    { id: "weapons",  name: "Black-Market Arms",basePrice:  3000, volatility: 0.40, bulk: 1, legal: false, icon: "weapons.png"  },
  ];

  // =====================================================================
  // 12 locations
  //   produces : abundant goods (price ~ 0.55–0.85 of base)  — buy here
  //   demands  : scarce goods   (price ~ 1.20–1.60 of base)  — sell here
  //   x,y      : map coords (drives fuel cost & travel days)
  //   lawful   : 0..1, higher = stricter customs (more contraband busts)
  //   tagline  : one-line subtitle shown in the location card
  //   lore     : flavor blurb shown on first arrival (modal)
  // =====================================================================
  const LOCATIONS = [
    {
      id: "terra", name: "Terra Prime", x:    0, y:    0,
      lawful: 0.8, icon: "loc_terra.png",
      produces: ["water", "grain"],
      demands:  ["robots", "qchip"],
      tagline: "Capital of the Pact. Clean streets, dirty politics.",
      lore: "Once Earth, now a sanitized capital under the Pact's grey rule. " +
            "Surface farms feed a hundred worlds; ask no questions about the under-cities. " +
            "Customs is sharp here — leave the contraband in orbit."
    },
    {
      id: "kallis", name: "Kallis Belt", x:   60, y:   25,
      lawful: 0.3, icon: "loc_kallis.png",
      produces: ["ore", "solar"],
      demands:  ["water", "medicine"],
      tagline: "Asteroid mining swarm. Company town, no exit.",
      lore: "A debt-ridden mining swarm hammered into hollowed asteroids. " +
            "Ore flows out, bills come due, the company always wins. " +
            "Bring water and meds — they'll trade the shirts off their backs."
    },
    {
      id: "zeph", name: "Zephyr Hub", x:   45, y:   80,
      lawful: 0.5, icon: "loc_zeph.png",
      produces: ["tech", "qchip"],
      demands:  ["art", "antim"],
      tagline: "Free port and tax haven. Anything's for sale.",
      lore: "Free port and tax haven, glittering above Pavonis. " +
            "If it can be invented, fenced, or licensed, you'll find it on the Hub's bazaar tier. " +
            "The wealthy pay obscene prices for art and antimatter."
    },
    {
      id: "verra", name: "Verra Outpost", x:  -95, y:   55,
      lawful: 0.1, icon: "loc_verra.png",
      produces: ["spice", "weapons"],
      demands:  ["fuel", "solar"],
      tagline: "Lawless rim. Smugglers welcome, governors don't last.",
      lore: "The customs officers stopped showing up after the third governor disappeared. " +
            "Spice runs hot from the back rooms; arms dealers haggle in the open. " +
            "The frontier is hungry for fuel and power."
    },
    {
      id: "obsid", name: "Obsidian Reach", x:  -35, y:  -65,
      lawful: 0.6, icon: "loc_obsid.png",
      produces: ["glass", "art"],
      demands:  ["spice", "weapons"],
      tagline: "Black-glass spires. Old aristocracy with new vices.",
      lore: "Black glass spires raised by an old aristocracy that paints with starlight " +
            "and pays in old grudges. Don't insult the host. " +
            "Their parties run on spice and their bodyguards run on bullets."
    },
    {
      id: "halc", name: "Halcyon Drift", x:   95, y:  -25,
      lawful: 0.3, icon: "loc_halc.png",
      produces: ["fuel", "plastics"],
      demands:  ["grain", "holo"],
      tagline: "A graveyard of warships turned salvage town.",
      lore: "Half its citizens are stowaways, the other half are looking for them. " +
            "Salvage rigs strip dead capital ships for fuel cells and polyplastics. " +
            "The drifters trade everything for grain and contraband holos."
    },
    {
      id: "calder", name: "Caldera-9", x:  -70, y:  -10,
      lawful: 0.5, icon: "loc_calder.png",
      produces: ["robots", "cyber"],
      demands:  ["hydrogen", "organs"],
      tagline: "Volcanic forge-world. Robots build robots build robots.",
      lore: "A volcanic foundry-world where forges never cool and the workers " +
            "are mostly metal themselves. The smelters are ravenous for hydrogen, " +
            "and a working pair of lungs is worth its weight in robots."
    },
    {
      id: "erebus", name: "New Erebus", x:   50, y:  -85,
      lawful: 0.4, icon: "loc_erebus.png",
      produces: ["algae", "salt"],
      demands:  ["tech", "cyber"],
      tagline: "Drowned ocean planet. Cities float, the deep listens.",
      lore: "Cities cling to floating reefs of luminous algae. " +
            "The deep things below have started knocking back, and the surveyors stopped reporting. " +
            "Every reef-station is desperate for tech parts and replacement limbs."
    },
    {
      id: "pavon", name: "Pavonis Prime", x:   60, y:   95,
      lawful: 0.7, icon: "loc_pavon.png",
      produces: ["hydrogen", "antim"],
      demands:  ["textiles", "lumber"],
      tagline: "Gas-giant skyhooks. Helium barons, helium parties.",
      lore: "Cloud-city skyhooks dangle into a gas-giant's storms. " +
            "Helium barons throw parties you'll never be invited to — " +
            "but they pay in solid currency for soft beds, real wood, and warm fabric."
    },
    {
      id: "solen", name: "Solenne Verge", x: -105, y:  -85,
      lawful: 0.6, icon: "loc_solen.png",
      produces: ["medicine", "holo"],
      demands:  ["salt", "plastics"],
      tagline: "Walled monk-engineer sanctuary. They pray with lasers.",
      lore: "Pilgrims come to be healed; sometimes they leave. " +
            "The Order grows rare crystals in vaulted gardens and brews medicine in copper stills. " +
            "Salt and plastics pour into the cloister at strange premiums."
    },
    {
      id: "thren", name: "Threnody-7", x:   15, y: -100,
      lawful: 0.2, icon: "loc_thren.png",
      produces: ["organs", "lace"],
      demands:  ["algae", "glass"],
      tagline: "Vertical slum-stack. Your spine is software here.",
      lore: "Down here, your spine is software and your lungs are a subscription. " +
            "Backstreet clinics print organs and braid neural lace into anyone who can pay. " +
            "The masses live on algae paste; the towers above devour glass."
    },
    {
      id: "yoxai", name: "Yoxai Hollow", x:  -65, y:  100,
      lawful: 0.3, icon: "loc_yoxai.png",
      produces: ["textiles", "lumber"],
      demands:  ["ore", "lace"],
      tagline: "Overgrown alien dig-site. The ruins are still listening.",
      lore: "An overgrown dig at the edge of charted space. " +
            "The ruins predate the species who named them, and the ruins are still listening. " +
            "Archaeologists trade strange wood and silken fibers for ore and neural lace."
    },
  ];

  // =====================================================================
  // random events (post-travel)
  // =====================================================================
  const EVENTS = [
    {
      id: "pirates", weight: 8, type: "bad", title: "Pirate Raid!",
      img: "evt_pirates.png",
      body: "Pirates board your ship in the lanes.",
      apply(g){
        const carried = Object.entries(g.cargo).filter(([,n])=>n>0);
        if(!carried.length) return "Pirates found you broke. They left, disappointed.";
        const [gid, n] = carried[Math.floor(Math.random()*carried.length)];
        const stolen = Math.max(1, Math.floor(n * (0.2 + Math.random()*0.3)));
        g.cargo[gid] -= stolen;
        return `Pirates stole ${stolen} ${goodName(gid)}.`;
      }
    },
    {
      id: "customs", weight: 6, type: "bad", title: "Customs Inspection",
      img: "evt_customs.png",
      body: "Customs scanner sweeps your hold.",
      apply(g){
        const loc = locById(g.location);
        const contraband = GOODS.filter(x => !x.legal && (g.cargo[x.id]||0) > 0);
        if (!contraband.length || Math.random() > loc.lawful) {
          return "Customs waved you through. Lucky.";
        }
        if (g.contrabandShield && Math.random() < 0.72) {
          return "Customs scanned deep. Came up clean. Strange.";
        }
        const c = contraband[0];
        const lost = g.cargo[c.id];
        g.cargo[c.id] = 0;
        const fine = Math.floor(lost * c.basePrice * 0.5);
        g.cash = Math.max(0, g.cash - fine);
        return `Contraband seized: ${lost} ${c.name}. Fine: ${fmt(fine)} ¢.`;
      }
    },
    {
      id: "boom", weight: 5, type: "good", title: "Market Boom",
      img: "evt_boom.png",
      body: "A trade frenzy spikes prices on a hot commodity.",
      apply(g){
        const good = GOODS[Math.floor(Math.random()*GOODS.length)];
        g.priceMods[good.id] = (g.priceMods[good.id] || 1) * 1.6;
        g.priceModsExpire[good.id] = g.day + 3;
        return `BOOM: ${good.name} prices surge for 3 days.`;
      }
    },
    {
      id: "bust", weight: 5, type: "bad", title: "Market Crash",
      img: "evt_bust.png",
      body: "Glut crashes a commodity's price.",
      apply(g){
        const good = GOODS[Math.floor(Math.random()*GOODS.length)];
        g.priceMods[good.id] = (g.priceMods[good.id] || 1) * 0.5;
        g.priceModsExpire[good.id] = g.day + 3;
        return `CRASH: ${good.name} prices collapse for 3 days.`;
      }
    },
    {
      id: "find", weight: 3, type: "good", title: "Salvage!",
      img: "evt_find.png",
      body: "You find a derelict pod drifting in the lanes.",
      apply(g){
        const credits = 200 + Math.floor(Math.random()*1500);
        g.cash += credits;
        return `Salvage worth ${fmt(credits)} ¢ recovered.`;
      }
    },
    {
      id: "fueltax", weight: 4, type: "warn", title: "Fuel Surcharge",
      img: "evt_fuel.png",
      body: "Council levies an emergency fuel tax.",
      apply(g){
        const fee = 100 + Math.floor(Math.random()*400);
        g.cash = Math.max(0, g.cash - fee);
        return `Fuel surcharge cost you ${fmt(fee)} ¢.`;
      }
    },
    {
      id: "tip", weight: 4, type: "good", title: "Hot Tip",
      img: "evt_tip.png",
      body: "A trader leaks a tip about a future market move.",
      apply(g){
        const good = GOODS[Math.floor(Math.random()*GOODS.length)];
        const upcoming = Math.random() < 0.5 ? "spike" : "crash";
        g.tickerQueue.push(`RUMOR: ${good.name} prices may ${upcoming} soon.`);
        return `Tip received about ${good.name}.`;
      }
    },
  ];

  // =====================================================================
  // starting headlines for the news ticker
  // =====================================================================
  const TICKER_SEEDS = [
    "Welcome to the Gazonionaire Trade Network — buy low, sell high.",
    "Galactic Bank reports record loan defaults.",
    "Terra Prime exports water cheap this cycle.",
    "Verra Outpost reportedly under-policed; smugglers rejoice.",
    "Halcyon Drift fuel-cell glut depresses prices.",
    "Kallis Belt miners strike again — water shortages worsen.",
    "Solenne monks unveil new holo-crystal vintage.",
    "Yoxai Hollow dig yields fresh artifacts; collectors circling.",
  ];

  // =====================================================================
  // shared helpers used by local-event apply functions
  // =====================================================================
  function _disc(g, ids, mult) {
    const m = g.market[g.location];
    if (!m) return;
    ids.forEach(id => { if (m[id] != null) m[id] = Math.max(1, Math.round(m[id] * mult)); });
  }
  function _pay(g, lo, hi) {
    const amt = lo + Math.floor(Math.random() * Math.max(1, hi - lo));
    g.cash = Math.max(0, g.cash - amt);
    return amt;
  }
  function _earn(g, lo, hi) {
    const amt = lo + Math.floor(Math.random() * Math.max(1, hi - lo));
    g.cash += amt;
    return amt;
  }

  // =====================================================================
  // per-location flavor events — rolled on arrival in addition to global
  //   apply(g) returns a resolution string; may mutate g.market[g.location]
  //   to give one-visit price tweaks (rerolled when player leaves).
  // =====================================================================
  const LOCAL_EVENTS = {

    terra: [
      { id:"permit_fee", weight:35, type:"warn", title:"Pact Permit Fee",
        img:"evt_permit.png",
        body:"Pact bureaucrats process your docking papers — for a fee.",
        apply(g){ return `Permit cost ${fmt(_pay(g, 100, 300))} ¢.`; } },
      { id:"pact_charter", weight:30, type:"good", title:"Diplomatic Charter",
        img:"evt_charter.png",
        body:"A Pact attaché slips you discreet courier work.",
        apply(g){ return `Charter paid ${fmt(_earn(g, 600, 1500))} ¢.`; } },
      { id:"undermarket", weight:35, type:"good", title:"Subway Contact",
        img:"evt_undermarket.png",
        body:"A contact in the under-city offers contraband at black-market rates.",
        apply(g){ _disc(g, ["spice","weapons"], 0.65);
                  return "Spice & arms 35% off this visit."; } },
    ],

    kallis: [
      { id:"cavein", weight:35, type:"good", title:"Mine Cave-In",
        img:"evt_cavein.png",
        body:"A shaft collapse forces miners to dump ore at fire-sale prices.",
        apply(g){ _disc(g, ["ore"], 0.5);
                  return "Ore 50% off this visit."; } },
      { id:"miners_strike", weight:35, type:"good", title:"Miners' Strike",
        img:"evt_strike.png",
        body:"Striking miners pay anything for water and meds.",
        apply(g){ _disc(g, ["water","medicine"], 1.8);
                  return "Water & meds sell at 1.8× this visit."; } },
      { id:"asteroid", weight:30, type:"bad", title:"Asteroid Strike",
        img:"evt_asteroid.png",
        body:"A micro-impact ruptures cargo bay seals.",
        apply(g){
          const carried = Object.entries(g.cargo).filter(([,n])=>n>0);
          if (!carried.length) return "Nothing in your hold to lose. Lucky.";
          const [gid, n] = carried[Math.floor(Math.random()*carried.length)];
          const lost = Math.min(n, 1 + Math.floor(Math.random()*3));
          g.cargo[gid] -= lost;
          return `Lost ${lost} ${goodName(gid)} to vacuum.`;
        } },
    ],

    zeph: [
      { id:"black_auction", weight:40, type:"good", title:"Black Auction",
        img:"evt_auction.png",
        body:"A masked auctioneer dumps a hot lot at cut-rate prices.",
        apply(g){ _disc(g, ["art","holo"], 0.65);
                  return "Artifacts & holo-crystals 35% off this visit."; } },
      { id:"fixer_fee", weight:30, type:"warn", title:"Fixer Fee",
        img:"evt_fixer.png",
        body:"A local fixer offers to 'expedite' your dock-side paperwork.",
        apply(g){ return `Fixer took ${fmt(_pay(g, 200, 500))} ¢.`; } },
      { id:"insider", weight:30, type:"good", title:"Insider Whisper",
        img:"evt_insider.png",
        body:"A tipster slips you fresh trade rumors.",
        apply(g){
          const a = GOODS[Math.floor(Math.random()*GOODS.length)];
          const b = GOODS[Math.floor(Math.random()*GOODS.length)];
          g.tickerQueue.push(`RUMOR: ${a.name} ${Math.random()<.5?"spike":"crash"} expected.`);
          g.tickerQueue.push(`RUMOR: ${b.name} demand shifting.`);
          return "Two new rumors hit the ticker.";
        } },
    ],

    verra: [
      { id:"smuggler_deal", weight:35, type:"good", title:"Smuggler's Deal",
        img:"evt_smuggler.png",
        body:"A smuggler unloads inventory before the heat arrives.",
        apply(g){ _disc(g, ["spice","weapons"], 0.5);
                  return "Contraband half price this visit."; } },
      { id:"cartel", weight:30, type:"bad", title:"Cartel Shakedown",
        img:"evt_cartel.png",
        body:"Cartel toughs want a 'docking tribute.'",
        apply(g){ return `Tribute cost ${fmt(_pay(g, 200, 600))} ¢.`; } },
      { id:"pirate_buyer", weight:35, type:"good", title:"Pirate Buyer",
        img:"evt_pirate_buy.png",
        body:"A pirate captain pays premium for fuel and solar arrays.",
        apply(g){ _disc(g, ["fuel","solar"], 1.7);
                  return "Fuel & solar sell at 1.7× this visit."; } },
    ],

    obsid: [
      { id:"patron", weight:35, type:"good", title:"Aristocrat Patron",
        img:"evt_patron.png",
        body:"An old-house patron commissions exotica at any price.",
        apply(g){ _disc(g, ["art","holo"], 1.8);
                  return "Art & holo-crystals 1.8× this visit."; } },
      { id:"duel", weight:30, type:"bad", title:"Duel Insult",
        img:"evt_duel.png",
        body:"You bumped the wrong shoulder. Honor demands payment.",
        apply(g){ return `Honor settled with ${fmt(_pay(g, 200, 500))} ¢.`; } },
      { id:"masquerade", weight:35, type:"good", title:"Masquerade Ball",
        img:"evt_masquerade.png",
        body:"The night's masquerade drives luxury prices skyward.",
        apply(g){ _disc(g, ["art","lace","holo"], 1.5);
                  return "Luxury goods sell at 1.5× this visit."; } },
    ],

    halc: [
      { id:"derelict_auction", weight:40, type:"good", title:"Derelict Auction",
        img:"evt_derelict.png",
        body:"Salvagers strip a fresh wreck and dump fuel cells & plastics.",
        apply(g){ _disc(g, ["fuel","plastics"], 0.5);
                  return "Fuel & plastics half price this visit."; } },
      { id:"stowaway", weight:30, type:"warn", title:"Stowaway",
        img:"evt_stowaway.png",
        body:"A drifter is found in your cargo bay.",
        apply(g){ return `Paid ${fmt(_pay(g, 100, 300))} ¢ to dispatch them quietly.`; } },
      { id:"lucky_salvage", weight:30, type:"good", title:"Lucky Salvage",
        img:"evt_salvage_local.png",
        body:"You find a working tech crate stamped 'unclaimed.'",
        apply(g){
          const free = ["tech","plastics","fuel"][Math.floor(Math.random()*3)];
          const good = GOODS.find(x=>x.id===free);
          let used = 0;
          for (const x of GOODS) used += (g.cargo[x.id]||0) * x.bulk;
          if (used + good.bulk <= g.cap) {
            g.cargo[free] = (g.cargo[free]||0) + 1;
            return `Free 1 ${good.name} added to your hold.`;
          } else {
            g.cash += good.basePrice;
            return `No hold space — fenced the find for ${fmt(good.basePrice)} ¢.`;
          }
        } },
    ],

    calder: [
      { id:"foundry_glut", weight:35, type:"good", title:"Foundry Glut",
        img:"evt_foundry.png",
        body:"Overproduction floods the market with robots and prosthetics.",
        apply(g){ _disc(g, ["robots","cyber"], 0.6);
                  return "Robots & cybernetics 40% off this visit."; } },
      { id:"heat_surcharge", weight:30, type:"warn", title:"Heat Surcharge",
        img:"evt_heat.png",
        body:"Cooling fees are levied on every visiting hull.",
        apply(g){ return `Heat surcharge ${fmt(_pay(g, 150, 400))} ¢.`; } },
      { id:"worker_crisis", weight:35, type:"good", title:"Worker Crisis",
        img:"evt_workers.png",
        body:"A foundry accident has clinics scrambling for replacement organs.",
        apply(g){ _disc(g, ["organs"], 1.8);
                  return "Bio-organs sell at 1.8× this visit."; } },
    ],

    erebus: [
      { id:"algae_bloom", weight:35, type:"good", title:"Algae Bloom",
        img:"evt_bloom.png",
        body:"A massive bloom dumps algae paste at giveaway prices.",
        apply(g){ _disc(g, ["algae"], 0.4);
                  return "Algae paste 60% off this visit."; } },
      { id:"reef_storm", weight:30, type:"warn", title:"Reef Storm",
        img:"evt_storm.png",
        body:"A storm forces docking surcharges across the floating quays.",
        apply(g){ return `Storm fee ${fmt(_pay(g, 100, 300))} ¢.`; } },
      { id:"deep_find", weight:35, type:"good", title:"Deep Find",
        img:"evt_deepfind.png",
        body:"Fishermen hauled up something the deep didn't want kept.",
        apply(g){ _disc(g, ["art"], 0.5);
                  return "Alien artifacts 50% off this visit."; } },
    ],

    pavon: [
      { id:"baron_party", weight:35, type:"good", title:"Baron's Party",
        img:"evt_baron.png",
        body:"A helium baron throws a soirée demanding fine wood and fabric.",
        apply(g){ _disc(g, ["textiles","lumber"], 1.7);
                  return "Textiles & lumber sell at 1.7× this visit."; } },
      { id:"sky_casino", weight:30, type:"warn", title:"Sky-Casino",
        img:"evt_casino.png",
        body:"You can't help yourself at the cloud-deck tables.",
        apply(g){
          const win = Math.random() < 0.5;
          const amt = 300 + Math.floor(Math.random()*700);
          if (win) { g.cash += amt; return `Won ${fmt(amt)} ¢ at the tables.`; }
          g.cash = Math.max(0, g.cash - amt);
          return `Lost ${fmt(amt)} ¢ at the tables.`;
        } },
      { id:"patron_commission", weight:35, type:"good", title:"Patron's Commission",
        img:"evt_commission.png",
        body:"A baron's house broker offers antimatter at family rates.",
        apply(g){ _disc(g, ["antim"], 0.75);
                  return "Antimatter 25% off this visit."; } },
    ],

    solen: [
      { id:"blessing", weight:30, type:"good", title:"Pilgrim's Blessing",
        img:"evt_blessing.png",
        body:"A grateful pilgrim presses coin into your palm.",
        apply(g){ return `Blessing brought ${fmt(_earn(g, 200, 500))} ¢.`; } },
      { id:"forbidden_vault", weight:35, type:"good", title:"Forbidden Vault",
        img:"evt_vault.png",
        body:"A novitiate quietly opens the crystal vault for visitors.",
        apply(g){ _disc(g, ["holo"], 0.6);
                  return "Holo-crystals 40% off this visit."; } },
      { id:"confession", weight:35, type:"warn", title:"Confession Tithe",
        img:"evt_confession.png",
        body:"The Order weighs your soul — and your cargo.",
        apply(g){
          let val = 0;
          GOODS.forEach(x => { if (!x.legal) val += (g.cargo[x.id]||0) * x.basePrice; });
          if (val === 0) return "Your manifest is clean. The Order blesses you.";
          const tithe = Math.ceil(val * 0.10);
          g.cash = Math.max(0, g.cash - tithe);
          return `Tithed ${fmt(tithe)} ¢ for forbidden cargo.`;
        } },
    ],

    thren: [
      { id:"black_clinic", weight:35, type:"good", title:"Black Clinic",
        img:"evt_clinic.png",
        body:"A backstreet clinic sells implants below the listed price.",
        apply(g){ _disc(g, ["organs","cyber","lace"], 0.5);
                  return "Implants & lace 50% off this visit."; } },
      { id:"gang_toll", weight:35, type:"bad", title:"Gang Toll",
        img:"evt_gang.png",
        body:"A neon-painted gang demands a transit toll.",
        apply(g){ return `Toll cost ${fmt(_pay(g, 200, 500))} ¢.`; } },
      { id:"data_broker", weight:30, type:"good", title:"Data Broker",
        img:"evt_broker.png",
        body:"A data broker pays for your trade logs and tips you to a rumor.",
        apply(g){
          const good = GOODS[Math.floor(Math.random()*GOODS.length)];
          g.tickerQueue.push(`RUMOR: ${good.name} demand shifting in next sector.`);
          const c = _earn(g, 100, 300);
          return `Sold logs for ${fmt(c)} ¢, picked up a rumor.`;
        } },
    ],

    yoxai: [
      { id:"dig_find", weight:35, type:"good", title:"Dig Find",
        img:"evt_digfind.png",
        body:"Diggers haul up a fresh cache; the rangers haven't catalogued it yet.",
        apply(g){ _disc(g, ["art"], 0.5);
                  return "Alien artifacts 50% off this visit."; } },
      { id:"ruins_sing", weight:30, type:"warn", title:"The Ruins Sing",
        img:"evt_ruins.png",
        body:"A low harmonic crawls through the dig at dusk. Nobody sleeps.",
        apply(g){
          const good = GOODS[Math.floor(Math.random()*GOODS.length)];
          g.tickerQueue.push(`RUMOR: Yoxai harmonics correlate with ${good.name} markets.`);
          const c = 50 + Math.floor(Math.random()*200);
          g.cash += c;
          return `Strange whisper. ${fmt(c)} ¢ found in your pocket. New rumor recorded.`;
        } },
      { id:"archaeologist", weight:35, type:"good", title:"Archaeologist's Hire",
        img:"evt_archaeo.png",
        body:"An archaeologist needs samples ferried back to a research lab.",
        apply(g){ return `Hired courier work paid ${fmt(_earn(g, 800, 2000))} ¢.`; } },
    ],

  };

  // attach localEvents arrays to each location object
  LOCATIONS.forEach(loc => { loc.localEvents = LOCAL_EVENTS[loc.id] || []; });

  // =====================================================================
  // ship sprite sheet config — update tileW/tileH to match your asset
  // =====================================================================
  const SHIP_SHEET = {
    src:   'assets/images/ships.png',
    tileW: 64,
    tileH: 64,
    cols:  4,
  };

  // =====================================================================
  // 12 ships — arranged 4 cols × 3 rows on the sprite sheet
  //   col/row   : 0-based position in the sheet
  //   cost      : credits deducted from starting cash on purchase
  //   cap       : cargo hold in tons (overrides mode default)
  //   fuelMod   : multiplier on travel fuel cost  (<1 = cheaper)
  //   speedMod  : multiplier on travel days       (<1 = faster)
  // =====================================================================
  const SHIPS = [
    // ── row 0: basic to mid ──────────────────────────────────────────
    {
      id: 'shuttle', col: 0, row: 0,
      name: 'Deckard-Class Shuttle',
      cost: 0, cap: 40, fuelMod: 1.0, speedMod: 1.0,
      flavor: 'No shame in starting small.',
      desc: 'A battered personal shuttle retrofitted with a cargo bay. Free, reliable, and embarrassing to park next to anyone with money. Gets the job done if you know what you\'re doing.',
    },
    {
      id: 'hauler', col: 1, row: 0,
      name: 'Kallis Standard Hauler',
      cost: 500, cap: 65, fuelMod: 1.0, speedMod: 1.0,
      flavor: 'Built in the belt, built to last.',
      desc: 'The workhorse of the trade lanes. Ample cargo space, reasonable fuel, no surprises. What most traders settle on — and what most start with.',
    },
    {
      id: 'clipper', col: 2, row: 0,
      name: 'Zephyr Clipper',
      cost: 1500, cap: 45, fuelMod: 0.88, speedMod: 0.78,
      flavor: 'Light load, fast lanes.',
      desc: 'A slender fast-courier hull optimized for speed over volume. The Clipper completes two runs where a hauler completes one. Time is money, and this ship prints time.',
    },
    {
      id: 'runner', col: 3, row: 0,
      name: 'Verra Rim Runner',
      cost: 2000, cap: 58, fuelMod: 0.80, speedMod: 0.85,
      flavor: 'What scanner? That\'s just a shadow.',
      desc: 'A hull that grew up dodging customs on the Verra outskirts. Fast, fuel-lean, and fitted with baffled compartments that make inspectors uncomfortable. Discretion is built in.',
    },
    // ── row 1: mid to advanced ────────────────────────────────────────
    {
      id: 'courier', col: 0, row: 1,
      name: 'Obsidian Courier',
      cost: 4000, cap: 52, fuelMod: 0.82, speedMod: 0.70,
      flavor: 'Speed is its own kind of diplomacy.',
      desc: 'Built in the black-glass yards of Obsidian Reach for aristocratic dispatch work. The fastest hull money buys at this price point — style that makes docking officers wave you through.',
    },
    {
      id: 'salvager', col: 1, row: 1,
      name: 'Halcyon Salvager',
      cost: 1200, cap: 85, fuelMod: 1.12, speedMod: 1.22,
      flavor: 'She\'ll get there. Eventually.',
      desc: 'Assembled from three derelict hulls at the Halcyon Drift yards. The expanded hold is genuinely impressive. Its engines, however, are a patchwork of compromises that adds up to slow.',
    },
    {
      id: 'forge_hauler', col: 2, row: 1,
      name: 'Caldera Forge-Hauler',
      cost: 3000, cap: 110, fuelMod: 1.30, speedMod: 1.45,
      flavor: 'Slow money is still money.',
      desc: 'An industrial bulk freighter from the Caldera-9 foundry line. The hold is enormous, the engines are enormous, and the fuel bills are enormous. When margin lives in volume, nothing else competes.',
    },
    {
      id: 'drifter', col: 3, row: 1,
      name: 'Erebus Drifter',
      cost: 1800, cap: 68, fuelMod: 0.90, speedMod: 0.95,
      flavor: 'Uncommonly reliable.',
      desc: 'A reef-adapted patrol hull from New Erebus, modified for open-lane trade. Good hold, decent speed, solid fuel economy. The choice of the cautious professional who wants no weak points.',
    },
    // ── row 2: specialty ─────────────────────────────────────────────
    {
      id: 'skimmer', col: 0, row: 2,
      name: 'Pavonis Skimmer',
      cost: 2500, cap: 58, fuelMod: 0.58, speedMod: 0.90,
      flavor: 'The routes pay. The fuel doesn\'t.',
      desc: 'Engineered at Pavonis Prime gas rigs to minimize fuel draw. In open space the savings are extraordinary — every jump costs dramatically less, and that compounds across an entire run.',
    },
    {
      id: 'pilgrim', col: 1, row: 2,
      name: 'Solenne Pilgrim Vessel',
      cost: 2200, cap: 62, fuelMod: 0.88, speedMod: 1.0,
      interestMod: 0.75,
      flavor: 'The Order\'s mark opens doors.',
      desc: 'A consecrated trading vessel blessed by the Order of Solenne. Superstitious bankers charge 25% less interest to its registered captain. Customs tends toward leniency. Hard to explain, easy to profit from.',
    },
    {
      id: 'ghost', col: 2, row: 2,
      name: 'Threnody Ghost',
      cost: 3500, cap: 58, fuelMod: 0.88, speedMod: 0.85,
      contrabandShield: true,
      flavor: 'What ship? Exactly.',
      desc: 'Built in the vertical slums of Threnody-7 for clients whose cargo prefers not to be noticed. Scans clean on any frequency that matters. Customs inspection events have a heavily reduced effect on this vessel.',
    },
    {
      id: 'explorer', col: 3, row: 2,
      name: 'Yoxai Deep Explorer',
      cost: 5000, cap: 72, fuelMod: 0.85, speedMod: 0.90,
      betterEvents: true,
      flavor: 'The ruins taught it patience.',
      desc: 'A long-range survey vessel retrofitted for trade after the Yoxai dig grants dried up. Enhanced sensor arrays give the captain advance reads on market conditions — bad random events occur less frequently.',
    },
  ];

  // =====================================================================
  // helpers
  // =====================================================================
  function goodName(id){ const g = GOODS.find(x=>x.id===id); return g ? g.name : id; }
  function locById(id){ return LOCATIONS.find(x=>x.id===id); }
  function fmt(n){ return Math.round(n).toLocaleString(); }
  function distance(a, b){
    const A = locById(a), B = locById(b);
    return Math.round(Math.hypot(A.x - B.x, A.y - B.y));
  }
  function travelCost(a, b){
    return Math.max(40, Math.round(distance(a, b) * 3));
  }
  function travelDays(a, b){
    return Math.max(1, Math.round(distance(a, b) / 60));
  }

  return {
    GOODS, LOCATIONS, EVENTS, TICKER_SEEDS, SHIPS, SHIP_SHEET,
    goodName, locById, fmt, distance, travelCost, travelDays,
  };
})();
