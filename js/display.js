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

/* Remembers which revealed answer is currently on screen, so the "pop"
   animation plays once on reveal and then holds static across re-renders
   (e.g. when the host edits a score while the answer is up). */
let lastAnswerKey = null;
let winnerShown = false;   // same idea for the winner banner's pop

function renderDisplay() {
  document.body.className = "display" + (fsElement() ? " is-fullscreen" : "");
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

  if (S.phase === "setup" || !S.game || S.view === "welcome") {
    view = welcomeHtml();
  } else if (S.view === "bigscores") {
    view = `<div class="disp-view">
      <div class="brand" style="font-size:4vw;color:var(--value-gold);margin-bottom:3.5vh;text-shadow:.06em .06em 0 #000">CURRENT SCORES</div>
      <div class="bigscores">
        ${[...S.teams].sort((a, b) => b.score - a.score).map(t => `
          <div class="bigscore-pod score-pod">
            <div class="sp-name">${esc(t.name)}</div>
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
      <div class="winner-name">${champs.map(t => esc(t.name)).join(" &nbsp;&amp;&nbsp; ")}</div>
      <div class="winner-score">${money(topScore)}</div>
      <div class="bigscores">
        ${sorted.map(t => `
          <div class="bigscore-pod score-pod ${t.score === topScore ? "is-winner" : ""}">
            <div class="sp-name">${esc(t.name)}</div>
            <div class="sp-score ${t.score < 0 ? "neg" : ""}">${money(t.score)}</div>
            ${t.players && t.players.length ? `<div class="sp-players">${esc(t.players.join(" · "))}</div>` : ""}
          </div>`).join("")}
      </div></div>`;
  } else if (S.view === "dd") {
    view = `<div class="clue-full"><div class="clue-inner"><div class="dd-splash">DAILY<br>DOUBLE!</div></div></div>`;
  } else if (S.view === "final-category") {
    view = `<div class="clue-full"><div class="clue-inner">
      <div class="clue-cat">Final Jeopardy — The category is</div>
      <div class="clue-text" style="font-size:6vw">${esc(S.game.final.category)}</div></div></div>`;
  } else if (S.view === "final-clue") {
    view = clueScreenHtml(S.game.final.category, S.game.final.clue, S.game.final.answer, S.finalRevealed, S.game.final.image, animateAnswer);
  } else if (S.view === "clue" && S.active) {
    const cl = activeClue();
    if (cl) {
      const amount = S.dd && S.dd.wager != null ? S.dd.wager : cl.value;
      view = clueScreenHtml(activeCatName() + " — " + money(amount), cl.clue, cl.answer, S.revealed, cl.image, animateAnswer);
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
          ? `<div class="b-tile ${clue.used ? "used" : ""}">$${clue.value}</div>`
          : `<div class="b-tile used"></div>`;
      }
    }
    // fonts shrink when the board has more rows than the classic 5
    const rowVh = 88 / (rows.length + 0.8);
    view = `<div class="disp-view" style="padding:1.2vmin">
      <div class="board" style="--rowvh:${rowVh.toFixed(2)};grid-template-columns:repeat(${nCats},1fr);grid-template-rows:0.8fr repeat(${rows.length},1fr)">${cells}</div>
    </div>`;
  }

  const showStrip = S.phase === "play" && S.view !== "bigscores" && S.view !== "winner" && S.teams.length;
  app.innerHTML = `
    <div class="disp-stage">
      ${view}
      ${showStrip ? `<div class="scores-strip">
        ${S.teams.map(t => `<div class="score-pod">
          <div class="sp-name">${esc(t.name)}</div>
          <div class="sp-score ${t.score < 0 ? "neg" : ""}">${money(t.score)}</div>
        </div>`).join("")}</div>` : ""}
    </div>
    <button class="fs-btn" id="btnFS">⛶ Fullscreen (F)</button>
    <div class="timerbar-wrap" id="timerWrap"><div class="timerbar" id="timerBar"></div></div>`;

  document.getElementById("btnFS").onclick = goFullscreen;
  runTimerBar();
  renderCurtain();
  fitClue();                          // immediate best-effort
  requestAnimationFrame(fitClue);     // correct once layout/fonts have settled
  setTimeout(fitClue, 250);           // backup in case fonts/layout settle later
}

/* The curtain is a persistent overlay (kept OUTSIDE #app, which is rebuilt on
   every render) so its opacity can transition smoothly — the fade-to-black /
   fade-to-title / fade-back-to-game failsafes. Driven purely by S.stage:
   the control panel sets it and broadcasts, the display just reacts.
   Content is only swapped when the stage changes, so a re-render mid-fade
   (e.g. the host edits a score while the curtain is up) never restarts it. */
function renderCurtain() {
  const stage = S.stage || "game";
  let el = document.getElementById("dispCurtain");
  if (!el) {
    el = document.createElement("div");
    el.id = "dispCurtain";
    el.className = "disp-curtain";
    document.body.appendChild(el);
  }
  if (el.dataset.stage !== stage) {
    el.dataset.stage = stage;
    el.innerHTML = stage === "title" ? welcomeHtml() : "";
  }
  el.classList.toggle("open", stage !== "game");   // opacity 1 when a curtain is up
}

/* Safety net so long text is never cut off: after layout, if the clue/answer
   overflow the screen, shrink their font until everything fits. Short clues
   never overflow, so they're left exactly as-is. Re-runs on image load.
   No-image clues grow to content height, so we test against the viewport;
   image clues fill the height, so we test their internal content overflow. */
function fitClue() {
  const inner = document.querySelector(".clue-full .clue-inner");
  if (!inner) return;
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
  while (guard++ < 100) {
    const b = bounds();
    if (b.top >= 2 && b.bot <= window.innerHeight - 2) break;   // fully on screen
    let shrunk = false;
    for (const el of els) {
      const m = (el.style.fontSize || "").match(/([\d.]+)vw/);
      if (m && parseFloat(m[1]) > 1.2) { el.style.fontSize = (parseFloat(m[1]) * 0.95).toFixed(3) + "vw"; shrunk = true; }
    }
    if (!shrunk) break;   // hit the minimum font — accept it
  }
}

/* A picture that fails to load must not vanish silently: show a visible
   placeholder AND tell the control window so the host can adapt. */
function imgFail(img) {
  const src = img.src;
  img.outerHTML = `<div class="clue-img-fail">⚠️ Picture couldn't load</div>`;
  CHANNEL.postMessage({ type: "img-error", src });
}

function clueScreenHtml(catLabel, clue, answer, revealed, image, animate) {
  // Scale by total visible content so very long clues (and the revealed
  // answer, and a picture) still fit; .clue-full also scrolls as a last resort.
  const len = clue.length + (revealed ? String(answer || "").length : 0) + (image ? 180 : 0);
  // Bigger overall for accessibility; steps still shrink so long clues (and
  // image clues, which add ~180 to len) keep fitting the screen.
  const size = len > 600 ? "2.4vw" : len > 400 ? "3vw" : len > 260 ? "3.6vw" : len > 150 ? "4.4vw" : len > 80 ? "5.2vw" : "6.2vw";
  const ansSize = len > 150 ? "3.6vw" : "4.6vw";
  return `<div class="clue-full"><div class="clue-inner ${revealed ? "revealed" : ""} ${image ? "has-image" : ""}">
    <div class="clue-cat">${esc(catLabel)}</div>
    <div class="clue-text" style="font-size:${size}">${fmtText(clue)}</div>
    ${image ? `<img class="clue-img" src="${esc(image)}" alt="" onload="fitClue()" onerror="imgFail(this)">` : ""}
    ${revealed ? `<div class="clue-answer ${animate ? "pop" : ""}" style="font-size:${ansSize}">${fmtText(answer)}</div>` : ""}
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

function goFullscreen() {
  if (fsElement()) {
    (document.exitFullscreen || document.webkitExitFullscreen || function () {}).call(document);
  } else {
    const el = document.documentElement;
    if (el.requestFullscreen) el.requestFullscreen().catch(() => {});
    else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
  }
}
