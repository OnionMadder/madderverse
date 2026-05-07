/* =====================================================================
 * ui.js — DOM rendering + input wiring
 * ===================================================================== */

(() => {
  const {
    GOODS, LOCATIONS, fmt, travelDays, travelFuel, fuelBasePrice, locById,
    SHIP_SPRITES,
  } = GAME_DATA;
  const $ = sel => document.querySelector(sel);

  // ---------- sprite atlas helper ----------
  // size the box, then render the sprite into an inner div sized to the
  // scaled-frame dimensions exactly. centering the inner div in the box
  // means adjacent frames in the sheet can't bleed into the empty padding.
  function applySprite(boxEl, spriteKey, boxW, boxH) {
    boxEl.style.cssText = `width:${boxW}px;height:${boxH}px;display:flex;align-items:center;justify-content:center;`;
    let inner = boxEl.querySelector(':scope > .sprite-frame');
    if (!inner) {
      inner = document.createElement('div');
      inner.className = 'sprite-frame';
      boxEl.appendChild(inner);
    }
    const f = SHIP_SPRITES.frames[spriteKey];
    if (!f) {
      inner.style.cssText = `width:${boxW}px;height:${boxH}px;background:#000;`;
      return;
    }
    const scale = Math.min(boxW / f.w, boxH / f.h);
    const dw = f.w * scale;
    const dh = f.h * scale;
    const sw = SHIP_SPRITES.sheetW * scale;
    const sh = SHIP_SPRITES.sheetH * scale;
    inner.style.cssText = `
      width:${dw}px; height:${dh}px;
      background-image:url('${SHIP_SPRITES.src}');
      background-size:${sw}px ${sh}px;
      background-position:${-f.x * scale}px ${-f.y * scale}px;
      background-repeat:no-repeat;
    `;
  }

  // ---------- audio ----------
  function sfx(id) {
    const el = document.getElementById("sfx-" + id);
    if (!el) return;
    try { el.currentTime = 0; el.play().catch(()=>{}); } catch(_){}
  }

  // ship-ambient: per-ship audio that loops while a card is selected.
  // Plays the audio with id `sfx-ship-<id>`. Missing files fail silently.
  let activeShipAmbient = null;
  function stopShipAmbient() {
    if (activeShipAmbient) {
      try { activeShipAmbient.pause(); activeShipAmbient.currentTime = 0; } catch(_){}
      activeShipAmbient = null;
    }
  }
  function playShipAmbient(shipId) {
    stopShipAmbient();
    const el = document.getElementById("sfx-ship-" + shipId);
    if (!el) return;
    try { el.currentTime = 0; el.loop = true; el.play().catch(()=>{}); activeShipAmbient = el; } catch(_){}
  }

  // ---------- splash ----------
  let pendingCompany = "ACME TRADING CO.";
  $("#btn-new").addEventListener("click", () => {
    sfx("click");
    const inputEl = $("#company-name");
    pendingCompany = (inputEl.value || "").trim() || "ACME TRADING CO.";
    $("#splash").classList.add("hidden");
    $("#mode-select").classList.remove("hidden");
  });

  // ---------- mode select ----------
  let pendingMode = "intermediate";
  let selectedShip = null;

  document.querySelectorAll(".ms-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      sfx("click");
      pendingMode = btn.dataset.mode;
      $("#mode-select").classList.add("hidden");
      buildShipGrid();
      $("#ship-select").classList.remove("hidden");
    });
  });

  // ---------- ship select ----------
  function modeCash() {
    const m = Game.MODES[pendingMode];
    return (m && m.startCash != null) ? m.startCash : 5000;
  }

  function buildShipGrid() {
    const { SHIPS } = GAME_DATA;
    const grid = $("#ship-grid");
    grid.innerHTML = "";
    selectedShip = null;
    $("#ss-empty").classList.remove("hidden");
    $("#ss-detail").classList.add("hidden");

    const budget = modeCash();
    const THUMB = 80;

    SHIPS.forEach(ship => {
      const affordable = ship.cost <= budget;

      const card = document.createElement("div");
      card.className = "ss-card" + (affordable ? "" : " ss-cant-afford");
      card.dataset.shipId = ship.id;

      const thumb = document.createElement("div");
      thumb.className = "ss-thumb";
      applySprite(thumb, ship.sprite, THUMB, THUMB);

      const label = document.createElement("div");
      label.className = "ss-card-name";
      label.textContent = ship.name;

      const costEl = document.createElement("div");
      costEl.className = affordable ? "ss-card-cost" : "ss-card-cost-no";
      costEl.textContent = ship.cost === 0 ? "FREE" : fmt(ship.cost) + " ¢";

      card.append(thumb, label, costEl);

      if (affordable) {
        card.addEventListener("click", () => {
          sfx("ship");
          document.querySelectorAll(".ss-card").forEach(c => c.classList.remove("ss-selected"));
          card.classList.add("ss-selected");
          selectedShip = ship;
          showShipDetail(ship);
          playShipAmbient(ship.id);
        });
      }

      grid.appendChild(card);
    });
  }

  function showShipDetail(ship) {
    const budget = modeCash();

    // detail sprite — large preview pane (square crop, multiple-angle popup TBD)
    const PREVIEW = 192;
    const sprite = $("#ss-sprite");
    applySprite(sprite, ship.sprite, PREVIEW, PREVIEW);

    $("#ss-ship-name").textContent  = ship.name;
    $("#ss-ship-flavor").textContent = "“" + ship.flavor + "”";
    $("#ss-ship-desc").textContent  = ship.desc;

    const speedPct = Math.round(Math.abs(1 - ship.speedMod) * 100);
    const fuelPct  = Math.round(Math.abs(1 - ship.fuelMod)  * 100);
    const rows = [
      ["Cargo hold",   ship.cap + " tons"],
      ["Fuel tank",    (ship.fuelCap || 100) + " u"],
      ["Travel speed", ship.speedMod < 1 ? speedPct + "% faster"
                     : ship.speedMod > 1 ? speedPct + "% slower" : "Standard"],
      ["Fuel use",     ship.fuelMod  < 1 ? fuelPct  + "% lower"
                     : ship.fuelMod  > 1 ? fuelPct  + "% higher" : "Standard"],
      ...(ship.interestMod    ? [["Interest",  "−" + Math.round((1 - ship.interestMod) * 100) + "%"]] : []),
      ...(ship.contrabandShield ? [["Special", "Customs shielding"]]          : []),
      ...(ship.betterEvents    ? [["Special", "Favorable event bias"]]        : []),
    ];
    $("#ss-stats").innerHTML = rows.map(([k, v]) =>
      `<tr><td class="ss-stat-key">${k}</td><td class="ss-stat-val">${v}</td></tr>`
    ).join("");

    // affordability line
    const remaining = budget - ship.cost;
    const canAfford = remaining >= 0;
    if (ship.cost === 0) {
      $("#ss-cost-line").innerHTML =
        `<span class="ss-cost-free">FREE</span> &nbsp;·&nbsp; ` +
        `Remaining: <span class="ss-remain-ok">${fmt(budget)} ¢</span>`;
    } else {
      $("#ss-cost-line").innerHTML =
        `Cost: <span class="ss-cost-${canAfford ? "ok" : "bad"}">${fmt(ship.cost)} ¢</span>` +
        ` &nbsp;·&nbsp; Remaining: <span class="ss-remain-${canAfford ? "ok" : "bad"}">` +
        (canAfford ? fmt(remaining) + " ¢" : "INSUFFICIENT") + `</span>`;
    }

    const buyBtn = $("#ss-btn-buy");
    buyBtn.disabled   = !canAfford;
    buyBtn.textContent = canAfford ? "Purchase →" : "Insufficient Funds";

    $("#ss-empty").classList.add("hidden");
    $("#ss-detail").classList.remove("hidden");
  }

  $("#ss-btn-back").addEventListener("click", () => {
    sfx("click");
    stopShipAmbient();
    selectedShip = null;
    $("#ship-select").classList.add("hidden");
    $("#mode-select").classList.remove("hidden");
  });

  $("#ss-btn-buy").addEventListener("click", () => {
    if (!selectedShip) return;
    sfx("click");
    stopShipAmbient();
    Game.newGame(pendingMode, selectedShip.id, pendingCompany);
    $("#ship-select").classList.add("hidden");
    $("#game").classList.remove("hidden");
    renderAll();
  });

  // ---------- render ----------
  function renderAll() {
    renderHud();
    renderLocationCard();
    renderMarket();
    renderTravel();
    renderShipPanel();
    renderFuelPanel();
    renderLeaderboard();
    renderLog();
    renderTicker();
  }

  function renderLocationCard() {
    const loc = locById(Game.state.location);
    const el = document.getElementById("location-card");
    if (!el) return;
    el.innerHTML = `
      <div class="loc-card-head">
        <img class="loc-card-icon" src="assets/images/${loc.icon}" alt=""
             onerror="this.style.visibility='hidden'"/>
        <div>
          <div class="loc-card-name">${loc.name}</div>
          <div class="loc-card-tag">${loc.tagline || ""}</div>
        </div>
      </div>
      <div class="loc-card-trade">
        <div><span class="trade-label">Abundant:</span> ${loc.produces.map(g => GAME_DATA.goodName(g)).join(", ")}</div>
        <div><span class="trade-label">Wanted:</span> ${loc.demands.map(g => GAME_DATA.goodName(g)).join(", ")}</div>
      </div>
    `;
  }

  function renderHud() {
    const s = Game.state;
    $("#hud-company").textContent  = s.company || "ACME TRADING CO.";
    $("#hud-day").textContent      = s.day;
    $("#hud-max-days").textContent = s.maxDays;
    $("#hud-cash").textContent     = fmt(s.cash);
    $("#hud-debt").textContent     = fmt(s.debt);
    $("#hud-net").textContent      = fmt(Game.netWorth());
    $("#hud-hold").textContent     = Game.holdUsed();
    $("#hud-cap").textContent      = s.cap;
    $("#hud-fuel").textContent     = s.fuel;
    $("#hud-fuelcap").textContent  = s.fuelCap;
    $("#hud-location").textContent = locById(s.location).name;
    $("#hud-goal").textContent     = fmt(s.goal);

    setFuelFill($("#hud-fuel-fill"), s.fuel, s.fuelCap);
  }

  function setFuelFill(el, fuel, cap) {
    if (!el) return;
    const pct = Math.max(0, Math.min(100, Math.round((fuel / cap) * 100)));
    el.style.width = pct + "%";
    el.classList.remove("fuel-low", "fuel-crit");
    if (pct < 15) el.classList.add("fuel-crit");
    else if (pct < 35) el.classList.add("fuel-low");
  }

  function trendArrow(goodId, locId) {
    // compare current price vs base — visual hint only
    const good = GOODS.find(g => g.id === goodId);
    const cur  = Game.priceOf(goodId, locId);
    const ratio = cur / good.basePrice;
    if (ratio > 1.15) return { cls: "trend-up",   txt: "▲" };
    if (ratio < 0.85) return { cls: "trend-down", txt: "▼" };
    return { cls: "trend-flat", txt: "■" };
  }

  function renderMarket() {
    const s = Game.state;
    $("#market-loc").textContent = "@ " + locById(s.location).name;
    const body = $("#market-body");
    body.innerHTML = "";
    GOODS.forEach(good => {
      const price = Game.priceOf(good.id);
      const have  = s.cargo[good.id] || 0;
      const avg   = s.avgCost[good.id] || 0;
      const trend = trendArrow(good.id, s.location);

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>
          <img class="good-icon" src="assets/images/${good.icon}" alt=""
               onerror="this.style.visibility='hidden'"/>
          ${good.name}${good.legal ? "" : ' <span class="trend-down" title="contraband">⚠</span>'}
        </td>
        <td class="num">${fmt(price)} ¢</td>
        <td class="num ${trend.cls}">${trend.txt}</td>
        <td class="num">${have}</td>
        <td class="num">${have ? fmt(avg) + " ¢" : "—"}</td>
        <td class="qty-cell">
          <input type="number" min="1" value="1" data-good="${good.id}" />
          <button data-act="buy"  data-good="${good.id}">Buy</button>
          <button data-act="sell" data-good="${good.id}">Sell</button>
        </td>
      `;
      body.appendChild(tr);
    });

    body.onclick = (e) => {
      const btn = e.target.closest("button[data-act]");
      if (!btn) return;
      const goodId = btn.dataset.good;
      const input = body.querySelector(`input[data-good="${goodId}"]`);
      const qty = parseInt(input.value, 10) || 0;
      const r = btn.dataset.act === "buy" ? Game.buy(goodId, qty) : Game.sell(goodId, qty);
      if (r.ok) sfx(btn.dataset.act);
      else flash(r.msg);
      renderAll();
    };
  }

  function renderTravel() {
    const s = Game.state;
    const ul = $("#travel-list");
    ul.innerHTML = "";
    LOCATIONS.forEach(loc => {
      const here = loc.id === s.location;
      const fuel = here ? 0 : travelFuel(s.location, loc.id, Game.CONFIG.shipFuelMod);
      const days = here ? 0 : Math.max(1, Math.round(travelDays(s.location, loc.id) * Game.CONFIG.shipSpeedMod));
      const lowFuel = !here && fuel > s.fuel;
      const li = document.createElement("li");
      if (here) li.classList.add("current");
      li.innerHTML = `
        <span class="travel-name">
          <img class="loc-icon" src="assets/images/${loc.icon}" alt=""
               onerror="this.style.visibility='hidden'"/>
          ${loc.name}
        </span>
        ${
          here
            ? '<span style="color:var(--ink-dim)">— here —</span>'
            : `<span>
                 <span style="color:${lowFuel ? "var(--pink)" : "var(--ink-dim)"};margin-right:8px"
                       title="${days}d at ${fuel}u fuel">${days}d / ${fuel}u</span>
                 <button class="win95-btn" data-go="${loc.id}">Go</button>
               </span>`
        }
      `;
      ul.appendChild(li);
    });

    ul.onclick = (e) => {
      const btn = e.target.closest("button[data-go]");
      if (!btn) return;
      const r = Game.travel(btn.dataset.go);
      if (!r.ok) { flash(r.msg); return; }
      sfx("travel");
      renderAll();

      // chain modals: lore (first visit) -> local event -> global event -> game-over
      const queue = [];
      if (r.firstVisit) queue.push(() => showLore(r.dest));
      if (r.localEvent) queue.push(() => showEvent(r.localEvent));
      if (r.event)      queue.push(() => showEvent(r.event));
      runModalQueue(queue, () => { renderAll(); checkGameOver(); });
    };
  }

  function runModalQueue(queue, done) {
    if (!queue.length) { if (done) done(); return; }
    const next = queue.shift();
    next();
    // patch the modal Continue button to advance the queue
    const wrap = $("#modal-actions");
    const btn = wrap.querySelector("button");
    if (!btn) { runModalQueue(queue, done); return; }
    const orig = btn.onclick;
    btn.onclick = () => {
      orig && orig();
      runModalQueue(queue, done);
    };
  }

  function showLore(loc) {
    sfx("event");
    showModal({
      title: loc.name,
      body:  loc.lore || loc.tagline || "",
      img:   "assets/images/" + (loc.icon || ""),
      actions: [{ label: "Dock", run: hideModal }],
    });
  }

  function renderShipPanel() {
    const s = Game.state;
    $("#ship-hold").textContent = Game.holdUsed();
    $("#ship-cap").textContent  = s.cap;
    $("#bank-rate").textContent = Math.round(Game.CONFIG.interestRate * 100);
    $("#bank-max").textContent  = fmt(Game.CONFIG.maxLoan);
  }

  function renderFuelPanel() {
    const s = Game.state;
    $("#ship-fuel").textContent    = s.fuel;
    $("#ship-fuelcap").textContent = s.fuelCap;
    $("#fuel-price").textContent   = Game.fuelPriceHere();
    setFuelFill($("#ship-fuel-fill"), s.fuel, s.fuelCap);
  }

  function renderLeaderboard() {
    const s = Game.state;
    if (!s.competitors) return;
    const ol = $("#leaderboard");
    if (!ol) return;
    const me = { id: "__self", name: s.company || "YOU", netWorth: Game.netWorth(), self: true };
    const ranked = [...s.competitors, me].sort((a, b) => b.netWorth - a.netWorth);
    ol.innerHTML = "";
    ranked.forEach((c, i) => {
      const li = document.createElement("li");
      if (c.self) li.classList.add("lb-self");
      li.innerHTML = `
        <span class="lb-rank">${i + 1}.</span>
        <span class="lb-name" title="${c.motto || ""}">${c.name}</span>
        <span class="lb-net">${fmt(c.netWorth)} ¢</span>
      `;
      ol.appendChild(li);
    });
  }

  function renderLog() {
    const ul = $("#log");
    ul.innerHTML = "";
    Game.state.log.slice(-50).reverse().forEach(entry => {
      const li = document.createElement("li");
      const cls = entry.kind ? `log-${entry.kind}` : "";
      li.className = cls;
      li.innerHTML = `<span class="log-time">D${entry.day}</span>${entry.msg}`;
      ul.appendChild(li);
    });
  }

  let tickerTimer;
  function renderTicker() {
    const s = Game.state;
    const items = [...s.tickerQueue];
    if (!items.length) items.push("Trade lanes are quiet.");
    $("#ticker-inner").textContent = "  •  " + items.join("    •    ") + "    •  ";
    // rotate periodically by trimming the queue if it grows
    if (s.tickerQueue.length > 8) s.tickerQueue.splice(0, s.tickerQueue.length - 8);
  }

  // ---------- bank ----------
  $("#btn-borrow").addEventListener("click", () => {
    const amt = parseInt($("#bank-amount").value, 10) || 0;
    const r = Game.borrow(amt);
    if (!r.ok) flash(r.msg); else sfx("good");
    renderAll();
  });
  $("#btn-repay").addEventListener("click", () => {
    const amt = parseInt($("#bank-amount").value, 10) || 0;
    const r = Game.repay(amt);
    if (!r.ok) flash(r.msg); else sfx("good");
    renderAll();
  });

  // ---------- fuel ----------
  $("#btn-fuel-buy").addEventListener("click", () => {
    const amt = parseInt($("#fuel-amount").value, 10) || 0;
    const r = Game.buyFuel(amt);
    if (!r.ok) flash(r.msg); else sfx("good");
    renderAll();
  });
  $("#btn-fuel-fill").addEventListener("click", () => {
    const room = Game.fuelMaxBuy();
    if (room <= 0) { flash("Tank is full."); return; }
    const price = Game.fuelPriceHere();
    const affordable = Math.min(room, Math.floor(Game.state.cash / price));
    if (affordable <= 0) { flash("Not enough cash for any fuel."); return; }
    const r = Game.buyFuel(affordable);
    if (!r.ok) flash(r.msg); else sfx("good");
    renderAll();
  });

  $("#btn-end-day").addEventListener("click", () => {
    Game.waitOneDay();
    sfx("click");
    renderAll();
    checkGameOver();
  });

  // ---------- modal ----------
  function showEvent(evt) {
    sfx(evt.type === "good" ? "good" : (evt.type === "bad" ? "bad" : "event"));
    showModal({
      title: evt.title,
      body:  evt.resolvedMsg || evt.body,
      img:   "assets/events/" + (evt.img || ""),
      actions: [{ label: "Continue", run: hideModal }],
    });
  }

  function showModal({ title, body, img, actions }) {
    $("#modal-title").textContent = title;
    $("#modal-body").textContent  = body;
    const imgEl = $("#modal-img");
    imgEl.src = img || "";
    imgEl.style.display = img ? "" : "none";
    const wrap = $("#modal-actions");
    wrap.innerHTML = "";
    (actions || [{ label: "OK", run: hideModal }]).forEach(a => {
      const b = document.createElement("button");
      b.textContent = a.label;
      b.onclick = () => { a.run(); };
      wrap.appendChild(b);
    });
    $("#modal").classList.remove("hidden");
  }
  function hideModal() { $("#modal").classList.add("hidden"); }

  // ---------- end-of-game ----------
  function checkGameOver() {
    if (!Game.state.gameOver) return;
    const s = Game.state;
    showModal({
      title: s.win ? "You Win!" : "Game Over",
      body: s.win
        ? `Net worth: ${fmt(Game.netWorth())} ¢ in ${s.day - 1} days. You're a GazOnionaire!`
        : `Net worth: ${fmt(Game.netWorth())} ¢. The void claims another trader.`,
      img: "assets/images/" + (s.win ? "win.png" : "lose.png"),
      actions: [{
        label: "New Game",
        run: () => {
          hideModal();
          $("#game").classList.add("hidden");
          $("#mode-select").classList.remove("hidden");
        }
      }],
    });
  }

  // ---------- transient toast ----------
  let flashTimer;
  function flash(msg) {
    let el = document.getElementById("flash");
    if (!el) {
      el = document.createElement("div");
      el.id = "flash";
      el.style.cssText = `
        position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%);
        background: #2a1010; border: 1px solid #ff6a6a; color: #ffdada;
        padding: 8px 14px; z-index: 200; font-family: var(--mono);
        box-shadow: 0 2px 0 #000a;
      `;
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.style.display = "";
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => { el.style.display = "none"; }, 1800);
  }

})();
