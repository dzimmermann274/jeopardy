"use strict";
/* ============================================================
   Display screen (the TV). Pure renderer of state snapshots —
   it never mutates game state.
   ============================================================ */

function fsElement() {
  return document.fullscreenElement || document.webkitFullscreenElement || null;
}

/* The title/welcome screen markup — shared by the "welcome" view and by the
   "title" curtain (the fade-to-title failsafe), so both look identical. */
function welcomeHtml() {
  const title = (S.game && S.game.title) || "Jeopardy!";
  const subtitle = (S.game && S.game.subtitle) || "";
  const size = title.length > 24 ? "6vw" : title.length > 13 ? "9vw" : "13vw";
  return `<div class="disp-view disp-bluebg">
    ${subtitle ? `<div class="welcome-pretitle">${fmtText(subtitle.toUpperCase())}</div>` : ""}
    <div class="welcome-title" style="font-size:${size}">${fmtText(title.toUpperCase())}</div>
    <div class="welcome-sub">Get ready to play</div></div>`;
}

/* ---------------- the pre-game screens (rules / teams / who picks first) --------
   Each is a full-screen card the host raises from the control panel, drawn on the
   same curtain layer as the title screen (see renderCurtain). They read S and
   nothing else, so a team renamed on the control panel updates here immediately. */

/* The house rules, from cell D7 of the sheet's Game Setup tab. "##" separates
   them, exactly like every other multi-line cell in the workbook; each piece
   becomes a numbered rule (a single unbroken cell stays one paragraph). */
function rulesScreenHtml() {
  const raw = (S.game && S.game.rules) || "";
  const rules = raw.split("##").map(s => s.trim().replace(/^[-•*]\s*/, "")).filter(Boolean);
  // Shrink as the list grows so even a long set of rules fits on one screen
  // without scrolling — nobody can scroll a TV.
  const longest = rules.reduce((n, l) => Math.max(n, l.length), 0);
  const size = (rules.length > 7 || longest > 120) ? 1.9
             : (rules.length > 5 || longest > 80) ? 2.3 : 2.8;
  let body;
  if (!rules.length) {
    body = `<div class="screen-empty">No rules written yet — put them in cell <b>D7</b>
      of the ⚙️ Game Setup tab (use <b>##</b> to start a new rule).</div>`;
  } else if (rules.length === 1) {
    body = `<div class="rules-para">${esc(rules[0])}</div>`;
  } else {
    body = `<ol class="rules-list">${rules.map(r => `<li>${esc(r)}</li>`).join("")}</ol>`;
  }
  return `<div class="disp-view disp-bluebg rules-screen" style="--rule-size:${size}vw">
    <div class="screen-title">RULES</div>
    ${body}
  </div>`;
}

/* "Find your team and choose a team name!" — the groups, with a blank where the
   name will go. The sheet's team NUMBER is deliberately absent: it's an internal
   ID, and players find themselves by their own name in the list. Once the host
   types a name on the control panel it appears here, live. */
function teamsScreenHtml() {
  const teams = S.teams || [];
  if (!teams.length) {
    return `<div class="disp-view disp-bluebg teams-screen">
      <div class="screen-empty">No teams yet.</div></div>`;
  }
  const cards = teams.map(t => {
    const name = dispTeamName(t);
    const players = (t.players && t.players.length) ? t.players : [];
    return `<div class="tv-team${name ? " is-named" : ""}">
      <div class="tvt-name">${name ? esc(name) : `<span class="tvt-blank"></span>`}</div>
      <div class="tvt-players">${players.length
        ? players.map(p => `<span class="tvt-player">${esc(p)}</span>`).join("")
        : `<span class="tvt-player tvt-none">—</span>`}</div>
    </div>`;
  }).join("");
  // Up to 3 teams sit in one row; 4 make a tidy 2x2; 5-6 go 3 across.
  const n = teams.length;
  const cols = n <= 3 ? n : n === 4 ? 2 : 3;
  return `<div class="disp-view disp-bluebg teams-screen">
    <div class="teams-note">Find your team and choose a team name!</div>
    <div class="tv-teams" style="--cols:${cols}">${cards}</div>
  </div>`;
}

/* The shuffled rotation: who picks first, and the order it travels in after that. */
function picksScreenHtml() {
  const teams = S.teams || [];
  if (!pickOrderValid(S)) {
    return `<div class="disp-view disp-bluebg picks-screen">
      <div class="screen-title">WHO PICKS FIRST</div>
      <div class="screen-empty">Drawing the order…</div></div>`;
  }
  const order = S.pickOrder;
  const firstName = dispTeamName(teams[order[0]]);
  const rows = order.map((ti, k) => `<li class="pk-row" style="--k:${k}">
      <span class="pk-num">${k + 1}</span>
      <span class="pk-name">${esc(dispTeamName(teams[ti]) || "—")}</span>
    </li>`).join("");
  return `<div class="disp-view disp-bluebg picks-screen">
    <div class="screen-title">THE PICKING ORDER</div>
    <div class="picks-first">
      <div class="pf-name">${esc(firstName || "—")}</div>
      <div class="pf-tag">picks first!</div>
    </div>
    <ol class="picks-list">${rows}</ol>
    <div class="picks-foot">Then it goes round in this order — one pick each.</div>
  </div>`;
}

/* Remembers which revealed answer is currently on screen, so the "pop"
   animation plays once on reveal and then holds static across re-renders
   (e.g. when the host edits a score while the answer is up). */
let lastAnswerKey = null;
let winnerShown = false;   // same idea for the winner banner's pop

let wantFs = false;         // opened for a fullscreen deploy but not yet in fullscreen
let lastRenderedView = null; // the S.view we last rendered (to detect board -> clue)
let flying = false;          // a "tile flies to full screen" animation is in progress
let lastFinalReveal = 0;     // final-winner: places unveiled at the last render (animate only the newest)
let winnerHeroTimer = null;  // pending "hold in center, then drop to slot" release for the newest team
// Fitted clue/answer font sizes, keyed by the clue's visible content. A re-render
// that doesn't change the clue (e.g. starting the timer) reuses the size we
// already fitted, so the text renders pre-fitted instead of flashing large then
// shrinking once the picture loads. lastClueFitKey ties the current clue DOM to
// its cache entry so fitClue knows where to store the converged size.
let fitCache = {};
let lastClueFitKey = null;
/* Drop the fitted-size cache (its sizes are viewport-relative). Called on a real
   viewport change so the next render re-fits fresh. A function (not a bare
   assignment from main.js) keeps the write in display.js's own scope. */
function clearFitCache() { fitCache = {}; }

function renderDisplay() {
  // Clear any leftover fly background from a previous flight before we rebuild.
  const staleBg = document.getElementById("flyBoardBg");
  if (staleBg) staleBg.remove();
  // Any pending winner "hold, then drop" release is superseded by this re-render
  // (the card it targeted is about to be rebuilt); a fresh one is armed below.
  clearTimeout(winnerHeroTimer); winnerHeroTimer = null;

  // "Fly the tile to full screen": when a clue is picked from the board, capture
  // the tile's on-screen rect NOW (the board is still in the DOM) and keep the
  // board behind the incoming clue so it can grow out of the tile like real
  // Jeopardy. Only board -> clue/dd; anything else renders instantly as before.
  let flyFrom = null, flyBoardBg = null;
  if (lastRenderedView === "board" && (S.view === "clue" || S.view === "dd") && S.active) {
    const tile = document.querySelector(`.b-tile[data-cat="${S.active.cat}"][data-row="${S.active.row}"]`);
    const boardStage = document.querySelector(".disp-stage");   // the WHOLE board view (grid + scores strip)
    if (tile && boardStage) {
      const r0 = tile.getBoundingClientRect();
      if (r0.width > 0 && r0.height > 0) {
        flyFrom = { left: r0.left, top: r0.top, width: r0.width, height: r0.height };
        flyBoardBg = document.createElement("div");
        flyBoardBg.id = "flyBoardBg";
        flyBoardBg.appendChild(boardStage);     // move it out intact so the #app rebuild can't destroy it and it doesn't shift
        document.body.appendChild(flyBoardBg);
      }
    }
  }

  document.body.className = "display" + (fsElement() ? " is-fullscreen" : "") + (wantFs && !fsElement() ? " want-fs" : "");
  const r = currentRound();
  let view = "";

  // Animate the answer only when it FIRST appears for this clue.
  const answerKey = (S.view === "clue" && S.active && S.revealed) ? ("c" + S.active.cat + "," + S.active.row)
                  : (S.view === "final-clue" && S.finalRevealed) ? "final" : null;
  const animateAnswer = answerKey != null && answerKey !== lastAnswerKey;
  lastAnswerKey = answerKey;
  // Same first-appearance gating for the winner banner's pop.
  const animateWin = S.view === "winner" && !winnerShown;
  winnerShown = S.view === "winner";
  // True only on the first render of a newly-entered view, so the Final Jeopardy
  // entrance animations play once and then hold static across incidental
  // re-renders (e.g. a score edit) instead of replaying every time.
  const firstOfView = lastRenderedView !== S.view;
  // Places unveiled on the previous render of the standings — used so only the
  // just-revealed place animates in (older ones stay put).
  const prevFinalReveal = (lastRenderedView === "final-winner") ? lastFinalReveal : 0;

  if (S.phase === "setup" || !S.game || S.view === "welcome") {
    view = welcomeHtml();
  } else if (S.view === "bigscores") {
    view = `<div class="disp-view">
      <div class="brand" style="font-size:4vw;color:var(--value-gold);margin-bottom:3.5vh;text-shadow:.06em .06em 0 #000">CURRENT SCORES</div>
      <div class="bigscores">
        ${[...S.teams].sort((a, b) => b.score - a.score).map(t => `
          <div class="bigscore-pod score-pod">
            <div class="sp-name">${esc(dispTeamName(t) || "—")}</div>
            <div class="sp-score ${t.score < 0 ? "neg" : ""}">${money(t.score)}</div>
            ${t.players && t.players.length ? `<div class="sp-players">${esc(t.players.join(" · "))}</div>` : ""}
          </div>`).join("")}
      </div></div>`;
  } else if (S.view === "winner") {
    const sorted = [...S.teams].sort((a, b) => b.score - a.score);
    const champs = winnersOf(S.teams);
    const tie = champs.length > 1;
    const topScore = champs.length ? champs[0].score : 0;
    view = `<div class="disp-view winner-view">
      <div class="winner-banner ${animateWin ? "pop" : ""}">${tie ? "IT'S A TIE!" : "WINNER"}</div>
      <div class="winner-name">${champs.map(t => esc(dispTeamName(t) || "—")).join(" &nbsp;&amp;&nbsp; ")}</div>
      <div class="winner-score">${money(topScore)}</div>
      <div class="bigscores">
        ${sorted.map(t => `
          <div class="bigscore-pod score-pod ${t.score === topScore ? "is-winner" : ""}">
            <div class="sp-name">${esc(dispTeamName(t) || "—")}</div>
            <div class="sp-score ${t.score < 0 ? "neg" : ""}">${money(t.score)}</div>
            ${t.players && t.players.length ? `<div class="sp-players">${esc(t.players.join(" · "))}</div>` : ""}
          </div>`).join("")}
      </div></div>`;
  } else if (S.view === "dd") {
    view = `<div class="clue-full"><div class="clue-inner"><div class="dd-splash">DAILY<br>DOUBLE!</div></div></div>`;
  } else if (S.view === "final-intro") {
    // Two-card handoff: on first entry a big "FINAL JEOPARDY!" card flies in
    // from nothing, holds, then flies off — revealing the instructions card
    // underneath. On any later re-render only the settled instructions card shows.
    const instr = (S.game.final && S.game.final.instructions) || "";
    view = `<div class="clue-full fj-screen fj-intro"><div class="fj-rays"></div>
      <div class="fj-content">
        <div class="fj-intro-card${firstOfView ? " anim-cardin" : ""}">
          <div class="fj-intro-header">FINAL JEOPARDY</div>
          ${instr
            ? `<div class="fj-instructions">${fmtText(instr)}</div>`
            : `<div class="fj-getready">Get ready…</div>`}
        </div>
      </div>
      ${firstOfView ? `<div class="fj-splash"><span>FINAL<br>JEOPARDY!</span></div>` : ""}
    </div>`;
  } else if (S.view === "final-category") {
    // On first entry a huge "CATEGORY" flies in and holds ~3s, then shrinks and
    // rises while the real category name effects in below it. Later re-renders
    // show the settled state (small "CATEGORY" header + the category name).
    view = `<div class="clue-full fj-screen fj-cat"><div class="fj-rays"></div>
      <div class="fj-content">
        <div class="fj-cat-word${firstOfView ? " anim-catword" : ""}">FINAL JEOPARDY — CATEGORY</div>
        <div class="fj-cat-name${firstOfView ? " anim-catname" : ""}">${fmtText(S.game.final.category)}</div>
      </div>
      ${firstOfView ? `<div class="fj-cat-big"><span>FINAL JEOPARDY<br>CATEGORY</span></div>` : ""}
    </div>`;
  } else if (S.view === "final-clue") {
    const f = S.game.final;
    const fimgs = currentClueImages(f, S.finalRevealed);
    view = (S.photoZoom && fimgs.length)
      ? photoZoomHtml(fimgs)
      : clueScreenHtml("Final Jeopardy — " + f.category, f.clue, f.answer, S.finalRevealed, fimgs, animateAnswer, f.replace, clueImageChanges(f));
  } else if (S.view === "final-winner") {
    view = finalWinnerHtml();
  } else if (S.view === "clue" && S.active) {
    const cl = activeClue();
    if (cl) {
      const amount = S.dd && S.dd.wager != null ? S.dd.wager : cl.value;
      const imgs = currentClueImages(cl, S.revealed);   // answer images once revealed (if the sheet split them with THEN)
      view = (S.photoZoom && imgs.length)
        ? photoZoomHtml(imgs)                            // blown up to fill the TV (Task: photos full screen)
        : clueScreenHtml(activeCatName() + " — " + money(amount), cl.clue, cl.answer, S.revealed, imgs, animateAnswer, cl.replace, clueImageChanges(cl));
    }
  }
  if (!view && r) {
    // board — rows are the dollar values present in the data; a tile only
    // appears where the sheet has that question filled in
    const nCats = r.categories.length;
    const rows = roundValueRows(r);
    let cells = r.categories.map(c => `<div class="b-cat">${esc(c.name)}</div>`).join("");
    for (const row of rows) {
      for (let c = 0; c < nCats; c++) {
        const idx = clueIndexAt(r.categories[c], row.value, row.occ);
        const clue = idx === -1 ? null : r.categories[c].clues[idx];
        cells += clue
          ? `<div class="b-tile ${clue.used ? "used" : ""}" data-cat="${c}" data-row="${idx}"><span class="b-val">$${clue.value}</span></div>`
          : `<div class="b-tile used"></div>`;
      }
    }
    // fonts shrink when the board has more rows than the classic 5
    const rowVh = 88 / (rows.length + 0.8);
    view = `<div class="disp-view" style="padding:1.2vmin">
      <div class="board" style="--rowvh:${rowVh.toFixed(2)};grid-template-columns:repeat(${nCats},1fr);grid-template-rows:0.8fr repeat(${rows.length},1fr)">${cells}</div>
    </div>`;
  }

  // The scores strip belongs on the board; the full-screen clue views (a fixed
  // .clue-full) cover it anyway, and rendering it there makes it flash at the top
  // during the tile-fly (the fixed clue leaves the strip as the only in-flow child).
  const clueFullView = S.view === "clue" || S.view === "dd"
    || S.view === "final-intro" || S.view === "final-category" || S.view === "final-clue";
  const showStrip = S.phase === "play" && !clueFullView
    && S.view !== "bigscores" && S.view !== "winner" && S.view !== "final-winner" && S.teams.length;
  // Whose turn it is to pick: their pod glows a subtle green in the strip below the
  // board. -1 (no order drawn yet) simply matches nobody.
  const picker = currentPicker(S);
  app.innerHTML = `
    <div class="disp-stage">
      ${view}
      ${showStrip ? `<div class="scores-strip">
        ${S.teams.map((t, i) => `<div class="score-pod${i === picker ? " is-picking" : ""}">
          <div class="sp-name">${esc(dispTeamName(t) || "—")}</div>
          <div class="sp-score ${t.score < 0 ? "neg" : ""}">${money(t.score)}</div>
        </div>`).join("")}</div>` : ""}
    </div>
    <button class="fs-btn" id="btnFS">⛶ Fullscreen (F)</button>
    ${wantFs && !fsElement() ? `<div class="fs-prompt">▶ Click this screen<br>(or press any key)<br>for true full screen</div>` : ""}
    <div class="timerbar-wrap" id="timerWrap"><div class="timerbar" id="timerBar"></div></div>`;

  document.getElementById("btnFS").onclick = goFullscreen;
  runTimerBar();
  renderCurtain();
  renderPhoneToast();                  // fires only when a NEW team has phoned grandma
  applyBoardPending();                 // keep tiles hidden if a board rebuild lands mid-intro (no-op otherwise)
  lastRenderedView = S.view;
  lastFinalReveal = (S.view === "final-winner") ? (S.finalReveal || 0) : 0;
  fitClue();                          // immediate best-effort (sizes text at full screen)
  if (flyFrom) startClueFly(flyFrom, flyBoardBg);   // ...then fly the sized clue in from the tile
  // Winner reveal: when exactly one new place was just unveiled, make that team's
  // card appear big in the center, hold, then drop into its slot (last place ->
  // first). Skipped on "reveal all" (a multi-step jump), on the loader (0), and on
  // a fresh entry/resume into the view (!firstOfView) so a reopened display window
  // reconstructs the standings statically instead of spuriously re-flying place 1.
  if (S.view === "final-winner") {
    const N = S.teams.length;
    const revealed = Math.min(S.finalReveal || 0, N);
    if (!firstOfView && revealed - prevFinalReveal === 1 && revealed > 0) {
      const card = document.querySelector(".standings-list .standing-card");   // first = newest = top of the stack
      if (card) startWinnerHero(card);
    }
    // Winner crowned (every place shown): grow the champion, recede the rest.
    // Added next frame so it transitions smoothly from the freshly-rendered state.
    if (revealed >= N && N > 0) {
      requestAnimationFrame(() => { const s = document.querySelector(".fj-standings"); if (s) s.classList.add("crowned"); });
    }
  }
  requestAnimationFrame(fitClue);     // correct once layout/fonts have settled (skipped while flying)
  setTimeout(fitClue, 250);           // backup in case fonts/layout settle later
}

/* Winner reveal "center hero": the just-unveiled team card (already sitting in its
   resting slot) is transformed to appear large in the middle of the screen, held
   briefly, then transitioned back to its slot (transform:none). FLIP-style, like
   startClueFly but reversed and with a dramatic hold. Robust: a following
   re-render rebuilds #app (dropping the transform), and the timer is cleared up
   top and guarded, so nothing lingers if the host reveals the next place quickly. */
function startWinnerHero(card) {
  const to = card.getBoundingClientRect();
  if (!to.width || !to.height) return;
  const vw = window.innerWidth, vh = window.innerHeight;
  const champ = card.classList.contains("champ");
  // Scale so the hero is clearly large in the centre but always fits (the resting
  // card is a wide band, so the enlargement is modest — the long hold below is
  // what lets players read the big numbers). The champion gets a little more.
  let scale = Math.min((vw * 0.96) / to.width, (vh * (champ ? 0.6 : 0.54)) / to.height, 2.4);
  if (!(scale > 0.2)) return;
  scale = Math.max(scale, champ ? 1.22 : 1.15);
  const cx = to.left + to.width / 2, cy = to.top + to.height / 2;
  const tx = (vw / 2 - cx), ty = (vh * 0.45 - cy);   // toward the centre (a hair above middle)
  card.style.transformOrigin = "center center";
  card.style.transition = "none";
  card.style.zIndex = "6";
  card.style.willChange = "transform";
  card.classList.add("hero-fly");
  card.style.transform = `translate(${tx.toFixed(1)}px, ${ty.toFixed(1)}px) scale(${scale.toFixed(3)})`;
  void card.offsetWidth;                              // commit the start state before transitioning
  winnerHeroTimer = setTimeout(() => {
    winnerHeroTimer = null;
    if (!card.isConnected) return;
    card.style.transition = "transform .8s cubic-bezier(.2,.8,.2,1)";
    card.style.transform = "none";                    // drop into the slot
    let done = false;
    const finish = () => {
      if (done || !card.isConnected) return;
      done = true;
      card.style.transition = ""; card.style.transform = ""; card.style.transformOrigin = "";
      card.style.zIndex = ""; card.style.willChange = ""; card.classList.remove("hero-fly");
    };
    card.addEventListener("transitionend", function h(e) {
      if (e.propertyName === "transform") { card.removeEventListener("transitionend", h); finish(); }
    });
    setTimeout(finish, 1000);                          // fallback if transitionend never fires
  }, 3200);                                            // hold large in the centre so players can read the result
}

/* Grow the just-rendered clue out of the tile it was picked from (FLIP): start it
   scaled/translated onto the tile's rect, then transition to full screen. The
   board stays visible behind it during the flight. Reliable: bails cleanly if
   anything's missing, and always cleans up (transitionend + a timeout fallback). */
function startClueFly(fromRect, boardBg) {
  const cleanupBg = () => { if (boardBg && boardBg.parentNode) boardBg.remove(); };
  const el = document.querySelector(".clue-full");
  const to = el && el.getBoundingClientRect();
  if (!el || !to || !to.width || !to.height || !fromRect.width || !fromRect.height) { cleanupBg(); return; }
  const sx = fromRect.width / to.width, sy = fromRect.height / to.height;
  const tx = fromRect.left - to.left, ty = fromRect.top - to.top;
  flying = true;
  el.style.transformOrigin = "0 0";
  el.style.transition = "none";
  el.style.transform = `translate(${tx}px, ${ty}px) scale(${sx}, ${sy})`;
  el.style.willChange = "transform";
  void el.offsetWidth;                          // commit the tile-sized starting state
  el.style.transition = "transform .85s linear";  // classic Jeopardy: constant velocity/scale
  el.style.transform = "none";
  let done = false;
  const finish = () => {
    if (done) return; done = true;
    el.removeEventListener("transitionend", onEnd);
    cleanupBg();
    el.style.transition = ""; el.style.transform = ""; el.style.transformOrigin = ""; el.style.willChange = "";
    flying = false;
    fitClue();                                  // re-fit now that it's full size
  };
  const onEnd = (e) => { if (e.propertyName === "transform") finish(); };
  el.addEventListener("transitionend", onEnd);
  setTimeout(finish, 1250);                     // fallback (> the flight) so it can never get stuck
}

/* The curtain is a persistent overlay (kept OUTSIDE #app, which is rebuilt on
   every render) so it can transition smoothly — the fade-to-black / fade-to-a-
   screen / fade-back-to-game failsafes. Driven purely by S.stage: the control
   panel sets it and broadcasts, the display just reacts.

   Two stacked layers (a PANEL beneath, black on top) each fade their own opacity,
   so a fade TO black is ALWAYS smooth (black fades in over whatever's showing).
   The panel draws whichever full-screen card the stage names — the title screen,
   the rules, the teams, or the picking order — so moving between two of them is
   just a content swap under a layer that never moves. The one exception the host
   asked for: black -> a panel is an instant cut, not a fade. */
const PANEL_STAGES = ["title", "rules", "teams", "picks"];
function isPanelStage(s) { return PANEL_STAGES.indexOf(s) !== -1; }
function stagePanelHtml(stage) {
  switch (stage) {
    case "title": return welcomeHtml();
    case "rules": return rulesScreenHtml();
    case "teams": return teamsScreenHtml();
    case "picks": return picksScreenHtml();
    default:      return "";
  }
}
let curtainPanelHtml = null;   // what the panel layer currently shows (skip identical rebuilds)

function renderCurtain() {
  const stage = S.stage || "game";
  let el = document.getElementById("dispCurtain");
  let firstTime = false;
  if (!el) {
    el = document.createElement("div");
    el.id = "dispCurtain";
    el.className = "disp-curtain";
    el.innerHTML = `<div class="curtain-panel"></div><div class="curtain-black"></div>`;
    document.body.appendChild(el);
    firstTime = true;
    curtainPanelHtml = null;
  }
  const panelEl = el.querySelector(".curtain-panel");
  const blackEl = el.querySelector(".curtain-black");
  const panel = isPanelStage(stage);

  // Refresh the panel's CONTENT on every render, not just when the stage changes:
  // team names are typed on the control panel WHILE the teams screen is up, and a
  // window opened straight onto a panel stage paints before the game arrives.
  // Rebuild only on a real difference, so an unrelated re-render can't flicker it.
  if (panel) {
    const html = stagePanelHtml(stage);
    if (html !== curtainPanelHtml) { panelEl.innerHTML = html; curtainPanelHtml = html; }
  }

  const prev = el.dataset.stage || "game";
  if (stage === prev && !firstTime) return;          // no change -> don't restart a transition
  el.dataset.stage = stage;
  // Everything fades (0.6s) EXCEPT: the very first paint (so a black deploy is a
  // clean slate, no fade-in over the game) and black -> a panel (an instant jump).
  // Panel -> panel needs no transition at all: the layer stays at full opacity and
  // only its contents change, which reads as a clean cut between the two screens.
  const instant = firstTime || (prev === "black" && panel);
  setCurtainLayer(panelEl, panel ? 1 : 0, instant);
  setCurtainLayer(blackEl, stage === "black" ? 1 : 0, instant);
}
function setCurtainLayer(elem, target, instant) {
  if (instant) {
    elem.style.transition = "none";
    elem.style.opacity = String(target);
    void elem.offsetWidth;                           // reflow so "none" applies before we restore it
    elem.style.transition = "";
  } else {
    elem.style.opacity = String(target);
  }
}

/* ---------------- "…has phoned grandma!" ----------------
   A brief banner over whatever the TV is showing — the game is never interrupted.
   S.phoneAlert.ts is the trigger: it changes only when the host presses a team's
   phone button, so ordinary re-renders (a score edit, the timer) leave it alone.

   lastPhoneTs starts at whatever had ALREADY happened when this window first heard
   from the control panel (primeDisplayOneShots, called from core.js), so a TV
   opened or reopened mid-game never replays an old call. */
const PHONE_TOAST_MS = 4200;
let lastPhoneTs = 0;
let phoneToastTimer = null;

function primeDisplayOneShots() {
  lastPhoneTs = (S.phoneAlert && S.phoneAlert.ts) || 0;
}

function renderPhoneToast() {
  const a = S.phoneAlert;
  const ts = (a && a.ts) || 0;
  if (ts === lastPhoneTs) return;                    // nothing new since the last snapshot
  lastPhoneTs = ts;

  let el = document.getElementById("phoneToast");
  if (!a) {                                          // cleared (a new game) — take it down
    clearTimeout(phoneToastTimer);
    if (el) el.classList.remove("show");
    return;
  }
  // The team's CURRENT name wins (it may have been renamed since); a.name is the
  // name it had when it called, for a team that has since been removed. Both are
  // blank for a team that never chose one — and the TV says "A team" rather than
  // ever printing the sheet's ID. (The Host View uses a.label and does show it.)
  const team = (S.teams || [])[a.teamIdx];
  const name = dispTeamName(team) || a.name || "A team";

  if (!el) {
    el = document.createElement("div");
    el.id = "phoneToast";
    el.className = "phone-toast";
    document.body.appendChild(el);                   // outside #app, so a re-render can't kill it mid-show
  }
  el.innerHTML = `<span class="pt-phone">📞</span><span class="pt-text">${esc(name)} has phoned grandma!</span>`;
  el.classList.remove("show");
  void el.offsetWidth;                               // restart the slide-in even on a back-to-back call
  el.classList.add("show");
  clearTimeout(phoneToastTimer);
  phoneToastTimer = setTimeout(() => el.classList.remove("show"), PHONE_TOAST_MS);
}

/* ---------------- category intro (the "here are today's categories" reveal) ----
   Full-screen overlay, triggered by the control panel's Show Categories button.
   Holds a CATEGORIES title card for 3s, then shuffles each category (in board
   order) for ~1.75s apiece with a slide/scale/blur reveal, then fades to the
   board. Self-contained on the display; nothing further is broadcast. */
let introTimer = null;

/* ---------------- one-time board "populate" reveal ----------------
   After the category intro dissolves on the game's FIRST reveal, the board's
   tiles don't just appear — they fill in a few random groups at a time, like the
   real Jeopardy board reveal, with a short arcade blip (played by the control
   panel) as each group lands. Self-contained on the display, and only ever armed
   when the control panel sends play-intro with reveal:true (its own once-per-game
   guard), so there's no redo. */
let boardRevealPhase = null;        // null | "pending" (tiles hidden under the intro) | "running"
let boardRevealTimers = [];
function cancelBoardReveal() {
  boardRevealTimers.forEach(clearTimeout); boardRevealTimers = [];
  boardRevealPhase = null;
  const b = document.querySelector(".board.is-revealing");
  if (b) {
    b.classList.remove("is-revealing");
    b.querySelectorAll(".tile-pending").forEach(t => t.classList.remove("tile-pending"));
  }
}
/* Hide every board tile (dim the rectangle, hide its value) so the board sitting
   under the opaque intro shows only its category headers. Re-applied by
   renderDisplay if the board is rebuilt mid-intro, so the tiles never flash in. */
function applyBoardPending() {
  if (boardRevealPhase !== "pending") return;
  const board = document.querySelector(".board");
  if (!board) return;
  const tiles = board.querySelectorAll(".b-tile");
  if (!tiles.length) return;
  board.classList.add("is-revealing");
  tiles.forEach(t => t.classList.add("tile-pending"));
}
/* Fill the board in a few random groups, one after another, blipping per group. */
function runBoardReveal() {
  const board = document.querySelector(".board");
  const tiles = board ? [...board.querySelectorAll(".b-tile.tile-pending")] : [];
  if (!tiles.length) { cancelBoardReveal(); return; }
  boardRevealPhase = "running";
  const GROUPS = Math.min(6, tiles.length);
  // Shuffle the tiles (so WHICH tiles appear each round stays random and
  // scattered, not row by row), then deal them into the rounds in EVEN chunks —
  // each round reveals about the same number of tiles, at a fixed interval, so
  // the pacing is steady instead of lumpy.
  const shuffled = tiles.map(t => [Math.random(), t]).sort((a, b) => a[0] - b[0]).map(x => x[1]);
  const base = Math.floor(shuffled.length / GROUPS), rem = shuffled.length % GROUPS;
  const groups = [];
  for (let g = 0, idx = 0; g < GROUPS; g++) {
    const count = base + (g < rem ? 1 : 0);   // spread the remainder over the first few rounds
    groups.push(shuffled.slice(idx, idx + count));
    idx += count;
  }
  const LEAD = 160, GAP = 500;   // fixed interval between rounds
  let clock = LEAD;
  groups.forEach((grp, g) => {
    boardRevealTimers.push(setTimeout(() => {
      CHANNEL.postMessage({ type: "board-beep", step: g, total: GROUPS });   // control panel blips once per round
      grp.forEach(t => t.classList.remove("tile-pending"));                  // the whole round cuts in at the same instant
    }, clock));
    clock += GAP;
  });
  boardRevealTimers.push(setTimeout(cancelBoardReveal, clock + 250));   // settle: back to a plain static board
}

function playCategoryIntro(withReveal) {
  const r = currentRound();
  if (!r || !r.categories || !r.categories.length) return;
  if (introTimer) { clearTimeout(introTimer); introTimer = null; }
  cancelBoardReveal();                                   // drop any prior/interrupted reveal
  const old = document.getElementById("catIntro"); if (old) old.remove();

  const cats = r.categories.map(c => c.name);
  const ov = document.createElement("div");
  ov.id = "catIntro"; ov.className = "cat-intro";
  // Persistent top banner + a slot the cards shuffle through. The banner stays
  // put while categories cycle, so it's always clear what's being shown.
  ov.innerHTML = `<div class="cat-intro-banner">CATEGORIES</div><div class="cat-intro-slot"></div>`;
  document.body.appendChild(ov);
  const slot = ov.querySelector(".cat-intro-slot");

  // First reveal of the game: hide the board tiles now, while the opaque intro
  // covers them, so they can populate group-by-group once it dissolves.
  if (withReveal) { boardRevealPhase = "pending"; applyBoardPending(); }

  const TITLE_MS = 3000, CAT_MS = 2000, OUT_MS = 700;
  const steps = [{ kind: "title" }].concat(cats.map((name, i) => ({ kind: "cat", name, idx: i + 1, total: cats.length })));
  let i = 0;
  const step = () => {
    if (i >= steps.length) {                         // done — fade the overlay off, revealing the board
      ov.classList.add("cat-intro-out");
      introTimer = setTimeout(() => {
        ov.remove(); introTimer = null;
        if (boardRevealPhase === "pending") runBoardReveal();   // ...then populate the board, group by group
      }, OUT_MS);
      return;
    }
    const s = steps[i]; i++;
    const dwell = s.kind === "title" ? TITLE_MS : CAT_MS;
    ov.classList.toggle("show-banner", s.kind === "cat");   // banner only while cycling categories, not on the title
    if (s.kind === "title") {
      slot.innerHTML = `<div class="cat-intro-card title" style="--dwell:${dwell}ms">
        <div class="cat-intro-count">Here are today's</div>
        <div class="cat-intro-name" style="font-size:12vw">CATEGORIES</div></div>`;
    } else {
      const n = String(s.name || "").length;
      const size = n > 30 ? "4.4vw" : n > 22 ? "5.4vw" : n > 14 ? "7vw" : "8.6vw";
      slot.innerHTML = `<div class="cat-intro-card" style="--dwell:${dwell}ms">
        <div class="cat-intro-count">${s.idx} of ${s.total}</div>
        <div class="cat-intro-name" style="font-size:${size}">${fmtText(String(s.name || "").toUpperCase())}</div></div>`;
    }
    introTimer = setTimeout(step, dwell);
  };
  step();
}

/* Safety net so long text is never cut off: after layout, if the clue/answer
   overflow the screen, shrink their font until everything fits. Short clues
   never overflow, so they're left exactly as-is. Re-runs on image load.
   No-image clues grow to content height, so we test against the viewport;
   image clues fill the height, so we test their internal content overflow. */
function fitClue() {
  if (flying) return;   // the clue is mid-flight (transformed) — measuring it now would be wrong
  const inner = document.querySelector(".clue-full .clue-inner");
  if (!inner) return;
  if (inner.classList.contains("prefit")) return;   // already showing a fitted size for this exact clue — never re-shrink
  const els = [inner.querySelector(".clue-text"), inner.querySelector(".clue-answer")].filter(Boolean);
  if (!els.length) return;
  // Measure the real content extent (first child's top to last child's bottom),
  // which includes any overflow past the capped inner box, and shrink the
  // clue/answer font until it fits fully within the viewport.
  const bounds = () => {
    let top = Infinity, bot = 0;
    for (const k of inner.children) { const r = k.getBoundingClientRect(); top = Math.min(top, r.top); bot = Math.max(bot, r.bottom); }
    return { top, bot };
  };
  let guard = 0;
  // Keep a little breathing room at the bottom so text never hugs the edge
  // (the top already has room). Text lifts up into that space as it shrinks.
  const bottomGap = Math.max(2, window.innerHeight * 0.035);
  let lastBot = Infinity;
  while (guard++ < 100) {
    const b = bounds();
    if (b.top >= 2 && b.bot <= window.innerHeight - bottomGap) break;   // on screen, off the bottom edge
    // If shrinking the text stopped lowering the content's bottom, an image is
    // flex-filling the freed space — shrinking further only makes text tiny for
    // nothing. Stop and keep the text big (the picture absorbs the overflow).
    if (b.bot > lastBot - 0.5) break;
    lastBot = b.bot;
    let shrunk = false;
    for (const el of els) {
      const m = (el.style.fontSize || "").match(/([\d.]+)vw/);
      if (m && parseFloat(m[1]) > 1.2) { el.style.fontSize = (parseFloat(m[1]) * 0.95).toFixed(3) + "vw"; shrunk = true; }
    }
    if (!shrunk) break;   // hit the minimum font — accept it
  }
  // Remember the converged sizes so a re-render of this same clue paints them
  // straight away (no flash-large-then-shrink when a picture reloads).
  if (lastClueFitKey) {
    const t = inner.querySelector(".clue-text"), a = inner.querySelector(".clue-answer");
    fitCache[lastClueFitKey] = { text: t && t.style.fontSize, answer: a && a.style.fontSize };
  }
}

/* A picture that fails to load must not vanish silently: show a visible
   placeholder AND tell the control window so the host can adapt. */
function imgFail(img) {
  const src = img.src;
  img.outerHTML = `<div class="clue-img-fail">⚠️ Picture couldn't load</div>`;
  CHANNEL.postMessage({ type: "img-error", src });
}

/* Photo(s) blown up to fill the whole TV — the host's "Photos full screen"
   toggle. Purely a game view; it doesn't touch the browser fullscreen mode.
   Toggling it off returns to the clue exactly as it was. */
function photoZoomHtml(imgs) {
  return `<div class="photo-zoom${imgs.length > 1 ? " multi" : ""}">
    ${imgs.map(u => `<img class="pz-img" src="${esc(u)}" alt="" onerror="imgFail(this)">`).join("")}</div>`;
}

/* The Final Jeopardy standings reveal (the "final-winner" view). S.finalReveal is
   how many places are showing (0 = the "Tallying scores…" loader). Only the
   revealed teams render, stacked bottom-up (last place lowest); the newest is the
   top card and is flown in big from the centre by startWinnerHero(). Once every
   place is shown the champion is enlarged and the rest recede (the "crowned"
   class, added in renderDisplay). */
function finalWinnerHtml() {
  const standings = finalStandings(S.teams);          // [{team, idx, rank, isTop}] high -> low
  const N = standings.length;
  const revealed = Math.min(Math.max(S.finalReveal || 0, 0), N);

  // finalReveal 0 == the "Tallying scores…" loader that opens the reveal.
  if (revealed === 0) {
    return `<div class="clue-full fj-screen fj-tally"><div class="fj-rays"></div>
      <div class="fj-content">
        <div class="fj-banner">FINAL JEOPARDY</div>
        <div class="tally-title">Tallying the scores<span class="tally-dots"><i>.</i><i>.</i><i>.</i></span></div>
        <div class="tally-loader">${"<span></span>".repeat(7)}</div>
      </div></div>`;
  }

  // Only the revealed teams show, stacked at the bottom (last place lowest); each
  // new one is prepended at the top of the stack and flown in from the centre by
  // startWinnerHero(). Cards are sized for the full team count so they never
  // resize as more appear. Every box is centre-justified and carries a green/red
  // Final Jeopardy delta.
  const shown = standings.slice(N - revealed);        // high -> low; first = newest = top of stack
  const showPlayers = N <= 5;                          // drop the players line in a full field so bands stay compact
  const cards = shown.map(s => {
    const champ = s.isTop;
    const d = finalDelta(s.idx);
    const dCls = d > 0 ? "up" : d < 0 ? "down" : "flat";
    const dTxt = d > 0 ? "+" + money(d) : d < 0 ? money(d) : "$0";
    const players = showPlayers && s.team.players && s.team.players.length
      ? `<div class="sc-players">${esc(s.team.players.join(" · "))}</div>` : "";
    // Horizontal band: place + name on the left, then two big labelled numbers on
    // the right (final score, and the Final Jeopardy result) so the metrics are
    // large and readable.
    return `<div class="standing-card${champ ? " champ" : ""}">
      <div class="sc-rank">
        <div class="sc-place">${ordinal(s.rank)}</div>
      </div>
      <div class="sc-id">
        ${champ ? `<div class="sc-champ-tag">CHAMPION</div>` : ""}
        <div class="sc-name">${esc(dispTeamName(s.team) || "—")}</div>
        ${players}
      </div>
      <div class="sc-metrics">
        <div class="sc-metric">
          <div class="sc-metric-label">Score</div>
          <div class="sc-balance${s.team.score < 0 ? " neg" : ""}">${money(s.team.score)}</div>
        </div>
        <div class="sc-metric">
          <div class="sc-metric-label">Final Jeopardy result</div>
          <div class="sc-result ${dCls}">${dTxt}</div>
        </div>
      </div>
    </div>`;
  }).join("");
  const complete = revealed >= N;
  // A tie for first marks >1 card .champ. Two adjacent champions can't both scale
  // up on the crowned reveal without overlapping into the small gap, so flag the
  // container and let the CSS skip the grow-toward-each-other for co-champions.
  const multiChamp = standings.filter(s => s.isTop).length > 1;
  return `<div class="clue-full fj-screen fj-standings${complete ? " complete" : ""}${multiChamp ? " multi-champ" : ""}"><div class="fj-rays"></div>
    <div class="fj-standings-title">FINAL STANDINGS</div>
    <div class="standings-list" style="--nrows:${N}">${cards}</div>
  </div>`;
}

function clueScreenHtml(catLabel, clue, answer, revealed, image, animate, replace, imageChanged) {
  // Clues flagged in the sheet ("Answer replaces question?") drop the question
  // text once the answer is revealed so the answer fills the screen — but a
  // photo, if any, always stays.
  const hideQ = !!(replace && revealed);
  const imgs = imageList(image);          // one or two pictures
  const hasImg = imgs.length > 0;
  const ansLen = String(answer || "").length;
  // Scale the QUESTION text by total visible content so long clues still fit.
  const len = (hideQ ? 0 : clue.length) + (revealed ? ansLen : 0) + (hasImg ? 180 : 0);
  const size = len > 600 ? "2.4vw" : len > 400 ? "3vw" : len > 260 ? "3.6vw" : len > 150 ? "4.4vw" : len > 80 ? "5.2vw" : "6.2vw";

  // Answer font + picture prominence — always lean LARGE (group viewing), with the
  // balance between picture and answer set by scenario. imgMaxVh caps the picture
  // (null = fill the space); fitClue still shrinks text if a long answer overflows.
  const shortAns = ansLen <= 45, longAns = ansLen > 115;
  let ansSize, imgMaxVh = null;
  if (!revealed) {
    imgMaxVh = imgs.length > 1 ? 46 : null;     // pre-reveal: cap two pictures so the question stays big; one fills
  } else if (hasImg) {
    if (imageChanged && hideQ) {
      // a NEW picture takes over from the question — accentuate it; answer big at
      // the bottom, equally prevalent.
      imgMaxVh = 62; ansSize = shortAns ? "5.6vw" : longAns ? "3.6vw" : "4.6vw";
    } else if (shortAns) {
      imgMaxVh = 58; ansSize = "5.6vw";           // short answer: picture AND answer both big
    } else if (longAns) {
      imgMaxVh = 34; ansSize = "3.4vw";           // long answer, unchanged picture: give the text the room
    } else {
      imgMaxVh = 46; ansSize = "4.4vw";
    }
  } else {
    // no picture — the answer owns the screen; keep the existing (big) steps
    ansSize = hideQ
      ? (ansLen > 320 ? "3.6vw" : ansLen > 180 ? "4.6vw" : ansLen > 90 ? "5.8vw" : "7vw")
      : (len > 150 ? "3.6vw" : "4.6vw");
  }

  const imgsStyle = (imgMaxVh != null) ? ` style="max-height:${imgMaxVh}vh"` : "";
  const imgHtml = hasImg
    ? `<div class="clue-imgs${imgs.length > 1 ? " multi" : ""}"${imgsStyle}>${imgs.map(u => `<img class="clue-img" src="${esc(u)}" alt="" onload="fitClue()" onerror="imgFail(this)">`).join("")}</div>`
    : "";
  // Render pre-fitted when we've sized this exact clue before (kills the timer /
  // score-edit re-render jolt). Keyed by the visible content so a different clue,
  // reveal state, or hidden-question all get their own fit.
  lastClueFitKey = [catLabel, hideQ ? "" : clue, revealed ? answer : "", hasImg ? "I" : ""].join("");
  const cached = fitCache[lastClueFitKey] || {};
  // "prefit": sized this exact clue before -> render those sizes and tell fitClue
  // to TRUST them (skip re-shrinking), so a re-render of an unchanged clue
  // reproduces what's on screen (no flash-then-shrink, no cumulative drift).
  const prefit = cached.text != null || cached.answer != null;
  const textSize = cached.text || size;
  const ansSizeFit = cached.answer || ansSize;
  return `<div class="clue-full"><div class="clue-inner ${revealed ? "revealed" : ""} ${hasImg ? "has-image" : ""}${prefit ? " prefit" : ""}">
    <div class="clue-cat">${esc(catLabel)}</div>
    ${hideQ ? "" : `<div class="clue-text" style="font-size:${textSize}">${fmtText(clue)}</div>`}
    ${imgHtml}
    ${revealed ? `<div class="clue-answer ${animate ? "pop" : ""}" style="font-size:${ansSizeFit}">${fmtText(answer)}</div>` : ""}
  </div></div>`;
}

let timerRAF = null;
function runTimerBar() {
  const wrap = document.getElementById("timerWrap");
  const bar = document.getElementById("timerBar");
  if (timerRAF) { cancelAnimationFrame(timerRAF); timerRAF = null; }
  // never show the timer bar over the scores/winner screens
  const timerHidden = !S.timer || S.view === "winner" || S.view === "bigscores";
  if (timerHidden || !wrap) { if (wrap) wrap.style.display = "none"; return; }
  wrap.style.display = "block";
  const tick = () => {
    const elapsed = (Date.now() - S.timer.startedAt) / 1000;
    const frac = Math.max(0, 1 - elapsed / S.timer.seconds);
    bar.style.transform = `scaleX(${frac})`;
    bar.style.background = frac < .25 ? "#ff5555" : "var(--value-gold)";
    if (frac > 0) timerRAF = requestAnimationFrame(tick);
    else wrap.style.display = "none";   // time's up — don't leave a dead strip on the TV
  };
  tick();
}

/* Whether this display is MEANT to be full screen — set by a fullscreen deploy
   (armAutoFullscreen) or when the host toggles it on, cleared when the host
   toggles it off. Drives the auto-recovery in onFullscreenChange below. */
let fsWanted = false;

/* Toggle — wired to the F key and the ⛶ button. */
function goFullscreen() {
  if (fsElement()) {
    fsWanted = false;   // an explicit toggle OUT: the host wants windowed — don't nag to go back
    (document.exitFullscreen || document.webkitExitFullscreen || function () {}).call(document);
  } else {
    fsWanted = true;    // toggling IN: keep it full screen (and restore it if it later drops out)
    enterFullscreen();
  }
}

/* Enter only (never exit) — used by the auto-fullscreen path so a stray second
   trigger can't bounce us back out. */
function enterFullscreen() {
  if (fsElement()) return;
  const el = document.documentElement;
  try {
    if (el.requestFullscreen) { const p = el.requestFullscreen(); if (p && p.catch) p.catch(() => {}); }
    else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
  } catch (e) { /* blocked until a gesture — the prompt/handlers below handle that */ }
}

/* The click/key that turns the "click for full screen" prompt into real fullscreen. */
function fsGo(e) {
  // ignore lone modifier keys so e.g. tabbing away doesn't count
  if (e && e.type === "keydown" && ["Shift", "Control", "Alt", "Meta", "CapsLock"].includes(e.key)) return;
  if (e) e.stopPropagation();            // don't also fire the ⛶ button / F toggle for this same event
  enterFullscreen();                     // a real click/key is a valid gesture, so this takes
}
/* Show the "click for full screen" prompt and listen for the gesture that fulfils it. */
function showFsPrompt() {
  if (wantFs) return;                    // already showing
  wantFs = true;
  document.addEventListener("click", fsGo, true);    // capture, so it beats the ⛶ button's own handler
  document.addEventListener("keydown", fsGo, true);
  renderDisplay();                       // show the prompt
}
function hideFsPrompt() {
  if (!wantFs) return;
  wantFs = false;
  document.removeEventListener("click", fsGo, true);
  document.removeEventListener("keydown", fsGo, true);
  renderDisplay();
}

/* Make a fullscreen deploy actually enter fullscreen MODE (not just fill the
   desktop). Chrome won't let a normal site force fullscreen with zero gesture,
   so: (1) try immediately — succeeds only if the site is allow-listed via the
   AutomaticFullscreenAllowedForUrls policy; (2) otherwise the FIRST click or
   key anywhere in this window does it (a prompt says so). Broadened from just
   "F" so the host doesn't have to know the shortcut. */
function armAutoFullscreen() {
  fsWanted = true;
  enterFullscreen();                     // zero-gesture best effort (works only if allow-listed)
  showFsPrompt();                        // otherwise a click/key does it
}

/* Auto-recover full screen. The browser drops HTML full screen whenever the TV
   window loses focus — most notably when the host clicks "Open host view (new
   tab)", which pulls the browser's focus to the new tab. It can't be re-entered
   without a gesture, so if we drop out while we still WANT full screen, re-offer
   the one-click prompt: a single click (or key) on the TV puts it right back.
   Entering full screen hides the prompt again. Wired up from main.js. */
function onFullscreenChange() {
  if (fsElement()) hideFsPrompt();
  else if (fsWanted) showFsPrompt();
}
