"use strict";
/* ============================================================
   Display screen (the TV). Pure renderer of state snapshots —
   it never mutates game state.
   ============================================================ */

function fsElement() {
  return document.fullscreenElement || document.webkitFullscreenElement || null;
}

function renderDisplay() {
  document.body.className = "display" + (fsElement() ? " is-fullscreen" : "");
  const r = currentRound();
  let view = "";

  if (S.phase === "setup" || !S.game || S.view === "welcome") {
    view = `<div class="disp-view disp-bluebg"><div class="welcome-title">JEOPARDY!</div>
      <div class="welcome-sub">Get ready to play</div></div>`;
  } else if (S.view === "bigscores") {
    view = `<div class="disp-view">
      <div class="brand" style="font-size:4vw;color:var(--value-gold);margin-bottom:5vh;text-shadow:.06em .06em 0 #000">SCORES</div>
      <div class="bigscores">
        ${[...S.teams].sort((a, b) => b.score - a.score).map(t => `
          <div class="bigscore-pod score-pod">
            <div class="sp-name">${esc(t.name)}</div>
            <div class="sp-score ${t.score < 0 ? "neg" : ""}">${money(t.score)}</div>
          </div>`).join("")}
      </div></div>`;
  } else if (S.view === "dd") {
    view = `<div class="clue-full"><div class="clue-inner"><div class="dd-splash">DAILY<br>DOUBLE!</div></div></div>`;
  } else if (S.view === "final-category") {
    view = `<div class="clue-full"><div class="clue-inner">
      <div class="clue-cat">Final Jeopardy — The category is</div>
      <div class="clue-text" style="font-size:6vw">${esc(S.game.final.category)}</div></div></div>`;
  } else if (S.view === "final-clue") {
    view = clueScreenHtml(S.game.final.category, S.game.final.clue, S.game.final.answer, S.finalRevealed);
  } else if (S.view === "clue" && S.active) {
    const cl = activeClue();
    if (cl) {
      const amount = S.dd && S.dd.wager != null ? S.dd.wager : cl.value;
      view = clueScreenHtml(activeCatName() + " — " + money(amount), cl.clue, cl.answer, S.revealed);
    }
  }
  if (!view && r) {
    // board
    const nCats = r.categories.length;
    const maxRows = Math.max(...r.categories.map(c => c.clues.length));
    let cells = r.categories.map(c => `<div class="b-cat">${esc(c.name)}</div>`).join("");
    for (let row = 0; row < maxRows; row++) {
      for (let c = 0; c < nCats; c++) {
        const clue = r.categories[c].clues[row];
        cells += clue
          ? `<div class="b-tile ${clue.used ? "used" : ""}">$${clue.value}</div>`
          : `<div class="b-tile used"></div>`;
      }
    }
    view = `<div class="disp-view" style="padding:1.2vmin">
      <div class="board" style="grid-template-columns:repeat(${nCats},1fr);grid-template-rows:0.8fr repeat(${maxRows},1fr)">${cells}</div>
    </div>`;
  }

  const showStrip = S.phase === "play" && S.view !== "bigscores" && S.teams.length;
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
}

function clueScreenHtml(catLabel, clue, answer, revealed) {
  // Scale by total visible text so very long clues (and the revealed answer)
  // still fit; .clue-full also scrolls as a last resort.
  const len = clue.length + (revealed ? String(answer || "").length : 0);
  const size = len > 600 ? "2vw" : len > 400 ? "2.5vw" : len > 260 ? "3vw" : len > 150 ? "3.8vw" : len > 80 ? "4.6vw" : "5.4vw";
  return `<div class="clue-full"><div class="clue-inner">
    <div class="clue-cat">${esc(catLabel)}</div>
    <div class="clue-text" style="font-size:${size}">${esc(clue)}</div>
    ${revealed ? `<div class="clue-answer" style="font-size:${len > 150 ? "3vw" : "3.8vw"}">${esc(answer)}</div>` : ""}
  </div></div>`;
}

let timerRAF = null;
function runTimerBar() {
  const wrap = document.getElementById("timerWrap");
  const bar = document.getElementById("timerBar");
  if (timerRAF) { cancelAnimationFrame(timerRAF); timerRAF = null; }
  if (!S.timer || !wrap) { if (wrap) wrap.style.display = "none"; return; }
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
