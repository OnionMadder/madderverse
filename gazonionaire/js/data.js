
const GAME_DATA = (() => {

const GOODS = [
    // --- tier 1: Mandatory Survival Assets ---
    { id: "water",    name: "O2-Infused Hydrant", basePrice:    20, volatility: 0.10, bulk: 1, legal: true,  icon: "water.png"    },
    { id: "grain",    name: "Nutri-Brick™",       basePrice:    45, volatility: 0.15, bulk: 1, legal: true,  icon: "grain.png"    },
    { id: "algae",    name: "Wretched Algae",     basePrice:    60, volatility: 0.15, bulk: 1, legal: true,  icon: "algae.png"    },
    { id: "salt",     name: "Industrial Salt",    basePrice:    35, volatility: 0.12, bulk: 1, legal: true,  icon: "salt.png"     },
    { id: "ore",      name: "Raw Sludge",         basePrice:   110, volatility: 0.20, bulk: 2, legal: true,  icon: "ore.png"      },
    { id: "hydrogen", name: "Coolant Slush",      basePrice:    90, volatility: 0.18, bulk: 1, legal: true,  icon: "hydrogen.png" },

    // --- tier 2: Bureaucracy & Infrastructure ---
    { id: "fuel",     name: "Jackhole Fuel Cells",basePrice:   180, volatility: 0.18, bulk: 1, legal: true,  icon: "fuel.png"     },
    { id: "plastics", name: "Recycled Gunk",      basePrice:   160, volatility: 0.18, bulk: 1, legal: true,  icon: "plastics.png" },
    { id: "glass",    name: "Reinforced Glitch-Glass", basePrice: 140, volatility: 0.20, bulk: 2, legal: true,  icon: "glass.png" },
    { id: "textiles", name: "Bureau Uniforms",    basePrice:   220, volatility: 0.20, bulk: 1, legal: true,  icon: "textiles.png" },
    { id: "lumber",   name: "Yoxai Resin-Wood",   basePrice:   280, volatility: 0.22, bulk: 2, legal: true,  icon: "lumber.png"   },
    { id: "medicine", name: "Morale Stabilizers", basePrice:   380, volatility: 0.22, bulk: 1, legal: true,  icon: "medicine.png" },

    // --- tier 3: Advanced Containment Tech ---
    { id: "tech",     name: "Terminal Parts",     basePrice:   420, volatility: 0.25, bulk: 1, legal: true,  icon: "tech.png"     },
    { id: "solar",    name: "Oversight Arrays",   basePrice:   520, volatility: 0.22, bulk: 2, legal: true,  icon: "solar.png"    },
    { id: "organs",   name: "Bionic Gizzards",    basePrice:  1100, volatility: 0.30, bulk: 1, legal: true,  icon: "organs.png"   },
    { id: "robots",   name: "Auditor Drones",     basePrice:  1400, volatility: 0.28, bulk: 2, legal: true,  icon: "robots.png"   },
    { id: "cyber",    name: "Work-Ready Limbs",   basePrice:  1600, volatility: 0.30, bulk: 1, legal: true,  icon: "cyber.png"    },

    // --- tier 4: High-Level Corporate Luxury ---
    { id: "qchip",    name: "Bala-Link Chips",    basePrice:  2200, volatility: 0.32, bulk: 1, legal: true,  icon: "qchip.png"    },
    { id: "art",      name: "Redacted Files",     basePrice:  2800, volatility: 0.38, bulk: 1, legal: true,  icon: "art.png"      },
    { id: "holo",     name: "Propaganda Cubes",   basePrice:  3400, volatility: 0.35, bulk: 1, legal: true,  icon: "holo.png"     },
    { id: "lace",     name: "Neural Leash",       basePrice:  3800, volatility: 0.38, bulk: 1, legal: true,  icon: "lace.png"     },
    { id: "antim",    name: "Reality Vials",      basePrice:  4500, volatility: 0.40, bulk: 1, legal: true,  icon: "antim.png"    },

    // --- Contraband: Anomaly-Adjacent Assets ---
    { id: "spice",    name: "Unrefined Anomaly",  basePrice:  2200, volatility: 0.45, bulk: 1, legal: false, icon: "spice.png"    },
    { id: "weapons",  name: "Infraction Tools",   basePrice:  3000, volatility: 0.40, bulk: 1, legal: false, icon: "weapons.png"  },
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
    lawful: 1.0, icon: "loc_terra.png", planetSprite: "terra-prime",
    produces: ["water", "grain"],
    demands:  ["robots", "qchip"],
    tagline: "The 'Totally Real' Home World. Sponsored by Jackhole Megacorp.",
    lore: "Jackhole Megacorp purchased the naming rights to the concept of 'Home' back in '24. This rock is a sanitized office-sprawl where the air is 40% advertising by weight. If you aren't actively producing value, you're trespassing on corporate reality. Remember: Breathing is a subscription service here, and the 'Free Trial' expired before you were born. Spitting on the sidewalk is considered an unauthorized biological leak and will result in life-long wage garnishment."
  },
  {
    id: "zeph", name: "The Ledger Hub", x: 45, y: 80,
    lawful: 0.7, icon: "loc_zeph.png", planetSprite: "ledger-hub",
    produces: ["tech", "qchip"],
    demands:  ["art", "antim"],
    canLoan: true, 
    tagline: "Silicon Valley in the Stars. Your soul is a rounding error.",
    lore: "The central nervous system of the Jackhole accounting hive. It’s a moon-sized spreadsheet where the tech-bros and tax-dodgers hang out in high-contrast neon bunkers. They offer 'Citizen Lubricant' loans to bypass encryption gates, but the interest is paid in biological processing power. Don't bother reading the fine print; it's written in a frequency that induces permanent hair loss and erratic whimpering. They've been known to repo ships while they're still in mid-warp if your nostrils flare too much during an audit."
  },
  {
    id: "kallis", name: "Kallis Rock-Candy", x: 60, y: 25,
    lawful: 0.3, icon: "loc_kallis.png", planetSprite: "kallis-rock",
    produces: ["ore", "solar"],
    demands:  ["water", "medicine"],
    tagline: "A hollowed-out asteroid. Labor-Units wanted. Do not report the smell.",
    lore: "A jagged void-husk where 'Labor-Units' mine space-crystals until their structural integrity fails. Jackhole replaced the union with 'Organic Notifications'—if you stop swinging the pick, a Bala-entity manifests in your bunk to scream quarterly projections at you until you resume task-oriented behavior. The tunnels are neon-lit mazes of pustulent grime. The miners are chronically rash-covered and desperate for 'O2-Infused Hydrants' and 'Morale Stabilizers.' Bring bandages, but don't touch the vines."
  },
  {
    id: "verra", name: "Verra Vroom-Outpost", x: -95, y: 55,
    lawful: 0.1, icon: "loc_verra.png", planetSprite: "vroom-outpost",
    produces: ["spice", "weapons"],
    demands:  ["fuel", "solar"],
    tagline: "Unsanctioned kinetics and high-velocity infractions.",
    lore: "The edge of the map where the Jackhole signal starts to glitch. It’s a high-octane wasteland where smugglers race ships through rings just to feel something other than corporate dread. There are zero rules here, but plenty of explosions—mostly from engines running on 'Unrefined Anomaly.' If you’re looking for 'Infraction Tools,' this is the locus. Just don't leave your keys in the ignition; the local 'Free-Riders' consider theft a form of rhythmic asset reallocation."
  },
  {
    id: "obsid", name: "Obsidian Spire", x: -35, y: -65,
    lawful: 0.6, icon: "loc_obsid.png", planetSprite: "obsidian-spire",
    produces: ["glass", "art"],
    demands:  ["spice", "weapons"],
    tagline: "Gothic asset-hoarding for the high-level audit-immune.",
    lore: "The whole planet is a monolithic shard of 'Reinforced Glitch-Glass.' The Cloud Barons here wear capes made of literal starlight and spend their days archiving 'Redacted Files.' They act posh, but it’s a mask for the deep-seated fear of 'Perimeter Failure.' They secretly crave 'Unrefined Anomaly' to numb the boredom of immortality and need heavy-duty 'Infraction Tools' to keep the recursive space-monsters from nesting in their spires. Silence is the only currency they value more than credits."
  },
  {
    id: "halc", name: "Halcyon Junk-Heap", x: 95, y: -25,
    lawful: 0.3, icon: "loc_halc.png", planetSprite: "halcyon-junk",
    produces: ["fuel", "plastics"],
    demands:  ["grain", "holo"],
    tagline: "A trillion tons of Jackhole's discarded history.",
    lore: "What do you do with a trillion tons of Jackhole industrial waste? You stack it until it develops its own gravity. The 'Junkers' are bottom-feeders who crawl through rusted engine rooms looking for 'Jackhole Fuel Cells' and 'Recycled Gunk.' They are perpetually starved for 'Nutri-Bricks™' and will trade their last scrap of dignity for a 'Propaganda Cube' to distract them from the smell of pork lard and college dorms that permeates the lower stacks. It's a playground, but the floor is made of logic-defying biological hazards."
  },
  {
    id: "calder", name: "Caldera-9", x: -70, y: -10,
    lawful: 0.5, icon: "loc_calder.png", planetSprite: "caldera-9",
    produces: ["robots", "cyber"],
    demands:  ["hydrogen", "organs"],
    tagline: "The Foundry Planet. Optimization through incineration.",
    lore: "A giant volcano planet where 'Auditor Drones' build other drones in a recursive loop of unpaid labor. It's a high-decibel hellscape where the heat is leveraged to 'optimize' worker output. The machines require 'Coolant Slush' to prevent thermal logic-failure, and they are perpetually scanning for 'Bionic Gizzards' to integrate into their human pets. Jackhole calls the frequent foundry explosions 'spontaneous urban renewal.'"
  },
  {
    id: "erebus", name: "Bubble-Erebus", x: 50, y: -85,
    lawful: 0.4, icon: "loc_erebus.png", planetSprite: "bubble-erebus",
    produces: ["algae", "salt"],
    demands:  ["tech", "cyber"],
    tagline: "Sub-aquatic containment bubbles. Watch the whales, ignore the leaks.",
    lore: "The cities here float in 'Reinforced Glitch-Glass' bubbles under a crushing methane sea. You can see 'Wretched Algae' blooms and huge, logic-defying space-whales through the windows. Everything breaks because of the caustic water, so the local Bureau agents will trade all their 'Industrial Salt' for 'Terminal Parts' and 'Work-Ready Limbs'. It’s the only place in the sector where 'unauthorized moistness' is an environmental hazard rather than just a personality flaw."
  },
  {
    id: "pavon", name: "Pavonis Clouds", x: 60, y: 95,
    lawful: 0.7, icon: "loc_pavon.png", planetSprite: "pavonis-clouds",
    produces: ["hydrogen", "antim"],
    demands:  ["textiles", "lumber"],
    tagline: "Floating castles for the Cloud-Baron Cartel.",
    lore: "The high-altitude 'Cloud Barons' live in houses held up by giant balloons, literally looking down on the rest of the revenue streams. They have a surplus of 'Reality Vials' and 'Coolant Slush' but zero access to organic comforts. They’ll pay a bajillion credits for 'Yoxai Resin-Wood' or a 'Bureau Uniform' just to feel something other than the thin, recycled air of their sky-casinos. Don't look down; the ground has been declassified for your protection."
  },
  {
    id: "solen", name: "Solenne Garden", x: -105, y: -85,
    lawful: 0.6, icon: "loc_solen.png", planetSprite: "solenne-gardens",
    produces: ["medicine", "holo"],
    demands:  ["salt", "plastics"],
    tagline: "The Space-Monk Sanctuary. Shhh... they're audit-syncing.",
    lore: "A deceptively quiet planet full of copper towers and gardens that grow in logic-defying patterns. The space-monks are actually Bureau-assigned 'Biological Auditors' who use giant lasers to write encrypted poems on the moon. They manufacture 'Morale Stabilizers' and 'Propaganda Cubes,' but they have a ravenous, cult-like obsession with 'Industrial Salt.' Rumor has it the salt is the only thing keeping their structural integrity from collapsing into a Bala-state."
  },
  {
    id: "goog", name: "The Threnody Stack", x: 15, y: -100,
    lawful: 0.2, icon: "loc_thren.png", planetSprite: "threnody-stack",
    produces: ["organs", "lace"],
    demands:  ["algae", "glass"],
    tagline: "The world's biggest skyscraper. Optimization through density.",
    lore: "Imagine a building so tall it pokes out of the atmosphere and into a corrupted dimensional fault. Millions of 'Debt-Citizens' live in 2x2 pods stacked on top of each other in a permanent state of Rhythmic Asset Alignment. They manufacture 'Bionic Gizzards' and 'Neural Leashes,' but their only caloric intake is 'Wretched Algae' pumped through the walls. It is a vertical slum of high-contrast neon and 'unauthorized moistness' that the Bureau calls 'A Triumph of Efficiency.'"
  },
  {
    id: "yoxai", name: "Yoxai Jungle", x: -65, y: 100,
    lawful: 0.3, icon: "loc_yoxai.png", planetSprite: "yoxai-jungle",
    produces: ["textiles", "lumber"],
    demands:  ["ore", "lace"],
    tagline: "Recursive ruins and sentient vines. Watch your step.",
    lore: "A spooky, beautiful jungle full of broken alien statues that Jackhole Megacorp is currently suing for copyright infringement. Scientists come here to harvest 'Yoxai Resin-Wood' and 'Bureau Uniform' fibers while dodging vines that vibrate at the frequency of a whining cryptid. They need 'Raw Sludge' to build containment camps and 'Neural Leashes' to attempt a conversation with the statues. If the ruins start singing quarterly projections, run for your ship."
  }
];

  // =====================================================================
  // random events (post-travel)
  // =====================================================================
const EVENTS = [
  {
    id: "pirates", weight: 8, type: "bad", title: "Asset Recovery Specialists",
    img: "evt-pirates.jpg",
    body: "Aggressive 'Tax-Pirates' from the Jackhole Repo-Division board your ship, claiming your very existence is a breach of the peace.",
    apply(g){
      const carried = Object.entries(g.cargo).filter(([,n])=>n>0);
      if(!carried.length) return "The Specialists found you broke. They invoiced you 50¢ for the wear and tear on their boarding magnetic-boots.";
      const [gid, n] = carried[Math.floor(Math.random()*carried.length)];
      const stolen = Math.max(1, Math.floor(n * (0.2 + Math.random()*0.3)));
      g.cargo[gid] -= stolen;
      return `Specialists 'legally repossessed' ${stolen} units of ${goodName(gid)} to satisfy a clerical error.`;
    }
  },
  {
    id: "customs", weight: 6, type: "bad", title: "Moistness Inspection",
    img: "evt-customs.jpg",
    body: "A Jackhole Auditor boards for a 'Surprise Lifestyle Compliance Review' after detecting unauthorized whining in your sector.",
    apply(g){
      const loc = locById(g.location);
      const contraband = GOODS.filter(x => !x.legal && (g.cargo[x.id]||0) > 0);
      const checkMod = g.betterEvents ? 0.4 : 1.0;
      if (!contraband.length || (Math.random() * checkMod) > loc.lawful) {
        return "The Auditor got distracted by a glitching advertisement in their own visor. You passed.";
      }
      if (g.contrabandShield && Math.random() < 0.75) {
        return "Your fear-tech scrambled the Auditor's scanner. They blamed an intern and left in a huff.";
      }
      const c = contraband[0];
      const lost = g.cargo[c.id];
      g.cargo[c.id] = 0;
      const fine = Math.floor(lost * c.basePrice * 0.65);
      g.cash = Math.max(0, g.cash - fine);
      return `Auditor seized your ${lost} ${c.name}. Fine for 'Unauthorized Moistness': ${fmt(fine)} ¢.`;
    }
  },
  {
    id: "boom", weight: 5, type: "good", title: "Marketing Frenzy!",
    img: "evt-boom.jpg",
    body: "Jackhole Marketing triggers a mass-psychosis event, creating an artificial demand frenzy for a random shiny object.",
    apply(g){
      const good = GOODS[Math.floor(Math.random()*GOODS.length)];
      g.priceMods[good.id] = (g.priceMods[good.id] || 1) * 1.8;
      g.priceModsExpire[good.id] = g.day + 3;
      return `HYPE: Jackhole declared ${good.name} 'Essential for Spiritual Growth.' Prices are astronomical!`;
    }
  },
  {
    id: "bust", weight: 5, type: "bad", title: "Sudden Declassification",
    img: "evt-bust.jpg",
    body: "The Bala Files Bureau accidentally leaks a scandal, suggesting a commodity is actually made of 'class-IV digital remnants.'",
    apply(g){
      const good = GOODS[Math.floor(Math.random()*GOODS.length)];
      g.priceMods[good.id] = (g.priceMods[good.id] || 1) * 0.4;
      g.priceModsExpire[good.id] = g.day + 4;
      return `SCANDAL: ${good.name} is 'canceled' by the Bureau. Its value imploded into the Glitch Maw.`;
    }
  },
  {
    id: "find", weight: 3, type: "good", title: "Administrative Error!",
    img: "evt-find.jpg",
    body: "You find a Jackhole supply crate that 'fell' off a transport ship. It was likely destined for a Slum-Stack, but now it's yours.",
    apply(g){
      const credits = 300 + Math.floor(Math.random()*2000);
      g.cash += credits;
      return `Found ${fmt(credits)} ¢ in untraceable corporate slush funds. Praise the Machine!`;
    }
  },
  {
    id: "oxygen", weight: 4, type: "warn", title: "Respiratory Maintenance",
    img: "evt-oxygen.jpg",
    body: "Jackhole Megacorp reminds you that the 'Free Trial' for breathing expired when you left Terra Prime.",
    apply(g){
      const fee = 150 + Math.floor(Math.random()*500);
      g.cash = Math.max(0, g.cash - fee);
      return `Deducted ${fmt(fee)} ¢ for your 'Voluntary Respiratory Subscription'. Silence is permission.`;
    }
  },
  {
    id: "bala_leak", weight: 4, type: "good", title: "Bureau Intel",
    img: "evt-tip.jpg",
    body: "A disgruntled clerk at the Bala Files Bureau faxes you a file they found in the Meat Locker.",
    apply(g){
      const good = GOODS[Math.floor(Math.random()*GOODS.length)];
      const upcoming = Math.random() < 0.5 ? "skyrocket" : "implode";
      g.tickerQueue.push(`BUREAU LEAK: Data farming suggests ${good.name} will ${upcoming}.`);
      return `Intel secured. The Bureau knows all, and now so do you, Citizen.`;
    }
  },
];

  // =====================================================================
  // starting headlines for the news ticker
  // =====================================================================
const TICKER_SEEDS = [
    "JACKHOLE MEGACORP: Our orbital sensors have detected you are thinking about a snack. Thinking is a premium service. Please purchase a snack and the associated thought-license.",
    "REMINDER: Bankruptcy is a breach of your 'Civilian Contract'. Defaulters will be processed into 'Auditor Drone' lubricant on Caldera-9.",
    "BUREAU NOTICE: If you see an entity that looks like a 1994 workstation, do not feed it your credits. It is a Bala-class anomaly and currently your problem.",
    "THE BUREAU: We have updated your file. We know what you did at the Halcyon Junk-Heap. The 'unauthorized moistness' has been logged as a taxable event.",
    "KALLIS BELT: Strike ended after Megacorp successfully replaced all 5,000 miners with slightly cheaper, more compliant rocks. Productivity has never been more mineral.",
    "THE LEDGER HUB: Your loan interest just went up 3% because your heart rate suggests you're enjoying your free time. Calm down and return to a task-oriented state.",
    "MARKET ALERT: High-grade Bionic Gizzards are trending! Remember: You have two kidneys, but you only NEED one Assigned Vessel.",
    "ATTENTION: A 500-credit 'Holistic Accountability Fee' has been deducted from your account for reading this ticker. Silence is permission.",
    "SOLENNE GARDEN: Biological Auditors claim salt-hoarding is 'divine.' Jackhole Megacorp claims it's 'market manipulation.' The Bureau is currently taking bets.",
    "URGENT: Smuggling is strictly prohibited unless you use the official Jackhole Megacorp 'Discretion Surcharge' app to properly invoice your infractions.",
    "YOXAI JUNGLE: Ancient alien ruins discovered! Megacorp lawyers are currently suing the ruins for copyright infringement of the Jackhole 'Gothic-Spire' aesthetic.",
    "EREBUS BUBBLES: Record Wretched Algae harvest! It's green, it's slimy, and it's legally classified as 'food-adjacent' by the Department of Dirty Liars.",
    "BUREAU WARNING: Do not interact with advertisement entities that appear to be whimpering. They are likely Pojo Kutty™ variants and highly pustulent.",
    "OFFICIAL MEMO: Your structural integrity is a privilege, not a right. Maintain your quota to avoid 'Subject Integration' protocols."
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
  // per-location flavor events rolled on arrival in addition to global
  //   apply(g) returns a resolution string; may mutate g.market[g.location]
  //   to give one-visit price tweaks (rerolled when player leaves).
  // =====================================================================
  const LOCAL_EVENTS = {

    terra: [
      { id:"permit_fee", weight:35, type:"warn", title:"Pact Permit Fee",
        img:"evt-permit.jpg",
        body:"Pact bureaucrats process your docking papers — for a fee.",
        apply(g){ return `Permit cost ${fmt(_pay(g, 100, 300))} ¢.`; } },
      { id:"pact_charter", weight:30, type:"good", title:"Diplomatic Charter",
        img:"evt-charter.jpg",
        body:"A Pact attaché slips you discreet courier work.",
        apply(g){ return `Charter paid ${fmt(_earn(g, 600, 1500))} ¢.`; } },
      { id:"undermarket", weight:35, type:"good", title:"Subway Contact",
        img:"evt-undermarket.jpg",
        body:"A contact in the under-city offers contraband at black-market rates.",
        apply(g){ _disc(g, ["spice","weapons"], 0.65);
                  return "Spice & arms 35% off this visit."; } },
    ],

    kallis: [
      { id:"cavein", weight:35, type:"good", title:"Mine Cave-In",
        img:"evt-cavein.jpg",
        body:"A shaft collapse forces miners to dump ore at fire-sale prices.",
        apply(g){ _disc(g, ["ore"], 0.5);
                  return "Ore 50% off this visit."; } },
      { id:"miners_strike", weight:35, type:"good", title:"Miners' Strike",
        img:"evt-strike.jpg",
        body:"Striking miners pay anything for water and meds.",
        apply(g){ _disc(g, ["water","medicine"], 1.8);
                  return "Water & meds sell at 1.8× this visit."; } },
      { id:"asteroid", weight:30, type:"bad", title:"Asteroid Strike",
        img:"evt-asteroid.jpg",
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
        img:"evt-auction.jpg",
        body:"A masked auctioneer dumps a hot lot at cut-rate prices.",
        apply(g){ _disc(g, ["art","holo"], 0.65);
                  return "Artifacts & holo-crystals 35% off this visit."; } },
      { id:"fixer_fee", weight:30, type:"warn", title:"Fixer Fee",
        img:"evt-fixer.jpg",
        body:"A local fixer offers to 'expedite' your dock-side paperwork.",
        apply(g){ return `Fixer took ${fmt(_pay(g, 200, 500))} ¢.`; } },
      { id:"insider", weight:30, type:"good", title:"Insider Whisper",
        img:"evt-insider.jpg",
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
        img:"evt-smuggler.jpg",
        body:"A smuggler unloads inventory before the heat arrives.",
        apply(g){ _disc(g, ["spice","weapons"], 0.5);
                  return "Contraband half price this visit."; } },
      { id:"cartel", weight:30, type:"bad", title:"Cartel Shakedown",
        img:"evt-cartel.jpg",
        body:"Cartel toughs want a 'docking tribute.'",
        apply(g){ return `Tribute cost ${fmt(_pay(g, 200, 600))} ¢.`; } },
      { id:"pirate_buyer", weight:35, type:"good", title:"Pirate Buyer",
        img:"evt-pirate-buy.jpg",
        body:"A pirate captain pays premium for fuel and solar arrays.",
        apply(g){ _disc(g, ["fuel","solar"], 1.7);
                  return "Fuel & solar sell at 1.7× this visit."; } },
    ],

    obsid: [
      { id:"patron", weight:35, type:"good", title:"Aristocrat Patron",
        img:"evt-patron.jpg",
        body:"An old-house patron commissions exotica at any price.",
        apply(g){ _disc(g, ["art","holo"], 1.8);
                  return "Art & holo-crystals 1.8× this visit."; } },
      { id:"duel", weight:30, type:"bad", title:"Duel Insult",
        img:"evt-duel.jpg",
        body:"You bumped the wrong shoulder. Honor demands payment.",
        apply(g){ return `Honor settled with ${fmt(_pay(g, 200, 500))} ¢.`; } },
      { id:"masquerade", weight:35, type:"good", title:"Masquerade Ball",
        img:"evt-masquerade.jpg",
        body:"The night's masquerade drives luxury prices skyward.",
        apply(g){ _disc(g, ["art","lace","holo"], 1.5);
                  return "Luxury goods sell at 1.5× this visit."; } },
    ],

    halc: [
      { id:"derelict_auction", weight:40, type:"good", title:"Derelict Auction",
        img:"evt-derelict.jpg",
        body:"Salvagers strip a fresh wreck and dump fuel cells & plastics.",
        apply(g){ _disc(g, ["fuel","plastics"], 0.5);
                  return "Fuel & plastics half price this visit."; } },
      { id:"stowaway", weight:30, type:"warn", title:"Stowaway",
        img:"evt-stowaway.jpg",
        body:"A drifter is found in your cargo bay.",
        apply(g){ return `Paid ${fmt(_pay(g, 100, 300))} ¢ to dispatch them quietly.`; } },
      { id:"lucky_salvage", weight:30, type:"good", title:"Lucky Salvage",
        img:"evt-salvage-local.jpg",
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
        img:"evt-foundry.jpg",
        body:"Overproduction floods the market with robots and prosthetics.",
        apply(g){ _disc(g, ["robots","cyber"], 0.6);
                  return "Robots & cybernetics 40% off this visit."; } },
      { id:"heat_surcharge", weight:30, type:"warn", title:"Heat Surcharge",
        img:"evt-heat.jpg",
        body:"Cooling fees are levied on every visiting hull.",
        apply(g){ return `Heat surcharge ${fmt(_pay(g, 150, 400))} ¢.`; } },
      { id:"worker_crisis", weight:35, type:"good", title:"Worker Crisis",
        img:"evt-workers.jpg",
        body:"A foundry accident has clinics scrambling for replacement organs.",
        apply(g){ _disc(g, ["organs"], 1.8);
                  return "Bio-organs sell at 1.8× this visit."; } },
    ],

    erebus: [
      { id:"algae_bloom", weight:35, type:"good", title:"Algae Bloom",
        img:"evt-bloom.jpg",
        body:"A massive bloom dumps algae paste at giveaway prices.",
        apply(g){ _disc(g, ["algae"], 0.4);
                  return "Algae paste 60% off this visit."; } },
      { id:"reef_storm", weight:30, type:"warn", title:"Reef Storm",
        img:"evt-storm.jpg",
        body:"A storm forces docking surcharges across the floating quays.",
        apply(g){ return `Storm fee ${fmt(_pay(g, 100, 300))} ¢.`; } },
      { id:"deep_find", weight:35, type:"good", title:"Deep Find",
        img:"evt-deepfind.jpg",
        body:"Fishermen hauled up something the deep didn't want kept.",
        apply(g){ _disc(g, ["art"], 0.5);
                  return "Alien artifacts 50% off this visit."; } },
    ],

    pavon: [
      { id:"baron_party", weight:35, type:"good", title:"Baron's Party",
        img:"evt-baron.jpg",
        body:"A helium baron throws a soirée demanding fine wood and fabric.",
        apply(g){ _disc(g, ["textiles","lumber"], 1.7);
                  return "Textiles & lumber sell at 1.7× this visit."; } },
      { id:"sky_casino", weight:30, type:"warn", title:"Sky-Casino",
        img:"evt-casino.jpg",
        body:"You can't help yourself at the cloud-deck tables.",
        apply(g){
          const win = Math.random() < 0.5;
          const amt = 300 + Math.floor(Math.random()*700);
          if (win) { g.cash += amt; return `Won ${fmt(amt)} ¢ at the tables.`; }
          g.cash = Math.max(0, g.cash - amt);
          return `Lost ${fmt(amt)} ¢ at the tables.`;
        } },
      { id:"patron_commission", weight:35, type:"good", title:"Patron's Commission",
        img:"evt-commission.jpg",
        body:"A baron's house broker offers antimatter at family rates.",
        apply(g){ _disc(g, ["antim"], 0.75);
                  return "Antimatter 25% off this visit."; } },
    ],

    solen: [
      { id:"blessing", weight:30, type:"good", title:"Pilgrim's Blessing",
        img:"evt-blessing.jpg",
        body:"A grateful pilgrim presses coin into your palm.",
        apply(g){ return `Blessing brought ${fmt(_earn(g, 200, 500))} ¢.`; } },
      { id:"forbidden_vault", weight:35, type:"good", title:"Forbidden Vault",
        img:"evt-vault.jpg",
        body:"A novitiate quietly opens the crystal vault for visitors.",
        apply(g){ _disc(g, ["holo"], 0.6);
                  return "Holo-crystals 40% off this visit."; } },
      { id:"confession", weight:35, type:"warn", title:"Confession Tithe",
        img:"evt-confession.jpg",
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
        img:"evt-clinic.jpg",
        body:"A backstreet clinic sells implants below the listed price.",
        apply(g){ _disc(g, ["organs","cyber","lace"], 0.5);
                  return "Implants & lace 50% off this visit."; } },
      { id:"gang_toll", weight:35, type:"bad", title:"Gang Toll",
        img:"evt-gang.jpg",
        body:"A neon-painted gang demands a transit toll.",
        apply(g){ return `Toll cost ${fmt(_pay(g, 200, 500))} ¢.`; } },
      { id:"data_broker", weight:30, type:"good", title:"Data Broker",
        img:"evt-broker.jpg",
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
        img:"evt-digfind.jpg",
        body:"Diggers haul up a fresh cache; the rangers haven't catalogued it yet.",
        apply(g){ _disc(g, ["art"], 0.5);
                  return "Alien artifacts 50% off this visit."; } },
      { id:"ruins_sing", weight:30, type:"warn", title:"The Ruins Sing",
        img:"evt-ruins.jpg",
        body:"A low harmonic crawls through the dig at dusk. Nobody sleeps.",
        apply(g){
          const good = GOODS[Math.floor(Math.random()*GOODS.length)];
          g.tickerQueue.push(`RUMOR: Yoxai harmonics correlate with ${good.name} markets.`);
          const c = 50 + Math.floor(Math.random()*200);
          g.cash += c;
          return `Strange whisper. ${fmt(c)} ¢ found in your pocket. New rumor recorded.`;
        } },
      { id:"archaeologist", weight:35, type:"good", title:"Archaeologist's Hire",
        img:"evt-archaeo.jpg",
        body:"An archaeologist needs samples ferried back to a research lab.",
        apply(g){ return `Hired courier work paid ${fmt(_earn(g, 800, 2000))} ¢.`; } },
    ],

  };

  // attach localEvents arrays to each location object
  LOCATIONS.forEach(loc => { loc.localEvents = LOCAL_EVENTS[loc.id] || []; });

  // =====================================================================
  // ship sprite sheet config single consolidated atlas
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
  // planet sprite sheet config — single consolidated atlas
  //   frame coords mirror /assets/sprites/planets.json
  //   keys are referenced by LOCATIONS[].planetSprite
  // =====================================================================
  const PLANET_SPRITES = {
    src:    'assets/sprites/planets.png',
    sheetW: 4325, sheetH: 3380,
    frames: {
      "obsidian-spire":  { x:    1, y:    1, w: 1080, h: 1074 },
      "pavonis-clouds":  { x: 1082, y:    1, w: 1080, h: 1031 },
      "solenne-gardens": { x: 2163, y:    1, w: 1080, h: 1116 },
      "terra-prime":     { x: 3244, y:    1, w: 1080, h: 1061 },
      "threnody-stack":  { x:    1, y: 1118, w: 1080, h: 1146 },
      "vroom-outpost":   { x: 1082, y: 1118, w: 1080, h: 1059 },
      "yoxai-jungle":    { x: 2163, y: 1118, w: 1080, h: 1075 },
      "bubble-erebus":   { x: 3244, y: 1118, w: 1080,  h: 994 },
      "caldera-9":       { x:    1, y: 2265, w: 1080, h: 1063 },
      "halcyon-junk":    { x: 1082, y: 2265, w: 1080, h: 1016 },
      "kallis-rock":     { x: 2163, y: 2265, w: 1080, h: 1046 },
      "ledger-hub":      { x: 3244, y: 2265, w: 1080, h: 1114 },
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
    flavor: 'High-altitude thrill-seekers who trade in helium and ego. Their net worth swings wildly based on how many ‘Sky-Parties’ they throw. One day they’re kings, the next they’re selling their shoes for fuel.'
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
  // ship fuel  per-location base price and travel-cost helpers
  //   travelFuel returns units consumed per jump (after shipFuelMod);
  //   fuelBasePrice gives the location's posted price per unit.
  // =====================================================================
  const FUEL_PRICES = {
    pavon:  6,  
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
    SHIPS, SHIP_SPRITES, PLANET_SPRITES, COMPETITORS, FUEL_PRICES,
    goodName, locById, fmt, distance,
    travelCost, travelDays, travelFuel, fuelBasePrice,
  };
})();
