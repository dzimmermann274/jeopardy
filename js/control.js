"use strict";
/* ============================================================
   Control panel (host's laptop screen).
   Renders into #app; re-renders fully after every state change.
   HARD RULE: never render an answer unless S.revealed /
   S.finalRevealed is already true (the host plays too).

   In-progress form values (sheet link, DD team/wager, Final
   wagers) live in module-level "draft" variables so a re-render
   (e.g. a score adjustment) never wipes what the host typed.
   ============================================================ */

let displayWin = null;
let sheetBusy = false;
let sheetError = "";
let sheetUrlDraft = "";
let sheetReqToken = 0;                    // invalidates stale in-flight sheet loads
let ddDraft = { team: 0, wager: "" };     // Daily Double form draft
let finalWagerDrafts = null;              // array of strings, one per team
let liveAnswerDraft = "";                 // host-typed answer (UNKNOWN questions / overrides)
let liveAnswerOpen = false;               // keep the override <details> open across re-renders

/* Open (or reuse) the single display window. `geom` is an optional
   {left,top,width,height}; without it, a default 1280x720 popup. `wantFs` sets
   the fullscreen-intent flag so the window enters true fullscreen mode.

   The window's mode (fullscreen intent) and opening stage (black/title/game)
   ride in the URL hash so a freshly opened window boots straight into them —
   no flash of the game before a black deploy, no missed fullscreen. Reusing an
   existing window by name only changes the hash (no reload) and ignores the
   size/position, so we reposition it and force a reload to re-run that boot. */
function openDisplayWindow(geom, wantFs) {
  const reuse = displayLooksOpen();
  const feat = (geom && geom.left != null)
    ? `left=${geom.left},top=${geom.top},width=${geom.width},height=${geom.height}`
    : `width=${(geom && geom.width) || 1280},height=${(geom && geom.height) || 720}`;
  const stage = S.stage || "game";
  const hash = "#display" + (wantFs ? "&fs=1" : "") + (stage !== "game" ? "&stage=" + stage : "");
  const url = location.pathname + hash;
  displayWin = window.open(url, "ppiJeopardyDisplay", feat);
  if (displayWin) {
    if (reuse) {
      // Reused window: it only did a fragment change (no reload) and ignored the
      // size/position. Reposition it, point it at the new URL, then reload so the
      // boot code (fullscreen arming + the opening stage) actually runs again.
      try { if (geom && geom.left != null) { displayWin.moveTo(geom.left, geom.top); displayWin.resizeTo(geom.width, geom.height); } } catch (e) {}
      try { displayWin.location.href = url; displayWin.location.reload(); } catch (e) {}
    }
    try { displayWin.focus(); } catch (e) {}               // focus so the first key/click there triggers fullscreen
  }
  setTimeout(send, 600);  // give it a moment, then push state (it also says hello)
  return displayWin;
}
function openDisplay() { return openDisplayWindow(); }

function fillGeom(scr) { return { left: scr.availLeft, top: scr.availTop, width: scr.availWidth, height: scr.availHeight }; }
function centeredGeom(scr, w, h) {
  w = Math.min(w, scr.availWidth); h = Math.min(h, scr.availHeight);
  return { left: Math.round(scr.availLeft + (scr.availWidth - w) / 2), top: Math.round(scr.availTop + (scr.availHeight - h) / 2), width: w, height: h };
}

function displayLooksOpen() { return displayWin && !displayWin.closed; }

/* ---------------- multi-screen deploy (Chrome / Edge only) ----------------
   The Window Management API (getScreenDetails) lets us find the external
   display and place the game window on it. It exists only in Chromium browsers
   and only on a secure context (the live HTTPS site or localhost); everything
   here degrades gracefully to the main-screen options when it's absent. */
let screenDetailsCache = null;   // ScreenDetails once the host grants permission
let screensPermDenied = false;   // host dismissed the window-management prompt

const hasWindowMgmt = () => "getScreenDetails" in window;

/* Quick, permission-free check for a second display so we know whether to even
   show the external options. `screen.isExtended` needs no prompt. */
function extendedDisplayLikely() {
  try { return window.screen && window.screen.isExtended === true; }
  catch (e) { return false; }
}

/* Fetch (and cache) the full screen layout. MUST be called during a user
   gesture the first time — Chrome shows the "manage windows" prompt then. */
async function ensureScreenDetails() {
  if (screenDetailsCache) return screenDetailsCache;
  if (!hasWindowMgmt()) return null;
  try {
    const sd = await window.getScreenDetails();
    screenDetailsCache = sd;
    screensPermDenied = false;
    // A screen being (un)plugged mid-setup should refresh the dialog's options.
    if (sd.addEventListener) sd.addEventListener("screenschange", () => { if (screensOv) renderScreensDialog(); });
    return sd;
  } catch (e) {
    screensPermDenied = true;   // prompt denied or blocked by policy
    return null;
  }
}

/* The non-laptop screen: prefer the external one, else a non-primary one, else
   any screen that isn't the one the control panel is on. */
function externalScreenOf(sd) {
  if (!sd || !sd.screens) return null;
  const cur = sd.currentScreen;
  return sd.screens.find(s => s.isInternal === false)
      || sd.screens.find(s => s.isPrimary === false)
      || sd.screens.find(s => s !== cur)
      || null;
}
/* Set the display curtain (black / title / game) and broadcast it. Collect any
   typed team names first so re-rendering the setup screen never wipes them. */
function setStage(stage) { collectTeamNames(); update(() => { S.stage = stage; }); if (screensOv) renderScreensDialog(); }

/* A compact copy of the fade failsafes, shown directly on the control panel (in
   addition to the Display setup dialog) so they're always one click away. */
function failsafeBarHtml() {
  const open = displayLooksOpen();
  const stage = S.stage || "game";
  return `<div class="failsafe-bar">
    <span class="failsafe-label">Display failsafes</span>
    <button class="btn small ${stage === "title" ? "gold" : ""}" data-stage="title" ${open ? "" : "disabled"}>Fade to title</button>
    <button class="btn small ${stage === "black" ? "gold" : ""}" data-stage="black" ${open ? "" : "disabled"}>Fade to black</button>
    <button class="btn small ${stage === "game" ? "primary" : ""}" data-stage="game" ${open ? "" : "disabled"}>Show the game</button>
    ${open ? "" : `<span class="hint" style="margin-left:2px">open a display first</span>`}
  </div>`;
}
function wireFailsafeBar() {
  app.querySelectorAll("[data-stage]").forEach(b => b.onclick = () => setStage(b.dataset.stage));
}

/* Deploy the game onto the external display. `stage` is the curtain the new
   window opens with (use "black" for the safe black-first flow); `fullscreen`
   fills the whole screen and best-effort auto-fullscreens it. */
async function deployExternal({ fullscreen, stage }) {
  const sd = await ensureScreenDetails();
  const scr = externalScreenOf(sd);
  if (!scr) { if (screensOv) renderScreensDialog(); return; }
  collectTeamNames();
  update(() => { S.stage = stage || "game"; });   // set the opening stage before opening; it rides in the URL hash
  // A fullscreen deploy fills the external screen AND asks the window to enter
  // true fullscreen mode: instantly if this site is allow-listed for automatic
  // fullscreen, otherwise on the first click/key in that window (it shows a
  // prompt). Seamless with stage:"black" — only black is on screen meanwhile.
  openDisplayWindow(fullscreen ? fillGeom(scr) : centeredGeom(scr, 1280, 720), fullscreen);
  if (screensOv) renderScreensDialog();
}

function deployMain() {
  collectTeamNames();
  update(() => { S.stage = "game"; });
  openDisplayWindow();
  if (screensOv) renderScreensDialog();
}

/* Split view on the one laptop screen: put the display on the right half.
   (Browsers won't let a script move the control/main tab, so the host keeps
   the control panel on the left.) */
function deploySplitMain() {
  collectTeamNames();
  update(() => { S.stage = "game"; });
  let geom = { width: 800, height: 900 };
  try {
    const sc = window.screen;
    const w = Math.floor((sc.availWidth || 1440) / 2), h = sc.availHeight || 900;
    geom = { left: (sc.availLeft || 0) + w, top: (sc.availTop || 0), width: w, height: h };
  } catch (e) { /* use the fallback size */ }
  openDisplayWindow(geom);
  if (screensOv) renderScreensDialog();
}

/* ---------------- the "Display setup" dialog ----------------
   A persistent overlay kept OUTSIDE #app (like the other modals) so a control
   re-render never disturbs it. Button-only: opened from the "Display setup"
   button, never auto-popped. */
let screensOv = null;
function openScreensDialog() {
  if (screensOv) return;
  screensOv = document.createElement("div");
  screensOv.className = "modal-overlay";
  document.body.appendChild(screensOv);
  screensOv.onclick = (e) => { if (e.target === screensOv) closeScreensDialog(); };
  screensOv.__keyHandler = (e) => { if (e.key === "Escape") closeScreensDialog(); };
  document.addEventListener("keydown", screensOv.__keyHandler);
  renderScreensDialog();
  // A second screen is attached but we haven't asked for placement permission
  // yet — do it now while a click is active, so the external options light up.
  if (hasWindowMgmt() && extendedDisplayLikely() && !screenDetailsCache && !screensPermDenied) {
    ensureScreenDetails().then(() => { if (screensOv) renderScreensDialog(); });
  }
}
function closeScreensDialog() {
  if (!screensOv) return;
  document.removeEventListener("keydown", screensOv.__keyHandler);
  screensOv.remove();
  screensOv = null;
}

function renderScreensDialog() {
  if (!screensOv) return;
  const chrome = hasWindowMgmt();
  const extended = extendedDisplayLikely();
  const extScreen = externalScreenOf(screenDetailsCache);
  const displayOpen = displayLooksOpen();
  const stage = S.stage || "game";

  let externalHtml = "";
  if (extended) {
    if (extScreen) {
      const label = extScreen.label || "External display";
      externalHtml = `
      <div class="screens-section">
        <div class="sec-title">External display — ${esc(label)}</div>
        <div class="screens-btns">
          <button class="btn primary" data-act="ext-black">Deploy black, full screen, on the external display</button>
          <button class="btn" data-act="ext-full">Deploy the game, full screen, on the external display</button>
          <button class="btn" data-act="ext-normal">Deploy a normal window on the external display</button>
        </div>
        <p class="screens-note"><b>Recommended:</b> deploy <b>black full screen</b> first. The new window enters true full screen on the first click or key press (only black is showing), so no browser edges ever show — then <b>Fade to the title</b> or <b>Show the game</b> from the failsafes below.</p>
      </div>`;
    } else if (screensPermDenied) {
      externalHtml = `
      <div class="screens-section">
        <div class="sec-title">External display</div>
        <p class="screens-note">A second screen is connected, but this page needs permission to place a window on it.
          <button class="btn small" data-act="grant">Grant screen permission</button></p>
      </div>`;
    } else {
      externalHtml = `
      <div class="screens-section">
        <div class="sec-title">External display</div>
        <p class="screens-note">Detecting the external display…</p>
      </div>`;
    }
  }

  const mainHtml = `
    <div class="screens-section">
      <div class="sec-title">Main screen (this laptop)</div>
      <div class="screens-btns">
        <button class="btn" data-act="main-normal">Deploy on the main screen (normal window)</button>
        <button class="btn" data-act="main-split">Split: control panel + display side by side</button>
      </div>
    </div>`;

  const failHtml = `
    <div class="screens-section">
      <div class="sec-title">Failsafes ${displayOpen ? "" : "— open a display first"}</div>
      <div class="screens-btns">
        <button class="btn ${stage === "title" ? "gold" : ""}" data-act="fade-title" ${displayOpen ? "" : "disabled"}>Fade to the title screen</button>
        <button class="btn ${stage === "black" ? "gold" : ""}" data-act="fade-black" ${displayOpen ? "" : "disabled"}>Fade to black</button>
        <button class="btn ${stage === "game" ? "primary" : ""}" data-act="fade-game" ${displayOpen ? "" : "disabled"}>Show the game (fade back)</button>
      </div>
    </div>`;

  const noChrome = !chrome ? `<p class="screens-note">⚠️ Automatic external-display placement needs Google Chrome or Edge — the options below still work.</p>` : "";
  const noExt = (chrome && !extended) ? `<p class="screens-note">No external display detected. Connect a TV/projector as an <b>extended</b> display (not mirrored) to unlock the external-screen options.</p>` : "";

  screensOv.innerHTML = `
    <div class="modal-box screens-dialog">
      <div class="screens-head">
        <h3>Display setup</h3>
        <span class="status-pill"><span class="dot ${displayOpen ? "on" : ""}"></span>${displayOpen ? "Display open" : "No display yet"}</span>
      </div>
      ${noChrome}${noExt}
      ${externalHtml}
      ${mainHtml}
      ${failHtml}
      <div class="modal-btns" style="margin-top:18px"><button class="btn" data-act="close">Close</button></div>
    </div>`;

  screensOv.querySelectorAll("[data-act]").forEach(b => b.onclick = () => onScreensAct(b.dataset.act));
}

function onScreensAct(act) {
  switch (act) {
    case "close":      closeScreensDialog(); break;
    case "grant":      ensureScreenDetails().then(() => { if (screensOv) renderScreensDialog(); }); break;
    case "ext-black":  deployExternal({ fullscreen: true,  stage: "black" }); break;
    case "ext-full":   deployExternal({ fullscreen: true,  stage: "game"  }); break;
    case "ext-normal": deployExternal({ fullscreen: false, stage: "game"  }); break;
    case "main-normal": deployMain(); break;
    case "main-split":  deploySplitMain(); break;
    case "fade-title": setStage("title"); break;
    case "fade-black": setStage("black"); break;
    case "fade-game":  setStage("game");  break;
  }
}

/* ---------------- custom dialogs ----------------
   Chrome exits fullscreen whenever a native alert/confirm/prompt is shown
   (policy since Chrome 61). The TV window is fullscreen, so we must never
   trigger a native dialog. These in-page modals replace them. Each appends
   an overlay to <body> (outside #app), so a control re-render never disturbs
   an open dialog. */
function closeModal(ov, resolve, val) {
  document.removeEventListener("keydown", ov.__keyHandler);
  ov.remove();
  resolve(val);
}
function customConfirm(message, { okText = "Yes", cancelText = "Cancel", danger = false } = {}) {
  return new Promise(resolve => {
    const ov = document.createElement("div");
    ov.className = "modal-overlay";
    ov.innerHTML = `<div class="modal-box">
      <div class="modal-msg">${esc(message)}</div>
      <div class="modal-btns">
        <button class="btn" data-no>${esc(cancelText)}</button>
        <button class="btn ${danger ? "bad" : "primary"}" data-yes>${esc(okText)}</button>
      </div></div>`;
    document.body.appendChild(ov);
    ov.querySelector("[data-yes]").onclick = () => closeModal(ov, resolve, true);
    ov.querySelector("[data-no]").onclick = () => closeModal(ov, resolve, false);
    ov.onclick = (e) => { if (e.target === ov) closeModal(ov, resolve, false); };
    ov.__keyHandler = (e) => {
      if (e.key === "Escape") closeModal(ov, resolve, false);
      else if (e.key === "Enter") closeModal(ov, resolve, true);
    };
    document.addEventListener("keydown", ov.__keyHandler);
    ov.querySelector("[data-yes]").focus();
  });
}
function customPrompt(message, defaultValue = "") {
  return new Promise(resolve => {
    const ov = document.createElement("div");
    ov.className = "modal-overlay";
    ov.innerHTML = `<div class="modal-box">
      <div class="modal-msg">${esc(message)}</div>
      <input type="text" class="modal-input" value="${esc(defaultValue)}">
      <div class="modal-btns">
        <button class="btn" data-no>Cancel</button>
        <button class="btn primary" data-yes>OK</button>
      </div></div>`;
    document.body.appendChild(ov);
    const input = ov.querySelector(".modal-input");
    ov.querySelector("[data-yes]").onclick = () => closeModal(ov, resolve, input.value);
    ov.querySelector("[data-no]").onclick = () => closeModal(ov, resolve, null);
    ov.onclick = (e) => { if (e.target === ov) closeModal(ov, resolve, null); };
    ov.__keyHandler = (e) => {
      if (e.key === "Escape") closeModal(ov, resolve, null);
      else if (e.key === "Enter") closeModal(ov, resolve, input.value);
    };
    document.addEventListener("keydown", ov.__keyHandler);
    input.focus(); input.select();
  });
}
function customAlert(message) {
  return new Promise(resolve => {
    const ov = document.createElement("div");
    ov.className = "modal-overlay";
    ov.innerHTML = `<div class="modal-box">
      <div class="modal-msg">${esc(message)}</div>
      <div class="modal-btns"><button class="btn primary" data-ok>OK</button></div></div>`;
    document.body.appendChild(ov);
    ov.querySelector("[data-ok]").onclick = () => closeModal(ov, resolve, undefined);
    ov.onclick = (e) => { if (e.target === ov) closeModal(ov, resolve, undefined); };
    ov.__keyHandler = (e) => { if (e.key === "Escape" || e.key === "Enter") closeModal(ov, resolve, undefined); };
    document.addEventListener("keydown", ov.__keyHandler);
    ov.querySelector("[data-ok]").focus();
  });
}

function otherControlBannerHtml() {
  if (!otherControlDetected) return "";
  return `<div class="setup-err" style="margin-bottom:16px">⚠️ <b>Another control-panel tab is already open.</b>
    Two control panels fight over the TV and the saved game — close this tab and keep using the original one.</div>`;
}

function renderControl() {
  if (IS_DISPLAY) return;
  document.body.className = "control";
  if (S.phase === "setup") return renderSetup();
  return renderPlay();
}

/* Read the team-name inputs on the setup screen back into S.teams. Safe to call
   anytime — a no-op when those inputs aren't on screen (e.g. during play), so
   the deploy/curtain actions can call it before re-rendering without harm. */
function collectTeamNames() {
  const inputs = app.querySelectorAll("[data-team]");
  if (!inputs.length) return;
  S.teams = [...inputs].map(inp => {
    const idx = +inp.dataset.team;
    return {
      name: inp.value.trim() || "Team " + (idx + 1),
      players: (S.teams[idx] && S.teams[idx].players) || [],
      score: (S.teams[idx] ? S.teams[idx].score : 0),
    };
  });
}

/* ---------------- setup screen ---------------- */
function renderSetup() {
  const teamsDraft = S.teams.length ? S.teams : [{ name: "Team 1", score: 0 }, { name: "Team 2", score: 0 }, { name: "Team 3", score: 0 }];
  const savedGame = loadSavedGame();
  app.innerHTML = `
  <div class="ctl-wrap">
    <div class="ctl-header">
      <h1>🎯 Jeopardy <span>Control Panel</span></h1>
      <span class="status-pill"><span class="dot ${displayLooksOpen() ? "on" : ""}"></span>
        Display window ${displayLooksOpen() ? "open" : "not open yet"}</span>
    </div>
    ${otherControlBannerHtml()}

    ${savedGame ? `
    <div class="card">
      <h2>Game in progress</h2>
      <p class="hint">A previous game was interrupted (scores and board progress were saved).</p>
      <div class="field-row">
        <button class="btn primary" id="btnResume">Resume that game ▶</button>
        <button class="btn" id="btnDiscardSave">Discard it</button>
      </div>
    </div>` : ""}

    <div class="card">
      <h2>Step 1 — Load the questions</h2>
      <div class="field-row">
        <input type="text" id="sheetUrl" placeholder="Paste the Google Sheets link here (the question-writer sends you this)"
               value="${esc(sheetUrlDraft)}">
        <button class="btn primary" id="btnLoadSheet" ${sheetBusy ? "disabled" : ""}>${sheetBusy ? "Loading…" : "Load from Google Sheets"}</button>
      </div>
      <div class="field-row">
        <button class="btn" id="btnSample">Or use the built-in sample game (to try it out)</button>
      </div>
      ${sheetError ? `<div class="setup-err">⚠️ ${esc(sheetError)}</div>` : ""}
      ${S.game ? `<div class="setup-note">✅ Loaded: <b>${esc(S.game.title)}</b> —
          ${S.game.rounds.map(r => `${r.categories.length} categories / ${r.categories.reduce((n, c) => n + c.clues.length, 0)} questions`).join(", ")}
          ${S.game.final ? " + Final Jeopardy" : ""}${S.game.teams && S.game.teams.length ? `, teams: ${S.game.teams.map(t => esc(t.name)).join(", ")}` : ""}.
          <b>Answers stay hidden from this screen until you reveal them on the display.</b></div>` : ""}
      ${S.game && S.game.warnings && S.game.warnings.length ? `<div class="setup-err">⚠️ Heads up:<br>${S.game.warnings.map(esc).join("<br>")}</div>` : ""}
      <details>
        <summary>How does the question-writer make the sheet? (click for instructions)</summary>
        <div class="hint">
          <p>Send the question-writer a copy of the <b>“Jeopardy Questions”</b> workbook (it lives in the host's
          Google Drive — open it and use <b>File → Make a copy</b> to hand one out per game). Everything they need
          to know is on its 📖 READ ME FIRST tab, in short:</p>
          <p style="margin-top:8px">
          • Write every question in the <b>🗂 Question Bank</b> tab — each row has an ID number. Answer <b>UNKNOWN</b> = you'll type the answer live during the game.<br>
          • Optional pictures: paste links in the <b>🖼 Image Bank</b>, then put the Image ID next to a question.<br>
          • Every colored tab = one category; <b>rename the tab</b> to name the category, then just type Question IDs next to the dollar amounts — the rest fills in automatically.<br>
          • Blank row = that tile won't appear; untouched tab = that category won't appear.<br>
          • The ⚙️ Game Setup tab holds the game title, team names, players, and an optional Final Jeopardy.<br>
          • When done: <b>Share → Anyone with the link → Viewer</b>, copy the link, send it to you. You paste it above — <b>never open the sheet yourself!</b></p>
        </div>
      </details>
    </div>

    <div class="card">
      <h2>Step 2 — Teams</h2>
      <div id="teamSetup">
        ${teamsDraft.map((t, i) => `
          <div class="field-row">
            <input type="text" data-team="${i}" value="${esc(t.name)}" placeholder="Team name">
            <button class="btn small" data-delteam="${i}">Remove</button>
          </div>
          ${t.players && t.players.length ? `<p class="hint" style="margin:-4px 0 8px 4px">👥 ${esc(t.players.join(", "))} <span style="opacity:.7">(from the sheet — edit players there)</span></p>` : ""}`).join("")}
      </div>
      <button class="btn small" id="btnAddTeam">+ Add team</button>
    </div>

    <div class="card">
      <h2>Step 3 — Screens</h2>
      <p class="hint">Use <b>Display setup</b> for one-click options — deploy straight onto an external display,
      the safe black-screen-first flow, a split view, and the fade failsafes. Or open a plain window and drag it
      onto the TV yourself, then press <b>F</b> (or click ⛶) to go fullscreen.</p>
      <div class="field-row" style="margin-top:12px">
        <button class="btn" id="btnScreens">Display setup</button>
        <button class="btn" id="btnOpenDisplay">Open display window</button>
        <button class="btn primary" id="btnStart" ${S.game ? "" : "disabled"}>Start the game ▶</button>
      </div>
      ${failsafeBarHtml()}
      ${S.game ? "" : `<p class="hint">Load questions first to enable Start.</p>`}
    </div>
  </div>`;

  const bResume = document.getElementById("btnResume");
  if (bResume) bResume.onclick = () => {
    const sg = loadSavedGame();
    if (sg) { sg.stage = "game"; update(() => { S = sg; }); }   // resume showing the game, never a leftover curtain
  };
  const bDiscard = document.getElementById("btnDiscardSave");
  if (bDiscard) bDiscard.onclick = () => { clearSavedGame(); renderControl(); };

  document.getElementById("btnSample").onclick = () => {
    sheetError = "";
    collectTeamNames();
    ++sheetReqToken;               // invalidate any in-flight sheet load
    update(() => { S.game = JSON.parse(JSON.stringify(SAMPLE_GAME)); });
  };
  document.getElementById("sheetUrl").oninput = (e) => { sheetUrlDraft = e.target.value; };
  document.getElementById("btnLoadSheet").onclick = async () => {
    const val = document.getElementById("sheetUrl").value;
    sheetUrlDraft = val;
    collectTeamNames();
    const tok = ++sheetReqToken;
    sheetBusy = true; sheetError = ""; renderControl();
    try {
      const game = await loadSheet(val);
      if (tok !== sheetReqToken || S.phase !== "setup") return;  // stale response — a newer action superseded it
      sheetBusy = false;
      update(() => {
        S.game = game;
        // the sheet's Game Setup tab wins: prefill teams (still editable below)
        if (game.teams && game.teams.length) {
          S.teams = game.teams.map(t => ({ name: t.name, players: t.players || [], score: 0 }));
        }
      });
    } catch (e) {
      if (tok !== sheetReqToken || S.phase !== "setup") return;
      sheetBusy = false; sheetError = e.message; renderControl();
    }
  };
  document.getElementById("btnAddTeam").onclick = () => {
    collectTeamNames();
    update(() => { S.teams.push({ name: "Team " + (S.teams.length + 1), score: 0 }); });
  };
  app.querySelectorAll("[data-delteam]").forEach(b => b.onclick = () => {
    collectTeamNames();
    const i = +b.dataset.delteam;
    update(() => { S.teams.splice(i, 1); });
  });
  document.getElementById("btnScreens").onclick = () => { collectTeamNames(); openScreensDialog(); };
  document.getElementById("btnOpenDisplay").onclick = () => { collectTeamNames(); openDisplay(); renderControl(); };
  wireFailsafeBar();
  document.getElementById("btnStart").onclick = () => {
    collectTeamNames();
    ++sheetReqToken;               // a game is starting; drop any pending sheet load
    finalWagerDrafts = null;
    update(() => {
      if (!S.teams.length) S.teams = [{ name: "Team 1", players: [], score: 0 }, { name: "Team 2", players: [], score: 0 }];
      S.phase = "play"; S.view = "board"; S.roundIdx = 0;
      S.finalWagers = S.teams.map(() => 0);
    });
  };
}

/* ---------------- play screen ---------------- */
function renderPlay() {
  const r = currentRound();
  const cl = activeClue();
  const inClue = S.view === "clue" || S.view === "dd";
  const isDD = cl && cl.dd && S.dd;
  const isFinal = S.view === "final-category" || S.view === "final-clue";
  const isWinner = S.view === "winner";

  let mainHtml = "";
  if (isWinner) {
    const champs = winnersOf(S.teams);
    const tie = champs.length > 1;
    mainHtml = `<div class="card"><h2>🏆 ${tie ? "It's a tie — on the TV now" : "Winner — on the TV now"}</h2>
      <p class="hint">${tie ? "Tied at the top: " : "Champion: "}<b>${champs.map(t => esc(t.name)).join(", ")}</b> with ${money(champs.length ? champs[0].score : 0)}.
      Click "◀ Back to game" above to keep playing, or "⟲ New game" to start over.</p></div>`;
  }
  else if (isFinal) mainHtml = finalControlHtml();
  else if (inClue && cl) mainHtml = clueControlHtml(cl, isDD);
  else if (S.view === "bigscores") mainHtml = `<div class="card"><h2>Scores are on the TV</h2>
    <p class="hint">Click "Back to game" above to return to where you were.</p></div>`;
  else mainHtml = boardControlHtml(r);

  app.innerHTML = `
  <div class="ctl-wrap">
    <div class="ctl-header">
      <h1>🎯 ${esc(S.game && S.game.title ? S.game.title : "Jeopardy")} <span>Control Panel</span></h1>
      <div class="ctl-toolbar">
        <span class="status-pill"><span class="dot ${displayLooksOpen() ? "on" : ""}"></span>Display</span>
        <button class="btn small" id="btnReopenDisplay">Open display</button>
        <button class="btn small" id="btnScreens">Display setup</button>
        ${isWinner
          ? `<button class="btn small" id="btnWinnerBack">◀ Back to game</button>`
          : `<button class="btn small" id="btnShowScores">${S.view === "bigscores" ? "◀ Back to game" : "Show scores on TV"}</button>
        ${S.game.rounds.length > S.roundIdx + 1 && !isFinal ? `<button class="btn small" id="btnNextRound">Next round →</button>` : ""}
        ${S.game.final && !isFinal && S.view !== "bigscores" ? `<button class="btn small gold" id="btnFinal">Final Jeopardy</button>` : ""}
        <button class="btn small gold" id="btnAnnounceWinner">🏆 Announce winner</button>`}
        <button class="btn small" id="btnReset">⟲ New game</button>
      </div>
    </div>
    ${otherControlBannerHtml()}
    ${failsafeBarHtml()}
    ${mainHtml}
    <div class="card">
      <h2>Scores</h2>
      <div class="teams-grid">
        ${S.teams.map((t, i) => `
          <div class="team-card">
            <div class="tname">${esc(t.name)}</div>
            <div class="tscore ${t.score < 0 ? "neg" : ""}">${money(t.score)}</div>
            <div class="team-controls">
              <button class="btn small" data-adj="${i}:100">+100</button>
              <button class="btn small" data-adj="${i}:-100">−100</button>
              <button class="btn small" data-editscore="${i}">Set…</button>
            </div>
          </div>`).join("")}
      </div>
    </div>
  </div>`;

  document.getElementById("btnReopenDisplay").onclick = () => { openDisplay(); renderControl(); };
  document.getElementById("btnScreens").onclick = () => openScreensDialog();
  wireFailsafeBar();
  const bScores = document.getElementById("btnShowScores");
  if (bScores) bScores.onclick = () =>
    update(() => {
      if (S.view === "bigscores") { S.view = S.prevView || "board"; S.prevView = null; }
      else { S.prevView = S.view; S.view = "bigscores"; }
    });
  const bWinnerBack = document.getElementById("btnWinnerBack");
  if (bWinnerBack) bWinnerBack.onclick = () =>
    update(() => { S.view = S.winnerPrev || "board"; S.winnerPrev = null; });
  const bAnnounce = document.getElementById("btnAnnounceWinner");
  if (bAnnounce) bAnnounce.onclick = () => {
    customConfirm("Announce the winner? The final results will appear on the TV.", { okText: "Announce 🏆" })
      .then(ok => { if (ok) update(() => {
        // remember where we were (its own slot, so it never clobbers bigscores' return view)
        S.winnerPrev = S.view === "winner" ? "board" : S.view;
        S.view = "winner"; S.timer = null;
      }); });
  };
  const nx = document.getElementById("btnNextRound");
  if (nx) nx.onclick = () => {
    const cur = currentRound();
    const msg = roundDone(cur) ? "Move on to the next round?" : "Some clues haven't been played yet. Move on to the next round anyway?";
    customConfirm(msg).then(ok => { if (ok) update(() => {
      S.roundIdx++; S.view = "board"; S.prevView = null;
      S.active = null; S.revealed = false; S.dd = null; S.awarded = {}; S.timer = null;
    }); });
  };
  const fj = document.getElementById("btnFinal");
  if (fj) fj.onclick = () => {
    customConfirm("Start Final Jeopardy? (The category will appear on the TV.)").then(ok => {
      if (!ok) return;
      liveAnswerDraft = "";
      update(() => {
        S.view = "final-category"; S.prevView = null;
        S.finalRevealed = false; S.finalAwarded = {};
        S.active = null; S.dd = null; S.awarded = {}; S.timer = null;
        if (!Array.isArray(S.finalWagers) || S.finalWagers.length !== S.teams.length) {
          S.finalWagers = S.teams.map(() => 0);
        }
      });
    });
  };
  document.getElementById("btnReset").onclick = () => {
    customConfirm("Start over completely? Scores and board progress will be erased.", { okText: "New game", danger: true }).then(ok => {
      if (!ok) return;
      clearSavedGame();
      finalWagerDrafts = null;
      update(() => { S = freshState(); });
    });
  };
  app.querySelectorAll("[data-adj]").forEach(b => b.onclick = () => {
    const [i, d] = b.dataset.adj.split(":").map(Number);
    update(() => { S.teams[i].score += d; });
  });
  app.querySelectorAll("[data-editscore]").forEach(b => b.onclick = () => {
    const i = +b.dataset.editscore;
    customPrompt("New score for " + S.teams[i].name + ":", String(S.teams[i].score)).then(v => {
      if (v !== null && v.trim() !== "" && !isNaN(+v)) update(() => { S.teams[i].score = Math.round(+v); });
    });
  });

  wireMain();

  function wireMain() {
    app.querySelectorAll("[data-pick]").forEach(b => b.onclick = () => {
      const [c, row] = b.dataset.pick.split(":").map(Number);
      const clue = r.categories[c].clues[row];
      const openClue = () => {
        ddDraft = { team: 0, wager: "" };
        liveAnswerDraft = ""; liveAnswerOpen = false;
        window.__imgErrorSrc = null;
        update(() => {
          S.active = { cat: c, row };
          S.revealed = false;
          S.awarded = {};
          S.timer = null;
          if (clue.dd) { S.view = "dd"; S.dd = { teamIdx: null, wager: null }; }
          else { S.view = "clue"; S.dd = null; }
        });
      };
      // Used clues stay clickable, but warn first so one isn't re-shown by accident.
      if (clue.used) {
        customConfirm("This question has already been shown. Show it again anyway?",
          { okText: "Show it again", cancelText: "Cancel" }).then(ok => { if (ok) openClue(); });
      } else {
        openClue();
      }
    });
    const bReveal = document.getElementById("btnReveal");
    if (bReveal) bReveal.onclick = () => update(() => { S.revealed = true; S.timer = null; });
    const bBack = document.getElementById("btnBack");
    if (bBack) bBack.onclick = () => {
      liveAnswerDraft = ""; liveAnswerOpen = false;
      update(() => {
        const c = activeClue(); if (c) c.used = true;
        S.view = "board"; S.active = null; S.revealed = false; S.dd = null; S.awarded = {}; S.timer = null;
      });
    };
    /* live-typed answers (UNKNOWN questions, or overriding a preset one) */
    const liveInp = document.getElementById("liveAnswer");
    if (liveInp) liveInp.oninput = (e) => { liveAnswerDraft = e.target.value; };
    const liveDet = document.querySelector("details.live-answer-details");
    if (liveDet) liveDet.ontoggle = () => { liveAnswerOpen = liveDet.open; };
    const bLive = document.getElementById("btnLiveReveal");
    if (bLive) bLive.onclick = () => {
      const txt = liveAnswerDraft.trim();
      if (!txt) { customAlert("Type the answer first."); return; }
      update(() => {
        const c = activeClue(); if (!c) return;
        c.answer = txt; c.unknown = false;
        S.revealed = true; S.timer = null;
      });
    };
    const bFinalLive = document.getElementById("btnFinalLiveReveal");
    if (bFinalLive) bFinalLive.onclick = () => {
      const txt = liveAnswerDraft.trim();
      if (!txt) { customAlert("Type the answer first."); return; }
      update(() => {
        S.game.final.answer = txt; S.game.final.unknown = false;
        S.finalRevealed = true;
      });
    };
    const finalLiveInp = document.getElementById("finalLiveAnswer");
    if (finalLiveInp) finalLiveInp.oninput = (e) => { liveAnswerDraft = e.target.value; };
    const bTimer = document.getElementById("btnTimer");
    if (bTimer) bTimer.onclick = () => update(() => {
      S.timer = S.timer ? null : { startedAt: Date.now(), seconds: 30 };
    });
    app.querySelectorAll("[data-award]").forEach(b => b.onclick = () => {
      const [i, sign] = b.dataset.award.split(":");
      const c = activeClue(); if (!c) return;
      if (S.awarded[i]) return;                       // already scored this clue — use Undo first
      const amount = S.dd && S.dd.wager != null ? S.dd.wager : c.value;
      update(() => {
        S.awarded[i] = sign;
        S.teams[+i].score += (sign === "+" ? amount : -amount);
      });
    });
    app.querySelectorAll("[data-unaward]").forEach(b => b.onclick = () => {
      const i = b.dataset.unaward;
      const c = activeClue(); if (!c || !S.awarded[i]) return;
      const amount = S.dd && S.dd.wager != null ? S.dd.wager : c.value;
      update(() => {
        S.teams[+i].score -= (S.awarded[i] === "+" ? amount : -amount);
        delete S.awarded[i];
      });
    });
    /* daily double controls */
    const ddTeamSel = document.getElementById("ddTeam");
    if (ddTeamSel) ddTeamSel.onchange = (e) => { ddDraft.team = +e.target.value; };
    const ddWagerInp = document.getElementById("ddWager");
    if (ddWagerInp) ddWagerInp.oninput = (e) => { ddDraft.wager = e.target.value; };
    const ddGo = document.getElementById("btnDDGo");
    if (ddGo) ddGo.onclick = () => {
      const w = Math.round(+ddDraft.wager);
      if (String(ddDraft.wager).trim() === "" || isNaN(w) || w < 0) { customAlert("Enter a wager amount."); return; }
      update(() => { S.dd = { teamIdx: ddDraft.team, wager: w }; S.view = "clue"; });
    };
    /* final jeopardy controls */
    app.querySelectorAll("[data-fwager]").forEach(inp => inp.oninput = (e) => {
      if (finalWagerDrafts) finalWagerDrafts[+inp.dataset.fwager] = e.target.value;
    });
    const fShow = document.getElementById("btnFinalClue");
    if (fShow) fShow.onclick = () => {
      const wagers = (finalWagerDrafts || []).map(v => Math.max(0, Math.round(+v) || 0));
      while (wagers.length < S.teams.length) wagers.push(0);
      update(() => { S.finalWagers = wagers; S.view = "final-clue"; S.finalRevealed = false; S.finalAwarded = {}; });
    };
    const fReveal = document.getElementById("btnFinalReveal");
    if (fReveal) fReveal.onclick = () => update(() => { S.finalRevealed = true; });
    app.querySelectorAll("[data-faward]").forEach(b => b.onclick = () => {
      const [i, sign] = b.dataset.faward.split(":");
      if (S.finalAwarded[i]) return;
      const w = S.finalWagers[+i] || 0;
      update(() => {
        S.finalAwarded[i] = sign;
        S.teams[+i].score += (sign === "+" ? w : -w);
      });
    });
    app.querySelectorAll("[data-funaward]").forEach(b => b.onclick = () => {
      const i = b.dataset.funaward;
      if (!S.finalAwarded[i]) return;
      const w = S.finalWagers[+i] || 0;
      update(() => {
        S.teams[+i].score -= (S.finalAwarded[i] === "+" ? w : -w);
        delete S.finalAwarded[i];
      });
    });
    const fDone = document.getElementById("btnFinalDone");
    if (fDone) fDone.onclick = () => update(() => { S.view = "bigscores"; S.prevView = null; });
  }
}

/* The board mirrors the sheet: rows are the dollar values that exist in the
   data, and a tile only exists where that category has a filled-in question.
   A value can appear twice in one category (writer typo) — emit one board
   row per occurrence so no question becomes unreachable. */
function roundValueRows(r) {
  const maxCount = new Map();
  r.categories.forEach(c => {
    const seen = new Map();
    c.clues.forEach(cl => seen.set(cl.value, (seen.get(cl.value) || 0) + 1));
    seen.forEach((n, v) => { if (n > (maxCount.get(v) || 0)) maxCount.set(v, n); });
  });
  const rows = [];
  [...maxCount.keys()].sort((a, b) => a - b).forEach(v => {
    for (let occ = 0; occ < maxCount.get(v); occ++) rows.push({ value: v, occ });
  });
  return rows;
}

/* Index of the occ-th clue with this value in a category, or -1. */
function clueIndexAt(cat, value, occ) {
  let seen = 0;
  for (let i = 0; i < cat.clues.length; i++) {
    if (cat.clues[i].value === value) { if (seen === occ) return i; seen++; }
  }
  return -1;
}

function boardControlHtml(r) {
  if (!r) return `<div class="card"><h2>No round data</h2></div>`;
  const nCats = r.categories.length;
  const rows = roundValueRows(r);
  let cells = r.categories.map(c => `<div class="mini-cat">${esc(c.name)}</div>`).join("");
  for (const row of rows) {
    for (let c = 0; c < nCats; c++) {
      const idx = clueIndexAt(r.categories[c], row.value, row.occ);
      if (idx === -1) { cells += `<div class="mini-tile gap"></div>`; continue; }
      const clue = r.categories[c].clues[idx];
      // Used tiles stay clickable (re-show with a warning) — no `disabled`.
      cells += `<button class="mini-tile ${clue.used ? "used" : ""} ${clue.dd && !clue.used ? "dd" : ""}"
        ${clue.used ? `title="Already shown — click to show again"` : ""} data-pick="${c}:${idx}">$${clue.value}</button>`;
    }
  }
  return `
  <div class="card">
    <h2>Board — click a clue to put it on the TV</h2>
    <div class="mini-board" style="grid-template-columns: repeat(${nCats}, 1fr)">${cells}</div>
    <p class="hint" style="margin-top:8px">• marks a Daily Double — only you can see that. Blank spots are questions that weren't filled in on the sheet.</p>
  </div>`;
}

function awardRowHtml(teamIdx, name, amount, awardedSign) {
  if (awardedSign) {
    const applied = awardedSign === "+" ? `+${money(amount)}` : `−${money(amount)}`;
    return `<div class="award-row">
      <span class="aw-name">${esc(name)}</span>
      <span class="hint">${awardedSign === "+" ? "✓ scored " : "✗ scored "}${applied}</span>
      <button class="btn small" data-unaward="${teamIdx}">Undo</button>
    </div>`;
  }
  return `<div class="award-row">
    <span class="aw-name">${esc(name)}</span>
    <button class="btn good small" data-award="${teamIdx}:+">✓ Right (+${money(amount)})</button>
    <button class="btn bad small" data-award="${teamIdx}:-">✗ Wrong (−${money(amount)})</button>
  </div>`;
}

function clueControlHtml(cl, isDD) {
  if (S.view === "dd") {
    return `
    <div class="card">
      <h2>💰 Daily Double! — ${esc(activeCatName())}</h2>
      <p class="hint">The splash is on the TV. Pick which team found it and their wager, then show the clue.</p>
      <div class="field-row" style="align-items:center">
        <select id="ddTeam">
          ${S.teams.map((t, i) => `<option value="${i}" ${i === ddDraft.team ? "selected" : ""}>${esc(t.name)}</option>`).join("")}
        </select>
        <input type="number" id="ddWager" class="wager-input" placeholder="Wager ($)" min="0" step="100" value="${esc(ddDraft.wager)}">
        <button class="btn primary" id="btnDDGo">Show the clue ▶</button>
      </div>
      <p class="hint">House rules: they can wager up to their score (or up to the highest value on the board if they're behind).</p>
    </div>`;
  }
  const amount = S.dd && S.dd.wager != null ? S.dd.wager : cl.value;
  const ddTeam = S.dd && S.dd.teamIdx != null ? S.teams[S.dd.teamIdx] : null;
  let answerHtml;
  if (S.revealed) {
    answerHtml = `<div class="answer-shown">✅ Answer (now on the TV): &nbsp;${fmtText(cl.answer)}</div>`;
  } else if (cl.unknown) {
    answerHtml = `
    <div class="live-answer">
      <b>✍️ This question has no preset answer — you type it live.</b>
      <p class="hint" style="margin:6px 0 2px">When the answer is decided, type it below and release it to the TV for everyone at once.</p>
      <div class="field-row">
        <input type="text" id="liveAnswer" placeholder="Type the answer…" value="${esc(liveAnswerDraft)}">
        <button class="btn gold" id="btnLiveReveal">Release answer to TV ▶</button>
      </div>
    </div>`;
  } else {
    answerHtml = `
    <div class="answer-hidden">🙈 The answer is hidden — from you too, so you can play! Click "Reveal answer" to show it on the TV for everyone at once.</div>
    <details class="live-answer-details" ${liveAnswerOpen ? "open" : ""}>
      <summary>✏️ Type a different answer instead…</summary>
      <div class="field-row" style="margin-top:8px">
        <input type="text" id="liveAnswer" placeholder="Type the answer to reveal…" value="${esc(liveAnswerDraft)}">
        <button class="btn small gold" id="btnLiveReveal">Reveal typed answer on TV</button>
      </div>
      <p class="hint">This replaces the sheet's answer for this question.</p>
    </details>`;
  }
  return `
  <div class="card">
    <h2>${isDD || ddTeam ? "💰 Daily Double" : "Clue"} — ${esc(activeCatName())} for ${money(amount)}</h2>
    <div class="clue-box">
      <div class="label">On the TV right now</div>
      <div class="cluetext">${fmtText(cl.clue)}</div>
      ${cl.image ? (window.__imgErrorSrc === cl.image
        ? `<p class="hint" style="margin-top:8px;color:#ff9b9b">📷⚠️ The picture FAILED to load on the TV — describe it aloud, or skip this one.</p>`
        : `<p class="hint" style="margin-top:8px">📷 This question has a picture — it's on the TV under the clue.</p>`) : ""}
    </div>
    ${answerHtml}
    <div class="field-row">
      ${S.revealed ? "" : `${cl.unknown ? "" : `<button class="btn gold" id="btnReveal">Reveal answer on TV</button>`}
      <button class="btn" id="btnTimer">${S.timer ? "✖ Cancel timer" : "⏱ 30-second timer"}</button>`}
      <button class="btn primary" id="btnBack">Done — back to board</button>
    </div>
    ${S.revealed ? `
    <h2 style="margin-top:16px">Award points ${ddTeam ? "(wager: " + money(amount) + ")" : "(" + money(amount) + ")"}</h2>
    ${(ddTeam ? [S.dd.teamIdx] : S.teams.map((_, i) => i)).map((i) =>
      awardRowHtml(i, S.teams[i].name, amount, S.awarded[i])
    ).join("")}` : ""}
  </div>`;
}

function finalControlHtml() {
  const f = S.game.final;
  if (S.view === "final-category") {
    if (!finalWagerDrafts || finalWagerDrafts.length !== S.teams.length) {
      finalWagerDrafts = S.teams.map((_, i) => S.finalWagers[i] ? String(S.finalWagers[i]) : "");
    }
    return `
    <div class="card">
      <h2>🏁 Final Jeopardy — category is on the TV: "${esc(f.category)}"</h2>
      <p class="hint">Each team writes a wager on paper (up to their score). Enter the wagers here, then show the clue.
      If you're playing, have someone else check that wagers don't exceed scores!</p>
      ${S.teams.map((t, i) => `
        <div class="award-row">
          <span class="aw-name">${esc(t.name)} (${money(t.score)})</span>
          <input type="number" data-fwager="${i}" min="0" step="100" placeholder="Wager ($)"
            value="${esc(finalWagerDrafts[i])}">
        </div>`).join("")}
      <div class="field-row"><button class="btn primary" id="btnFinalClue">Show the Final Jeopardy clue ▶</button></div>
    </div>`;
  }
  let fAnswerHtml;
  if (S.finalRevealed) {
    fAnswerHtml = `<div class="answer-shown">✅ Answer (now on the TV): &nbsp;${fmtText(f.answer)}</div>`;
  } else if (f.unknown) {
    fAnswerHtml = `
    <div class="live-answer">
      <b>✍️ Final Jeopardy has no preset answer — you type it live.</b>
      <div class="field-row" style="margin-top:8px">
        <input type="text" id="finalLiveAnswer" placeholder="Type the answer…" value="${esc(liveAnswerDraft)}">
        <button class="btn gold" id="btnFinalLiveReveal">Release answer to TV ▶</button>
      </div>
    </div>`;
  } else {
    fAnswerHtml = `<div class="answer-hidden">🙈 Answer hidden. Teams write their answers on paper (play the think music!), then reveal.</div>`;
  }
  return `
  <div class="card">
    <h2>🏁 Final Jeopardy — ${esc(f.category)}</h2>
    <div class="clue-box"><div class="label">On the TV right now</div><div class="cluetext">${fmtText(f.clue)}</div></div>
    ${fAnswerHtml}
    <div class="field-row">
      ${S.finalRevealed || f.unknown ? "" : `<button class="btn gold" id="btnFinalReveal">Reveal answer on TV</button>`}
    </div>
    ${S.finalRevealed ? `
      <h2 style="margin-top:16px">Score the wagers</h2>
      ${S.teams.map((t, i) => {
        const w = S.finalWagers[i] || 0;
        if (S.finalAwarded[i]) {
          const applied = S.finalAwarded[i] === "+" ? `+${money(w)}` : `−${money(w)}`;
          return `<div class="award-row">
            <span class="aw-name">${esc(t.name)} — wagered ${money(w)}</span>
            <span class="hint">${S.finalAwarded[i] === "+" ? "✓ scored " : "✗ scored "}${applied}</span>
            <button class="btn small" data-funaward="${i}">Undo</button>
          </div>`;
        }
        return `<div class="award-row">
          <span class="aw-name">${esc(t.name)} — wagered ${money(w)}</span>
          <button class="btn good small" data-faward="${i}:+">✓ Right</button>
          <button class="btn bad small" data-faward="${i}:-">✗ Wrong</button>
        </div>`;
      }).join("")}
      <div class="field-row"><button class="btn primary" id="btnFinalDone">Show final scores on TV 🏆</button></div>` : ""}
  </div>`;
}
