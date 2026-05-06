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
  //   canLoan  : (optional) marks the sector's banking hub — wire game logic
  //              to gate borrow/repay UI on this flag if/when desired.
  //   tagline  : one-line subtitle shown in the location card
  //   lore     : flavor blurb shown on first arrival (modal)
  // =====================================================================
const LOCATIONS = [
  {
    id: "terra", name: "Terra Prime", x: 0, y: 0,
    lawful: 1.0, icon: "loc_terra.png",
    produces: ["water", "grain"],
    demands:  ["robots", "qchip"],
    tagline: "The 'Totally Real' Home World. Sponsored by Jackhole Megacorp.",
    lore: "Jackhole Megacorp bought the naming rights to this rock and calls it 'The Cradle of Humanity' to dodge taxes. It's basically one giant office park with a nice gift shop. Very safe, very boring, and if you spit on the sidewalk, they'll garnish your wages for life."
  },
  {
    id: "zeph", name: "The Ledger Hub", x: 45, y: 80,
    lawful: 0.7, icon: "loc_zeph.png",
    produces: ["tech", "qchip"],
    demands:  ["art", "antim"],
    canLoan: true, // Unique mechanical flag for banking
    tagline: "Silicon Valley in the Stars. Banking with a smile and a wiretap.",
    lore: "The sector's premier offshore accounting moon. It’s where the tech-bros and the tax-dodgers hang out. You can get a massive loan here at 'competitive' rates, but read the fine print—they've been known to repo ships while they're still in mid-warp."
  },
  {
    id: "kallis", name: "Kallis Rock-Candy", x: 60, y: 25,
    lawful: 0.3, icon: "loc_kallis.png",
    produces: ["ore", "solar"],
    demands:  ["water", "medicine"],
    tagline: "A hollowed-out asteroid full of shiny rocks and grumpy miners.",
    lore: "It looks like a giant floating piece of coal, but the inside is a neon-lit maze of tunnels! The miners here use giant robot drills to find space-crystals. They’re super thirsty and have a lot of boo-boos, so bring water and bandages!"
  },
  {
    id: "verra", name: "Verra Vroom-Outpost", x: -95, y: 55,
    lawful: 0.1, icon: "loc_verra.png",
    produces: ["spice", "weapons"],
    demands:  ["fuel", "solar"],
    tagline: "The edge of the map where the space-pirates play!",
    lore: "A wild, wild west station with zero rules and lots of explosions! Smugglers race their ships through the rings for fun. If you want the spicy stuff or big laser guns, this is the place—just don't leave your keys in the ignition."
  },
  {
    id: "obsid", name: "Obsidian Spire", x: -35, y: -65,
    lawful: 0.6, icon: "loc_obsid.png",
    produces: ["glass", "art"],
    demands:  ["spice", "weapons"],
    tagline: "Fancy glass towers for very grumpy space-royalty.",
    lore: "The whole planet is made of shiny black glass! The kings and queens here wear capes made of starlight and spend all day painting pictures. They act very posh, but they secretly love spice and need big blasters to keep the space-monsters away."
  },
  {
    id: "halc", name: "Halcyon Junk-Heap", x: 95, y: -25,
    lawful: 0.3, icon: "loc_halc.png",
    produces: ["fuel", "plastics"],
    demands:  ["grain", "holo"],
    tagline: "A giant playground made of broken spaceships!",
    lore: "What do you do with a trillion tons of space-trash? You turn it into a city! The 'Junkers' climb through old engine rooms looking for fuel and plastic toys. They’re hungry for real food and love watching cartoon holos."
  },
  {
    id: "calder", name: "Caldera-9", x: -70, y: -10,
    lawful: 0.5, icon: "loc_calder.png",
    produces: ["robots", "cyber"],
    demands:  ["hydrogen", "organs"],
    tagline: "The Robot Factory Planet! Beep boop!",
    lore: "A giant volcano planet where robots build other robots who then build more robots! It's very hot and very loud. The machines need ice-cold hydrogen to keep from melting, and they’re always looking for 'spare organic parts' for their human pets."
  },
  {
    id: "erebus", name: "Bubble-Erebus", x: 50, y: -85,
    lawful: 0.4, icon: "loc_erebus.png",
    produces: ["algae", "salt"],
    demands:  ["tech", "cyber"],
    tagline: "A giant water-balloon planet full of glowing squids!",
    lore: "The cities here float in giant bubbles under the sea! You can see glowing algae and huge space-whales through the windows. Everything breaks because of the water, so they'll trade all their salt for new gadgets and robot legs!"
  },
  {
    id: "pavon", name: "Pavonis Clouds", x: 60, y: 95,
    lawful: 0.7, icon: "loc_pavon.png",
    produces: ["hydrogen", "antim"],
    demands:  ["textiles", "lumber"],
    tagline: "Floating castles in the sky! Don't look down!",
    lore: "The rich 'Cloud Barons' live in houses held up by giant balloons. They have lots of fancy fuel but they don't have any trees or blankets. They'll pay a bajillion credits for a wooden chair or a warm sweater!"
  },
  {
    id: "solen", name: "Solenne Garden", x: -105, y: -85,
    lawful: 0.6, icon: "loc_solen.png",
    produces: ["medicine", "holo"],
    demands:  ["salt", "plastics"],
    tagline: "The Space-Monk Sanctuary. Shhh... they're praying.",
    lore: "A very quiet planet full of gardens and copper towers. The space-monks use giant lasers to write poems on the moon. They make magic medicine and cool movies, but for some reason, they really, really love eating salt."
  },
  {
    id: "goog", name: "The Threnody Stack", x: 15, y: -100,
    lawful: 0.2, icon: "loc_thren.png",
    produces: ["organs", "lace"],
    demands:  ["algae", "glass"],
    tagline: "The world's biggest skyscraper! It goes up forever!",
    lore: "Imagine a building so tall it pokes out of the atmosphere! Millions of people live in tiny rooms stacked on top of each other. They make cool brain-chips and bionic hearts, but they have to eat slimy algae every single day. Gross!"
  },
  {
    id: "yoxai", name: "Yoxai Jungle", x: -65, y: 100,
    lawful: 0.3, icon: "loc_yoxai.png",
    produces: ["textiles", "lumber"],
    demands:  ["ore", "lace"],
    tagline: "Alien ruins and giant plants. Watch out for the vines!",
    lore: "A spooky, beautiful jungle full of broken alien statues that might be alive! Scientists come here to find magic wood and silk. They need heavy rocks to build their camps and brain-lace to talk to the statues!"
  }
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
    "JACKHOLE MEGACORP: Our orbital sensors have detected you are thinking about a snack. Please purchase a snack.",
    "REMINDER: Bankruptcy is a breach of your 'Life-Usage Agreement'. Defaulters will be converted into Caldera-9 lubricants.",
    "TERRA PRIME: Water prices dropped! Buy now before we remember to charge you for the bottle.",
    "THE BUREAU: We have updated your file. We know what you did at the Halcyon Junk-Heap. It was hilarious.",
    "KALLIS BELT: Strike ended after Megacorp successfully replaced all 5,000 miners with slightly cheaper rocks.",
    "THE LEDGER HUB: Your loan interest just went up 2% because you're breathing too fast. Calm down and save money.",
    "MARKET ALERT: High-grade Organs are trending! Remember: You have two kidneys, but you only NEED one ship.",
    "ATTENTION: A 500-credit 'Viewing Fee' has been deducted from your account for reading this ticker. You're welcome.",
    "SOLENNE VERGE: Monks claim salt-hoarding is 'divine.' Jackhole Megacorp claims it's 'market manipulation.' Fight! Fight!",
    "URGENT: Smuggling is strictly prohibited unless you use the official Jackhole Megacorp 'Discretion Surcharge' app.",
    "YOXAI JUNGLE: Ancient alien ruins discovered! Megacorp lawyers are currently suing the ruins for copyright infringement.",
    "EREBUS BUBBLES: Record Algae harvest! It's green, it's slimy, and it's legally classified as 'food-adjacent'!",
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

    goog: [
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
  // ship sprite sheet config — single consolidated atlas
  //   frame coords mirror /assets/sprites/ships.json
  // =====================================================================
  const SHIP_SPRITES = {
    src:    'assets/sprites/ships.png',
    sheetW: 2514, sheetH: 1508,
    frames: {
      eyeball:   { x:    2, y:    2, w: 500, h: 500 },
      skull:     { x:  588, y:    2, w: 511, h: 488 },
      spider:    { x: 1183, y:    2, w: 538, h: 420 },
      squid:     { x: 1848, y:    2, w: 664, h: 376 },
      submarine: { x:    2, y:  504, w: 518, h: 318 },
      whale:     { x:  588, y:  504, w: 593, h: 421 },
      worm:      { x: 1183, y:  504, w: 663, h: 377 },
      bee:       { x: 1848, y:  504, w: 500, h: 500 },
      bottle:    { x:    2, y: 1006, w: 584, h: 427 },
      brain:     { x:  588, y: 1006, w: 469, h: 353 },
      cube:      { x: 1183, y: 1006, w: 534, h: 468 },
      cyber:     { x: 1848, y: 1006, w: 500, h: 500 },
    },
  };

  // =====================================================================
  // 12 ships
  //   sprite           : frame key inside SHIP_SPRITES.frames
  //   cost             : credits deducted from starting cash on purchase
  //   cap              : cargo hold in tons (overrides mode default)
  //   passCap          : passenger berths (data only — no game logic yet)
  //   fuelCap          : maximum ship fuel reservoir (units)
  //   fuelMod          : multiplier on travel fuel use   (<1 = cheaper)
  //   speedMod         : multiplier on travel days       (<1 = faster)
  //   maint            : daily maintenance cost (data only — no game logic yet)
  //   interestMod      : multiplier on loan interest rate
  //   contrabandShield : true → customs inspections often find nothing
  //   betterEvents     : true → bad random events fire less often
  // =====================================================================
const SHIPS = [
  // ── STARTER / MID ────────────────────────────────────────────────
  {
    id: 'shuttle', sheet: 'one', sprite: 'bottle',
    name: 'Deckard-Class Shuttle',
    cost: 0, cap: 40, passCap: 2, fuelCap: 80, fuelMod: 1.0, speedMod: 1.0, maint: 10,
    flavor: 'Is that... cola?',
    desc: 'An old promotional soda transport retrofitted with life support. It’s sticky, the engine sounds like a burp, and it’s free. No shame in starting small, but plenty of shame in being seen in this.',
  },
  {
    id: 'hauler', sheet: 'one', sprite: 'cube',
    name: 'Kallis Standard Hauler',
    cost: 500, cap: 75, passCap: 0, fuelCap: 120, fuelMod: 1.1, speedMod: 1.0, maint: 25,
    flavor: 'Suspend your disbelief (and your cargo).',
    desc: 'Literally a block of gelatinous suspension fluid held in a purple force-field. It doesn’t have hallways, just pockets of air. Great for bulk, terrible for anyone who hates being moist.',
  },
  {
    id: 'clipper', sheet: 'two', sprite: 'bee',
    name: 'Zephyr Clipper',
    cost: 1500, cap: 45, passCap: 8, fuelCap: 100, fuelMod: 0.88, speedMod: 0.78, maint: 40,
    flavor: 'Float like a butterfly, sting like a fuel bill.',
    desc: 'An insectoid hull with vibrating wings that somehow provide thrust in a vacuum. It’s the fastest way to get eight passengers across the sector, provided they don’t mind the constant buzzing.',
  },
  {
    id: 'runner', sheet: 'one', sprite: 'worm',
    name: 'Verra Rim Runner',
    cost: 2000, cap: 58, passCap: 4, fuelCap: 110, fuelMod: 0.80, speedMod: 0.85, maint: 50,
    flavor: 'The segmented speedster.',
    desc: 'Its bio-mechanical segments allow it to weave through asteroid belts that would shred a hauler. It’s slimy and the air filters smell like compost, but customs can never quite catch it.',
  },

  // ── ADVANCED ─────────────────────────────────────────────────────
  {
    id: 'courier', sheet: 'two', sprite: 'spider',
    name: 'Obsidian Courier',
    cost: 4000, cap: 52, passCap: 12, fuelCap: 100, fuelMod: 0.82, speedMod: 0.70, maint: 85,
    flavor: 'Eight legs, zero delays.',
    desc: 'The ultimate in high-society dispatch. The Obsidian Courier crawls through the jump-gates with terrifying precision. Its pressurized cabin is a favorite for aristocrats who enjoy a gothic touch.',
  },
  {
    id: 'salvager', sheet: 'one', sprite: 'submarine',
    name: 'Halcyon Salvager',
    cost: 1200, cap: 85, passCap: 3, fuelCap: 140, fuelMod: 1.12, speedMod: 1.22, maint: 30,
    flavor: 'Pressure-tested for the deep black.',
    desc: 'Looks like it belongs underwater, but it handles the vacuum just as well. It’s a rusted tank with a massive belly—clunky and slow, but it can carry a whole scrapyard in one go.',
  },
  {
    id: 'forge_hauler', sheet: 'one', sprite: 'whale',
    name: 'Caldera Forge-Hauler',
    cost: 3000, cap: 130, passCap: 2, fuelCap: 220, fuelMod: 1.35, speedMod: 1.45, maint: 100,
    flavor: 'Steam-powered profit.',
    desc: 'A massive, brass-bound beast that exhales pink exhaust. It’s an industrial behemoth with enough cargo room to crash a local market single-handedly. If you can afford the fuel, you win.',
  },
  {
    id: 'drifter', sheet: 'one', sprite: 'squid',
    name: 'Erebus Drifter',
    cost: 1800, cap: 68, passCap: 6, fuelCap: 130, fuelMod: 0.90, speedMod: 0.95, maint: 45,
    flavor: 'Tentacles of trade.',
    desc: 'The Drifter uses its glowing propulsion limbs to glide through the void. It’s an uncommonly reliable ship with a balanced stat spread, popular with traders who don’t want any surprises.',
  },

  // ── SPECIALTY ────────────────────────────────────────────────────
  {
    id: 'skimmer', sheet: 'two', sprite: 'cyber',
    name: 'Pavonis Skimmer',
    cost: 2500, cap: 60, passCap: 10, fuelCap: 160, fuelMod: 0.55, speedMod: 0.90, maint: 60,
    flavor: 'Neon-infused efficiency.',
    desc: 'A sharp, crystalline hull that literally eats light to power its engines. It has the lowest fuel draw in the sector. It looks like a high-tech diamond and moves like a laser beam.',
  },
  {
    id: 'pilgrim', sheet: 'two', sprite: 'brain',
    name: 'Solenne Pilgrim Vessel',
    cost: 2200, cap: 62, passCap: 20, fuelCap: 120, fuelMod: 0.88, speedMod: 1.0, interestMod: 0.75, maint: 35,
    flavor: 'Thought-controlled travel.',
    desc: 'A giant, preserved brain encased in a golden dome. It’s a sacred vessel of the Order. Bankers find the ship so unsettling (or holy) that they offer significantly lower interest rates to its owners.',
  },
  {
    id: 'ghost', sheet: 'two', sprite: 'skull',
    name: 'Threnody Ghost',
    cost: 3500, cap: 58, passCap: 4, fuelCap: 130, fuelMod: 0.88, speedMod: 0.85, contrabandShield: true, maint: 70,
    flavor: 'Death at the wheel.',
    desc: 'A menacing hull shaped like a titan’s skull on wheels. It uses "fear-tech" to scramble scanners. Most customs agents see this coming and decide they’re too busy to perform an inspection.',
  },
  {
    id: 'explorer', sheet: 'two', sprite: 'eyeball',
    name: 'Yoxai Deep Explorer',
    cost: 5000, cap: 72, passCap: 12, fuelCap: 180, fuelMod: 0.85, speedMod: 0.90, betterEvents: true, maint: 110,
    flavor: 'The eye that never blinks.',
    desc: 'Equipped with a giant, organic optic sensor. It can see market fluctuations three systems away. It avoids negative random events by simply seeing them coming and steering the other way.',
  },
];

const COMPETITORS = [
  { 
    id: 'onix', name: 'Onix Paper-Pushers', style: 'steady',
    motto: 'We love forms. We live for files.',
    flavor: 'A subsidiary so boring that even Jackhole Megacorp forgot they owned them. They specialize in shipping stationary and staplers. They never crash, but they never truly soar—they just... exist.'
  },
  { 
    id: 'kallisco', name: 'Kallis Heavy Metalheads', style: 'aggressive',
    motto: 'If it’s heavy, we’ll drop it!',
    flavor: 'Ex-miners who spent too much time huffing asteroid dust. They fly massive, rusted bricks and don’t believe in brakes. They make big money or big craters. There is no middle ground.'
  },
  { 
    id: 'pavonis', name: 'Pavonis Cloud-Clown Cartel', style: 'volatile',
    motto: 'Keep your head in the clouds!',
    flavor: 'High-altitude thrill-seekers who trade in helium and ego. Their net worth swings wildly based on how many 'Sky-Parties' they throw. One day they’re kings, the next they’re selling their shoes for fuel.'
  },
  { 
    id: 'zephyr', name: 'Bala Bureau Free-Riders', style: 'aggressive',
    motto: 'Catch us if you can (you can\'t)!',
    flavor: 'A group of renegade accountants from the Ledger Hub who stole a fleet of ships and deleted their own debt files. They trade fast and dirty, always one step ahead of a Jackhole audit.'
  },
  { 
    id: 'threnco', name: 'Threnody Spine-Snatchers', style: 'volatile',
    motto: 'Your trash is our treasure (and also your organs).',
    flavor: 'The ultimate bottom-feeders from the Slum-Stacks. They deal in black-market brain-lace and second-hand kidneys. Their stock price is as unstable as the illegal cybernetics they sell.'
  },
  { 
    id: 'solenne', name: 'Solenne Salt-Saints', style: 'steady',
    motto: 'Praise the Machine! Pass the Salt!',
    flavor: 'Monks who believe that cargo is a form of prayer. They move slowly, chanting into their comm-links and hoarding industrial salt. Jackhole leaves them alone because their medicine is the only thing that cures corporate stress-headaches.'
  },
];

  // =====================================================================
  // ship fuel — per-location base price and travel-cost helpers
  //   travelFuel returns units consumed per jump (after shipFuelMod);
  //   fuelBasePrice gives the location's posted price per unit.
  // =====================================================================
  const FUEL_PRICES = {
    pavon:  6,   // gas-giant rigs — the cheapest cell on the lane
    halc:   8,   // salvage town drips fuel from stripped hulls
    kallis: 10,
    terra:  11,
    obsid:  12,
    zeph:   12,
    erebus: 12,
    calder: 13,
    yoxai:  13,
    solen:  14,
    verra:  14,
    goog:   15,  // black-market markup
  };

  function travelFuel(a, b, fuelMod = 1.0) {
    return Math.max(4, Math.round(distance(a, b) / 9 * fuelMod));
  }
  function fuelBasePrice(locId) {
    return FUEL_PRICES[locId] || 12;
  }

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
    GOODS, LOCATIONS, EVENTS, TICKER_SEEDS,
    SHIPS, SHIP_SPRITES, COMPETITORS, FUEL_PRICES,
    goodName, locById, fmt, distance,
    travelCost, travelDays, travelFuel, fuelBasePrice,
  };
})();
