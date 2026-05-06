/* =====================================================================
 * ui.js — DOM rendering + input wiring
 * ===================================================================== */

(() => {
  const { GOODS, LOCATIONS, fmt, travelCost, travelDays, locById } = GAME_DATA;
  const $ = sel => document.querySelector(sel);

  // ---------- audio ----------
  function sfx(id) {
    const el = document.getElementById("sfx-" + id);
    if (!el) return;
    try { el.currentTime = 0; el.play().catch(()=>{}); } catch(_){}
  }

  // ---------- splash ----------
  $("#btn-new").addEventListener("click", () => {
    sfx("click");
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
    const { SHIPS, SHIP_SHEET } = GAME_DATA;
    const grid = $("#ship-grid");
    grid.innerHTML = "";
    selectedShip = null;
    $("#ss-empty").classList.remove("hidden");
    $("#ss-detail").classList.add("hidden");

    const budget = modeCash();
    const tw = SHIP_SHEET.tileW, th = SHIP_SHEET.tileH;
    const sheetW = SHIP_SHEET.cols * tw;

    SHIPS.forEach(ship => {
      const affordable = ship.cost <= budget;

      const card = document.createElement("div");
      card.className = "ss-card" + (affordable ? "" : " ss-cant-afford");
      card.dataset.shipId = ship.id;

      const thumb = document.createElement("div");
      thumb.className = "ss-thumb";
      thumb.style.cssText = `
        background-image:url('${SHIP_SHEET.src}');
        background-size:${sheetW}px auto;
        background-position:${-ship.col * tw}px ${-ship.row * th}px;
        background-repeat:no-repeat;
      `;

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
        });
      }

      grid.appendChild(card);
    });
  }

  function showShipDetail(ship) {
    const { SHIP_SHEET } = GAME_DATA;
    const budget = modeCash();

    // sprite — 2× size for preview
    const tw = SHIP_SHEET.tileW * 2, th = SHIP_SHEET.tileH * 2;
    const sprite = $("#ss-sprite");
    sprite.style.cssText = `
      width:${tw}px; height:${th}px;
      background-image:url('${SHIP_SHEET.src}');
      background-size:${SHIP_SHEET.cols * tw}px auto;
      background-position:${-ship.col * tw}px ${-ship.row * th}px;
      background-repeat:no-repeat;
      image-rendering:pixelated;
      background-color:var(--panel-2);
      border:1px solid var(--border);
      flex-shrink:0;
    `;

    $("#ss-ship-name").textContent  = ship.name;
    $("#ss-ship-flavor").textContent = "“" + ship.flavor + "”";
    $("#ss-ship-desc").textContent  = ship.desc;

    const speedPct = Math.round(Math.abs(1 - ship.speedMod) * 100);
    const fuelPct  = Math.round(Math.abs(1 - ship.fuelMod)  * 100);
    const rows = [
      ["Cargo hold",   ship.cap + " tons"],
      ["Travel speed", ship.speedMod < 1 ? speedPct + "% faster"
                     : ship.speedMod > 1 ? speedPct + "% slower" : "Standard"],
      ["Fuel cost",    ship.fuelMod  < 1 ? fuelPct  + "% cheaper"
                     : ship.fuelMod  > 1 ? fuelPct  + "% more"   : "Standard"],
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
    selectedShip = null;
    $("#ship-select").classList.add("hidden");
    $("#mode-select").classList.remove("hidden");
  });

  $("#ss-btn-buy").addEventListener("click", () => {
    if (!selectedShip) return;
    sfx("click");
    Game.newGame(pendingMode, selectedShip.id);
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
    $("#hud-day").textContent = s.day;
    $("#hud-max-days").textContent = s.maxDays;
    $("#hud-cash").textContent = fmt(s.cash);
    $("#hud-debt").textContent = fmt(s.debt);
    $("#hud-net").textContent  = fmt(Game.netWorth());
    $("#hud-hold").textContent = Game.holdUsed();
    $("#hud-cap").textContent  = s.cap;
    $("#hud-location").textContent = locById(s.location).name;
    $("#hud-goal").textContent = fmt(s.goal);
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
      const cost = here ? 0 : Math.round(travelCost(s.location, loc.id) * Game.CONFIG.shipFuelMod);
      const days = here ? 0 : Math.max(1, Math.round(travelDays(s.location, loc.id) * Game.CONFIG.shipSpeedMod));
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
                 <span style="color:var(--ink-dim);margin-right:8px">${days}d / ${fmt(cost)}¢</span>
                 <button data-go="${loc.id}">Go</button>
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
    $("#ship-fuel").textContent = s.fuel;
    $("#bank-rate").textContent = Math.round(Game.CONFIG.interestRate * 100);
    $("#bank-max").textContent  = fmt(Game.CONFIG.maxLoan);
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
      img:   "assets/images/" + (evt.img || ""),
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
        ? `Net worth: ${fmt(Game.netWorth())} ¢ in ${s.day - 1} days. You're a Gazonionaire.`
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
