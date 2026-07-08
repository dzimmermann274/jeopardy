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

let wantFs = false;         // opened for a fullscreen deploy but not yet in fullscreen
let lastRenderedView = null; // the S.view we last rendered (to detect board -> clue)
let flying = false;          // a "tile flies to full screen" animation is in progress

function renderDisplay() {
  // Clear any leftover fly background from a previous flight before we rebuild.
  const staleBg = document.getElementById("flyBoardBg");
  if (staleBg) staleBg.remove();

  // "Fly the tile to full screen": when a clue is picked from the board, capture
  // the tile's on-screen rect NOW (the board is still in the DOM) and keep the
  // board behind the incoming clue so it can grow out of the tile like real
  // Jeopardy. Only board -> clue/dd; anything else renders instantly as before.
  let flyFrom = null, flyBoardBg = null;
  if (lastRenderedView === "board" && (S.view === "clue" || S.view === "dd") && S.active) {
    const tile = document.querySelector(`.b-tile[data-cat="${S.active.cat}"][data-row="${S.active.row}"]`);
    const boardView = document.querySelector(".disp-stage > .disp-view");
    if (tile && boardView) {
      const r0 = tile.getBoundingClientRect();
      if (r0.width > 0 && r0.height > 0) {
        flyFrom = { left: r0.left, top: r0.top, width: r0.width, height: r0.height };
        flyBoardBg = document.createElement("div");
        flyBoardBg.id = "flyBoardBg";
        flyBoardBg.appendChild(boardView);      // move the live board out so the #app rebuild can't destroy it
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
    const f = S.game.final;
    const fimgs = currentClueImages(f, S.finalRevealed);
    view = (S.photoZoom && fimgs.length)
      ? photoZoomHtml(fimgs)
      : clueScreenHtml(f.category, f.clue, f.answer, S.finalRevealed, fimgs, animateAnswer, f.replace, clueImageChanges(f));
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
          ? `<div class="b-tile ${clue.used ? "used" : ""}" data-cat="${c}" data-row="${idx}">$${clue.value}</div>`
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
    ${wantFs && !fsElement() ? `<div class="fs-prompt">▶ Click this screen<br>(or press any key)<br>for true full screen</div>` : ""}
    <div class="timerbar-wrap" id="timerWrap"><div class="timerbar" id="timerBar"></div></div>`;

  document.getElementById("btnFS").onclick = goFullscreen;
  runTimerBar();
  renderCurtain();
  lastRenderedView = S.view;
  fitClue();                          // immediate best-effort (sizes text at full screen)
  if (flyFrom) startClueFly(flyFrom, flyBoardBg);   // ...then fly the sized clue in from the tile
  requestAnimationFrame(fitClue);     // correct once layout/fonts have settled (skipped while flying)
  setTimeout(fitClue, 250);           // backup in case fonts/layout settle later
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
  el.style.transition = "transform 1s linear";  // classic Jeopardy: constant velocity/scale, ~1s
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
  setTimeout(finish, 1400);                     // fallback (> the 1s flight) so it can never get stuck
}

/* The curtain is a persistent overlay (kept OUTSIDE #app, which is rebuilt on
   every render) so it can transition smoothly — the fade-to-black /
   fade-to-title / fade-back-to-game failsafes. Driven purely by S.stage: the
   control panel sets it and broadcasts, the display just reacts.

   Two stacked layers (title beneath, black on top) each fade their own opacity,
   so a fade TO black is ALWAYS smooth (black fades in over whatever's showing).
   The one exception the host asked for: black -> title is an instant cut. */
function renderCurtain() {
  const stage = S.stage || "game";
  let el = document.getElementById("dispCurtain");
  let firstTime = false;
  if (!el) {
    el = document.createElement("div");
    el.id = "dispCurtain";
    el.className = "disp-curtain";
    el.innerHTML = `<div class="curtain-title"></div><div class="curtain-black"></div>`;
    document.body.appendChild(el);
    firstTime = true;
  }
  const titleEl = el.querySelector(".curtain-title");
  const blackEl = el.querySelector(".curtain-black");
  const prev = el.dataset.stage || "game";
  if (stage === prev && !firstTime) return;          // no change -> don't restart a transition
  el.dataset.stage = stage;
  if (stage === "title") titleEl.innerHTML = welcomeHtml();
  // Everything fades (0.6s) EXCEPT: the very first paint (so a black deploy is a
  // clean slate, no fade-in over the game) and black -> title (an instant jump).
  const instant = firstTime || (prev === "black" && stage === "title");
  setCurtainLayer(titleEl, stage === "title" ? 1 : 0, instant);
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

/* ---------------- category intro (the "here are today's categories" reveal) ----
   Full-screen overlay, triggered by the control panel's Show Categories button.
   Holds a CATEGORIES title card for 3s, then shuffles each category (in board
   order) for ~1.75s apiece with a slide/scale/blur reveal, then fades to the
   board. Self-contained on the display; nothing further is broadcast. */
let introTimer = null;
function playCategoryIntro() {
  const r = currentRound();
  if (!r || !r.categories || !r.categories.length) return;
  if (introTimer) { clearTimeout(introTimer); introTimer = null; }
  const old = document.getElementById("catIntro"); if (old) old.remove();

  const cats = r.categories.map(c => c.name);
  const ov = document.createElement("div");
  ov.id = "catIntro"; ov.className = "cat-intro";
  // Persistent top banner + a slot the cards shuffle through. The banner stays
  // put while categories cycle, so it's always clear what's being shown.
  ov.innerHTML = `<div class="cat-intro-banner">CATEGORIES</div><div class="cat-intro-slot"></div>`;
  document.body.appendChild(ov);
  const slot = ov.querySelector(".cat-intro-slot");

  const TITLE_MS = 3000, CAT_MS = 2000, OUT_MS = 700;
  const steps = [{ kind: "title" }].concat(cats.map((name, i) => ({ kind: "cat", name, idx: i + 1, total: cats.length })));
  let i = 0;
  const step = () => {
    if (i >= steps.length) {                         // done — fade the overlay off, revealing the board
      ov.classList.add("cat-intro-out");
      introTimer = setTimeout(() => { ov.remove(); introTimer = null; }, OUT_MS);
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
  return `<div class="clue-full"><div class="clue-inner ${revealed ? "revealed" : ""} ${hasImg ? "has-image" : ""}">
    <div class="clue-cat">${esc(catLabel)}</div>
    ${hideQ ? "" : `<div class="clue-text" style="font-size:${size}">${fmtText(clue)}</div>`}
    ${imgHtml}
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

/* Toggle — wired to the F key and the ⛶ button. */
function goFullscreen() {
  if (fsElement()) {
    (document.exitFullscreen || document.webkitExitFullscreen || function () {}).call(document);
  } else {
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
  } catch (e) { /* blocked until a gesture — the listeners below handle that */ }
}

/* Make a fullscreen deploy actually enter fullscreen MODE (not just fill the
   desktop). Chrome won't let a normal site force fullscreen with zero gesture,
   so: (1) try immediately — succeeds only if the site is allow-listed via the
   AutomaticFullscreenAllowedForUrls policy; (2) otherwise the FIRST click or
   key anywhere in this window does it (a prompt says so). Broadened from just
   "F" so the host doesn't have to know the shortcut. */
function armAutoFullscreen() {
  wantFs = true;
  enterFullscreen();                     // zero-gesture best effort (works only if allow-listed)
  const go = (e) => {
    // ignore lone modifier keys so e.g. tabbing away doesn't count
    if (e && e.type === "keydown" && ["Shift", "Control", "Alt", "Meta", "CapsLock"].includes(e.key)) return;
    if (e) e.stopPropagation();          // don't also fire the ⛶ button / F toggle for this same event
    enterFullscreen();                   // a real click/key is a valid gesture, so this takes
    // finish() runs from fullscreenchange once we're actually in — so if a
    // request is somehow refused, the prompt stays up and the next click retries.
  };
  const finish = () => {
    document.removeEventListener("click", go, true);
    document.removeEventListener("keydown", go, true);
    if (wantFs) { wantFs = false; renderDisplay(); }
  };
  document.addEventListener("click", go, true);     // capture, so it beats the ⛶ button's own handler
  document.addEventListener("keydown", go, true);
  document.addEventListener("fullscreenchange", () => { if (fsElement()) finish(); });
  document.addEventListener("webkitfullscreenchange", () => { if (fsElement()) finish(); });
  renderDisplay();                       // show the prompt
}
