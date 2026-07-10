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
let categoriesShown = false;              // the category intro has played this game (resets on reload / new game)
let hostNoteDraft = "";                   // "Note from Danny" being typed (survives re-renders like the other drafts)

/* Fire the full-screen category reveal on the display, and grey the button.
   Also auto-engages the "Show the game" failsafe so the board is already waiting
   under the (opaque) intro — when the categories dissolve off, the game is right
   there, ready to play. On the game's FIRST reveal it additionally kicks off a
   one-time board-populate animation on the TV (tiles filling in a few random
   groups at a time, with a little arcade blip per group); replays skip that. */
function showCategories() {
  collectTeamNames();
  const firstReveal = !categoriesShown;    // the board-populate animation plays once per game
  categoriesShown = true;
  primeRevealAudio();                       // unlock the AudioContext inside this click gesture
  // Order matters: the opaque intro overlay goes up FIRST (transient, not saved
  // state), then we lift any curtain to "game" behind it — so the board (re)renders
  // hidden under the overlay and never flashes into view before the reveal.
  CHANNEL.postMessage({ type: "play-intro", reveal: firstReveal });
  update(() => { S.stage = "game"; });      // auto "Show the game": the board waits, ready, under the intro
}

/* Push a "Note from Danny" to the passive Host View (host.html). Stored in S so
   it rides the normal broadcast, survives a Host-View reopen, and clears on a new
   game; the TV display never renders it. An empty draft clears the note. */
function sendHostNote() {
  update(() => { S.hostNote = { text: hostNoteDraft.trim(), ts: Date.now() }; });
}

/* Apply a Final Jeopardy wager sent from the Host View (host.html), so wagers can
   be entered from either screen. S.finalWagers is the single source of truth: set
   it, keep the control panel's own draft in sync, broadcast — and re-render the
   control panel UNLESS the operator is mid-typing (so it never yanks their field). */
function applyFinalWager(teamIdx, wager) {
  if (S.phase !== "play" || !Array.isArray(S.finalWagers)) return;
  const i = +teamIdx;
  if (!(i >= 0 && i < S.teams.length)) return;
  const w = Math.max(0, Math.round(+wager) || 0);
  S.finalWagers[i] = w;
  if (finalWagerDrafts && finalWagerDrafts.length === S.teams.length) finalWagerDrafts[i] = w ? String(w) : "";
  send();
  const el = document.activeElement;
  if (!(el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) renderControl();
}

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

/* Open if we hold a live window reference OR a display announced itself over the
   channel recently (survives a control-panel reload, when displayWin is null). */
function displayLooksOpen() {
  if (displayWin && !displayWin.closed) return true;
  return (Date.now() - lastDisplayBeat) < DISPLAY_BEAT_MS;
}

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

/* ---- LAN sync status (only meaningful when served by server.py) ----
   In the normal one-computer setup these return "" and the panel is unchanged.
   When the game is shared over Wi-Fi, they show the mode and the addresses to
   open the TV board / Host View on OTHER devices. */
function netUrls() {
  const info = CHANNEL.net && CHANNEL.net.info;
  if (!info || !info.ip) return null;
  const base = "http://" + info.ip + ":" + info.port + "/";
  return { control: base, display: base + "#display", host: base + "host.html" };
}
function netPillHtml() {
  if (!CHANNEL.net || !CHANNEL.net.enabled) return "";
  const on = CHANNEL.net.connected;
  return `<span class="status-pill" title="This game is shared over your Wi-Fi — other devices can join">
    <span class="dot ${on ? "on" : ""}"></span>LAN sync ${on ? "on" : "connecting…"}</span>`;
}
function netDevicesHtml() {
  const u = netUrls();
  if (!u) return "";
  return `<div class="setup-note" style="margin-top:12px">
    🌐 <b>This game is shared over your Wi-Fi.</b> On another device's browser (same network), open:
    <div style="margin-top:8px"><b>TV / game board:</b> <code>${esc(u.display)}</code></div>
    <div style="margin-top:4px"><b>Host view:</b> <code>${esc(u.host)}</code></div>
    <p class="hint" style="margin-top:8px">You can still put the board on a screen attached to THIS computer with “Open display window”. If a device won't connect, make sure it's on the same Wi-Fi and that Python is allowed through this computer's firewall.</p>
  </div>`;
}

/* Every screen the TV can be put on, one click away — the fades (also in the
   Display setup dialog) plus the three pre-game screens. Whichever is up is
   highlighted, so the bar doubles as "what is on the TV right now?". */
function screensBarHtml() {
  const open = displayLooksOpen();
  const stage = S.stage || "game";
  const lit = (s) => stage === s ? "gold" : "";
  const off = open ? "" : "disabled";
  return `<div class="failsafe-bar">
    <span class="failsafe-label">TV screens</span>
    <button class="btn small ${lit("title")}" data-stage="title" ${off}>Title</button>
    <button class="btn small ${lit("rules")}" data-stage="rules" ${off}>Rules</button>
    <button class="btn small ${lit("teams")}" data-stage="teams" ${off}>Show teams</button>
    <button class="btn small ${lit("picks")}" id="btnPicksFirst" ${off}>Show who picks first</button>
    <button class="btn small ${lit("black")}" data-stage="black" ${off}>Black</button>
    <button class="btn small ${stage === "game" ? "primary" : ""}" data-stage="game" ${off}>Show the game</button>
    ${open ? "" : `<span class="hint" style="margin-left:2px">open a display first</span>`}
  </div>`;
}
function wireScreensBar() {
  app.querySelectorAll("[data-stage]").forEach(b => b.onclick = () => setStage(b.dataset.stage));
  const p = document.getElementById("btnPicksFirst");
  if (p) p.onclick = showWhoPicksFirst;
}

/* Put the picking order on the TV. The order is DRAWN ONCE — the first time this
   is used — and then rotates one team per clue, so coming back to this screen
   mid-game shows the running order rather than silently re-shuffling it. */
function showWhoPicksFirst() {
  collectTeamNames();
  if (!S.teams.length) { customAlert("Add some teams first."); return; }
  const show = () => {
    update(() => {
      if (!pickOrderValid(S)) { S.pickOrder = shuffledOrder(S.teams.length); S.pickIdx = 0; }
      S.stage = "picks";
    });
    if (screensOv) renderScreensDialog();
  };
  // The TV never prints a team's ID, so an unnamed team appears as a blank line
  // here. Say so before it happens rather than after.
  const unnamed = S.teams.filter(t => !teamNamed(t)).length;
  if (unnamed) {
    customConfirm(`${unnamed} team${unnamed > 1 ? "s haven't" : " hasn't"} chosen a name yet, so the TV will show a blank. Show the picking order anyway?`,
      { okText: "Show it anyway" }).then(ok => { if (ok) show(); });
    return;
  }
  show();
}

/* Draw a brand-new order. Separate from the button above precisely because that
   one must be safe to press twice. */
function reshufflePickOrder() {
  collectTeamNames();
  if (!S.teams.length) return;
  customConfirm("Draw a brand-new picking order? Whose turn it is resets to the top of the new order.",
    { okText: "Shuffle again" }).then(ok => {
    if (!ok) return;
    update(() => { S.pickOrder = shuffledOrder(S.teams.length); S.pickIdx = 0; });
  });
}

/* Step the rotation. Called with +1 when a clue is put away (the turn passes) and
   from the ◀ / ▶ buttons when the host needs to correct it. */
function stepPicker(delta) {
  if (!pickOrderValid(S)) return;
  const n = S.pickOrder.length;
  S.pickIdx = (((S.pickIdx + delta) % n) + n) % n;
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

/* Full screen on THIS computer's screen (no external display, no Window
   Management permission). Opens the display and arms one-click full screen: a
   browser can't go full screen with zero interaction, so the new window shows a
   "click for full screen" prompt and the first click/key there fills the screen.
   Same-machine fills are the reliable path — this is what to reach for when the
   external-screen auto-fullscreen won't fire (it needs an enterprise allow-list). */
function deployMainFull() {
  collectTeamNames();
  update(() => { S.stage = "game"; });
  openDisplayWindow(undefined, true);   // wantFs -> #display&fs=1 -> the new window arms one-click full screen
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
      <div class="sec-title">Main screen (this computer)</div>
      <div class="screens-btns">
        <button class="btn primary" data-act="main-full">Deploy full screen on this screen</button>
        <button class="btn" data-act="main-normal">Deploy on the main screen (normal window)</button>
        <button class="btn" data-act="main-split">Split: control panel + display side by side</button>
      </div>
      <p class="screens-note">Use <b>full screen on this screen</b> when the board is on this computer's own display (or a TV plugged into it) — no second screen or “manage windows” permission needed. A browser can't go full screen by itself, so the display window shows a big <b>“click for full screen”</b> prompt: one click (or any key press) inside that window fills the screen.</p>
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
  const u = netUrls();
  const netSection = u ? `
      <div class="screens-section">
        <div class="sec-title">🌐 Other devices — same Wi-Fi</div>
        <p class="screens-note">This game is shared over your network. To use a <b>separate</b> device as the TV or Host View, open in that device's browser:</p>
        <p class="screens-note"><b>TV / game board:</b> <code>${esc(u.display)}</code><br><b>Host view:</b> <code>${esc(u.host)}</code></p>
      </div>` : "";

  screensOv.innerHTML = `
    <div class="modal-box screens-dialog">
      <div class="screens-head">
        <h3>Display setup</h3>
        <span class="status-pill"><span class="dot ${displayOpen ? "on" : ""}"></span>${displayOpen ? "Display open" : "No display yet"}</span>
      </div>
      ${noChrome}${noExt}
      ${netSection}
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
    case "main-full":   deployMainFull(); break;
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

/* ---- timer "think" music --------------------------------------------------
   Plays from THIS (control-panel) window. The host clicks "30-second timer",
   which is a real user gesture, so the browser always allows the sound — no
   priming needed (a passive display window couldn't rely on that). Route the
   Mac's sound output to the TV and it plays there, like any music app.
   Married to the timer: starts with the countdown and fades out (never a hard
   cut) when it's cancelled, the answer is revealed, the view changes, or time
   runs out. Driven by S.timer, so every existing timer action already hits it. */
let timerAudio = null;
let audioTimerKey = null;        // startedAt of the timer whose music is playing
let audioFadeRAF = null;
let audioExpiryTimer = null;

function ensureTimerAudio() {
  if (!timerAudio) { timerAudio = new Audio("audio/think.mp3"); timerAudio.preload = "auto"; }
  return timerAudio;
}
function cancelAudioFade() { if (audioFadeRAF) { cancelAnimationFrame(audioFadeRAF); audioFadeRAF = null; } }

function startTimerAudio(startedAt, elapsed, seconds) {
  if (audioTimerKey === startedAt) return;     // already playing this timer
  audioTimerKey = startedAt;
  const a = ensureTimerAudio();
  cancelAudioFade();
  a.volume = 1;
  try { a.currentTime = (elapsed > 0.2 && isFinite(a.duration)) ? Math.min(elapsed, a.duration) : 0; } catch (e) {}
  const p = a.play(); if (p && p.catch) p.catch(() => {});    // called within the click gesture -> allowed
  clearTimeout(audioExpiryTimer);
  // If the clock runs out with no host input, let the music play 2s longer
  // before fading. (A host action — reveal/cancel/leave — still fades at once.)
  audioExpiryTimer = setTimeout(() => { if (audioTimerKey === startedAt) stopTimerAudio(); }, Math.max(0, (seconds - elapsed + 2) * 1000));
}

function stopTimerAudio() {
  if (audioTimerKey === null) return;
  audioTimerKey = null;
  clearTimeout(audioExpiryTimer); audioExpiryTimer = null;
  const a = timerAudio; if (!a) return;
  cancelAudioFade();
  const startVol = a.volume, t0 = Date.now(), dur = 700;
  const step = () => {
    const k = Math.min(1, (Date.now() - t0) / dur);
    a.volume = startVol * (1 - k);
    if (k < 1) audioFadeRAF = requestAnimationFrame(step);
    else { a.pause(); try { a.currentTime = 0; } catch (e) {} a.volume = 1; audioFadeRAF = null; }
  };
  step();
}

/* Marry the music to the timer. Called at the end of every control render, so
   any state change that starts or stops the timer plays or fades the music. */
function syncTimerAudio() {
  // S.timer.silent (the "no sound" timer button) runs the same countdown but plays no music.
  const running = S.timer && !S.timer.silent && S.view !== "winner" && S.view !== "bigscores";
  const elapsed = running ? (Date.now() - S.timer.startedAt) / 1000 : 0;
  if (running && elapsed < S.timer.seconds) startTimerAudio(S.timer.startedAt, elapsed, S.timer.seconds);
  else stopTimerAudio();
}

/* ---- final-reveal stings (synthesized) ------------------------------------
   Short, punchy sounds for the last-to-first winner reveal, generated with the
   Web Audio API so no extra audio files are needed. Played from the control
   window (each reveal is a host click, so the browser always allows it). A tick
   for a normal place; a triumphant arpeggio + chord when a champion appears.
   Everything is wrapped so a browser without Web Audio simply stays silent. */
let fjAudioCtx = null;
function fjCtx() {
  try { if (!fjAudioCtx) fjAudioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
  catch (e) { fjAudioCtx = null; }
  return fjAudioCtx;
}
function fjTone(ctx, freq, startAt, dur, gain, type) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type || "triangle"; o.frequency.value = freq;
  o.connect(g); g.connect(ctx.destination);
  const t0 = ctx.currentTime + startAt;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.start(t0); o.stop(t0 + dur + 0.05);
}
function playFinalSting(champion) {
  const ctx = fjCtx(); if (!ctx) return;
  try {
    if (ctx.state === "suspended") ctx.resume();
    if (champion) {
      const notes = [523.25, 659.25, 783.99, 1046.5];        // C5 E5 G5 C6 arpeggio
      notes.forEach((f, i) => fjTone(ctx, f, i * 0.11, 0.85, 0.20, "sawtooth"));
      notes.forEach(f => fjTone(ctx, f, 0.46, 1.25, 0.13, "triangle"));  // sustained chord
    } else {
      fjTone(ctx, 392.00, 0, 0.16, 0.16, "triangle");        // G4 -> D5 rising tick
      fjTone(ctx, 587.33, 0.085, 0.26, 0.16, "triangle");
    }
  } catch (e) { /* audio not allowed / unsupported — reveal is still fully visual */ }
}

/* Unlock (resume) the shared AudioContext from WITHIN a click gesture, so the
   board-reveal blips — which fire a couple of seconds later, off a display
   message — are already allowed to sound. Called on the Show Categories click. */
function primeRevealAudio() {
  const ctx = fjCtx(); if (!ctx) return;
  try { if (ctx.state === "suspended") ctx.resume(); } catch (e) {}
}

/* One short arcade "blip" per tile group during the one-time board-populate
   reveal. Played from the control window like the other sounds (the display posts
   a "board-beep" as each group fills in). Quiet on purpose; the pitch steps up a
   little each group for a satisfying ascending run. */
function playBoardBeep(step, total) {
  const ctx = fjCtx(); if (!ctx) return;
  try {
    if (ctx.state === "suspended") ctx.resume();
    const scale = [523.25, 587.33, 659.25, 783.99, 880.00, 1046.50];   // C5 D5 E5 G5 A5 C6 — ascends round to round
    const f = scale[Math.min(Math.max(step | 0, 0), scale.length - 1)];
    fjTone(ctx, f, 0, 0.11, 0.11, "square");             // the blip
    fjTone(ctx, f * 2, 0.006, 0.05, 0.04, "square");     // a touch of sparkle on top
  } catch (e) { /* audio not allowed / unsupported — the populate is still fully visual */ }
}

function renderControl() {
  if (IS_DISPLAY) return;
  document.body.className = "control";
  if (S.phase === "setup") renderSetup();
  else renderPlay();
  syncTimerAudio();
}

/* Read the team-name inputs back into S.teams. Safe to call anytime — a no-op
   when those inputs aren't on screen, so the deploy/curtain actions can call it
   before re-rendering without harm.

   An empty box stays EMPTY. It must not become "Team 1": that is the sheet's ID
   for the group, and the TV never shows an ID. The team is simply unnamed until
   its players choose a name off the "Show teams" screen and the host types it in. */
function collectTeamNames() {
  const inputs = app.querySelectorAll("[data-team]");
  if (!inputs.length) return;
  S.teams = [...inputs].map(inp => {
    const idx = +inp.dataset.team;
    const prev = S.teams[idx];
    return {
      id: (prev && prev.id != null) ? prev.id : idx + 1,
      name: inp.value.trim(),
      players: (prev && prev.players) || [],
      score: prev ? prev.score : 0,
    };
  });
}

/* The next free team ID, so "+ Add team" never reuses one that's already taken. */
function nextTeamId() { return S.teams.reduce((m, t) => Math.max(m, t.id || 0), 0) + 1; }

/* ---------------- setup screen ---------------- */
function renderSetup() {
  const teamsDraft = S.teams.length ? S.teams
    : [{ id: 1, name: "", score: 0 }, { id: 2, name: "", score: 0 }, { id: 3, name: "", score: 0 }];
  const savedGame = loadSavedGame();
  app.innerHTML = `
  <div class="ctl-wrap">
    <div class="ctl-header">
      <h1>🎯 Jeopardy <span>Control Panel</span></h1>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <span class="status-pill"><span class="dot ${displayLooksOpen() ? "on" : ""}"></span>
          Display window ${displayLooksOpen() ? "open" : "not open yet"}</span>
        ${netPillHtml()}
      </div>
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
          ${S.game.final ? " + Final Jeopardy" : ""}${S.game.teams && S.game.teams.length ? `, ${S.game.teams.length} teams` : ""},
          ${S.game.rules ? "rules ✓" : "<b>no rules</b> (cell D7 of ⚙️ Game Setup is empty)"}.
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
          • The ⚙️ Game Setup tab holds the game title, the <b>rules</b> (cell D7), the numbered teams, players, and an optional Final Jeopardy.<br>
          • When done: <b>Share → Anyone with the link → Viewer</b>, copy the link, send it to you. You paste it above — <b>never open the sheet yourself!</b></p>
        </div>
      </details>
    </div>

    <div class="card">
      <h2>Step 2 — Teams</h2>
      <p class="hint">The sheet only numbers the teams — that number is their ID and never reaches the TV.
        Put <b>Show teams</b> on the TV, let each group pick a name, then type the names here. Leave a box empty
        until they've decided.</p>
      <div id="teamSetup">
        ${teamsDraft.map((t, i) => `
          <div class="field-row team-row">
            <span class="team-id">Team ${teamIdOf(t, i)}</span>
            <input type="text" data-team="${i}" value="${esc(t.name || "")}" placeholder="Team name — they choose this">
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
      <p class="hint" style="margin-top:8px">Then walk the TV through the openers: <b>Title</b> → <b>Rules</b> →
      <b>Show teams</b> (they pick their names, you type them into Step 2) → <b>Show who picks first</b> → start the game.</p>
      <div class="field-row" style="margin-top:12px">
        <button class="btn" id="btnScreens">Display setup</button>
        <button class="btn" id="btnOpenDisplay">Open display window</button>
        <button class="btn primary" id="btnStart" ${S.game ? "" : "disabled"}>Start the game ▶</button>
      </div>
      ${screensBarHtml()}
      ${netDevicesHtml()}
      ${S.game ? "" : `<p class="hint">Load questions first to enable Start.</p>`}
    </div>
  </div>`;

  const bResume = document.getElementById("btnResume");
  if (bResume) bResume.onclick = () => {
    const sg = loadSavedGame();
    if (sg) { sg.stage = "game"; sg.finalPrep = false; update(() => { S = sg; }); }   // resume showing the game, never a leftover curtain or stray prep screen
  };
  const bDiscard = document.getElementById("btnDiscardSave");
  if (bDiscard) bDiscard.onclick = () => { clearSavedGame(); renderControl(); };

  document.getElementById("btnSample").onclick = () => {
    sheetError = "";
    collectTeamNames();
    ++sheetReqToken;               // invalidate any in-flight sheet load
    update(() => {
      S.game = JSON.parse(JSON.stringify(SAMPLE_GAME));
      S.teams = S.game.teams.map(t => ({ id: t.id, name: t.name, players: t.players || [], score: 0 }));
      S.pickOrder = []; S.pickIdx = 0;   // a different team list invalidates any drawn order
    });
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
        // the sheet's Game Setup tab wins: prefill the teams with their IDs and
        // players. Names stay blank — the players haven't chosen them yet.
        if (game.teams && game.teams.length) {
          S.teams = game.teams.map(t => ({ id: t.id, name: t.name, players: t.players || [], score: 0 }));
        }
        S.pickOrder = []; S.pickIdx = 0;   // a different team list invalidates any drawn order
      });
    } catch (e) {
      if (tok !== sheetReqToken || S.phase !== "setup") return;
      sheetBusy = false; sheetError = e.message; renderControl();
    }
  };
  /* Type a name, see it land on the TV. While the "Show teams" screen is up the
     host is typing the names the room just shouted out, and the blank next to that
     group should fill in as they do. send() (not update()) broadcasts WITHOUT
     re-rendering this panel, so the caret never jumps out of the box. */
  app.querySelectorAll("[data-team]").forEach(inp => {
    inp.oninput = () => { collectTeamNames(); send(); };
  });
  document.getElementById("btnAddTeam").onclick = () => {
    collectTeamNames();
    update(() => { S.teams.push({ id: nextTeamId(), name: "", players: [], score: 0 }); S.pickOrder = []; S.pickIdx = 0; });
  };
  app.querySelectorAll("[data-delteam]").forEach(b => b.onclick = () => {
    collectTeamNames();
    const i = +b.dataset.delteam;
    // Removing a team renumbers every index after it, so any drawn picking order
    // is now meaningless — throw it away rather than leave it pointing at the wrong team.
    update(() => { S.teams.splice(i, 1); S.pickOrder = []; S.pickIdx = 0; });
  });
  document.getElementById("btnScreens").onclick = () => { collectTeamNames(); openScreensDialog(); };
  document.getElementById("btnOpenDisplay").onclick = () => { collectTeamNames(); openDisplay(); renderControl(); };
  wireScreensBar();
  document.getElementById("btnStart").onclick = () => {
    collectTeamNames();
    const begin = () => {
      ++sheetReqToken;               // a game is starting; drop any pending sheet load
      finalWagerDrafts = null;
      update(() => {
        if (!S.teams.length) S.teams = [{ id: 1, name: "", players: [], score: 0 }, { id: 2, name: "", players: [], score: 0 }];
        S.phase = "play"; S.view = "board"; S.roundIdx = 0;
        S.finalWagers = S.teams.map(() => 0);
      });
    };
    // An unnamed team shows as a blank on the TV scoreboard (never its ID), so
    // check before the board goes up. They can still be named later, from Scores.
    const unnamed = S.teams.filter(t => !teamNamed(t)).length;
    if (unnamed) {
      customConfirm(`${unnamed} team${unnamed > 1 ? "s haven't" : " hasn't"} got a name yet — the TV scoreboard will show a blank. You can name them any time from the Scores card. Start anyway?`,
        { okText: "Start anyway" }).then(ok => { if (ok) begin(); });
      return;
    }
    begin();
  };
}

/* Whose turn it is to pick, and the rotation it came from. Sits above the score
   cards. The ◀ / ▶ buttons are an escape hatch: the turn passes by itself each
   time a clue is put away, but a mis-click shouldn't leave the host stuck. */
function turnBarHtml() {
  if (!S.teams.length) return "";
  if (!pickOrderValid(S)) {
    return `<div class="turn-bar">
      <span class="turn-label">Picking order</span>
      <span class="hint">Not drawn yet — click <b>Show who picks first</b> in the TV screens bar above.</span>
    </div>`;
  }
  const p = currentPicker(S);
  const order = S.pickOrder.map((ti, k) => `${k + 1}. ${esc(teamLabel(S.teams[ti], ti))}`).join(" · ");
  return `<div class="turn-bar">
    <span class="turn-label">Picking now</span>
    <span class="turn-now">${esc(teamLabel(S.teams[p], p))}</span>
    <button class="btn small" id="btnPickPrev" title="Back one turn">◀</button>
    <button class="btn small" id="btnPickNext" title="Forward one turn">▶</button>
    <button class="btn small" id="btnPickShuffle" title="Draw a brand-new order">Reshuffle</button>
    <span class="hint turn-order">${order}</span>
  </div>`;
}

/* ---------------- play screen ---------------- */
function renderPlay() {
  const r = currentRound();
  const cl = activeClue();
  const activeHostNote = (S.hostNote && S.hostNote.text) || "";   // note currently on the Host View
  const inClue = S.view === "clue" || S.view === "dd";
  const isDD = cl && cl.dd && S.dd;
  const isFinal = S.view === "final-intro" || S.view === "final-category" || S.view === "final-clue"
    || S.view === "final-winner";
  const isWinner = S.view === "winner";

  const picker = currentPicker(S);   // -1 until "Show who picks first" draws the order

  let mainHtml = "";
  if (isWinner) {
    const champs = winnersOf(S.teams);
    const tie = champs.length > 1;
    mainHtml = `<div class="card"><h2>🏆 ${tie ? "It's a tie — on the TV now" : "Winner — on the TV now"}</h2>
      <p class="hint">${tie ? "Tied at the top: " : "Champion: "}<b>${champs.map(t => esc(teamLabel(t, S.teams.indexOf(t)))).join(", ")}</b> with ${money(champs.length ? champs[0].score : 0)}.
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
        ${netPillHtml()}
        <button class="btn small" id="btnReopenDisplay">Open display</button>
        <button class="btn small" id="btnScreens">Display setup</button>
        ${isWinner
          ? `<button class="btn small" id="btnWinnerBack">◀ Back to game</button>`
          : `<button class="btn small ${categoriesShown ? "is-done" : "gold"}" id="btnShowCats">Show categories</button>
        <button class="btn small" id="btnShowScores">${S.view === "bigscores" ? "◀ Back to game" : "Show scores on TV"}</button>
        ${S.game.rounds.length > S.roundIdx + 1 && !isFinal ? `<button class="btn small" id="btnNextRound">Next round →</button>` : ""}
        ${S.game.final && !isFinal && S.view !== "bigscores" ? `<button class="btn small gold" id="btnFinal">Final Jeopardy</button>` : ""}
        <button class="btn small gold" id="btnAnnounceWinner">🏆 Announce winner</button>`}
        <button class="btn small" id="btnReset">⟲ New game</button>
      </div>
    </div>
    ${otherControlBannerHtml()}
    ${screensBarHtml()}
    ${mainHtml}
    <div class="card">
      <h2>Scores</h2>
      ${turnBarHtml()}
      <div class="teams-grid">
        ${S.teams.map((t, i) => {
          const phoned = !!(S.phones && S.phones[i]);
          return `
          <div class="team-card${i === picker ? " is-picking" : ""}">
            <div class="tname">${esc(teamLabel(t, i))}${teamNamed(t) ? "" : ` <span class="tname-unset">no name yet</span>`}</div>
            <div class="tscore ${t.score < 0 ? "neg" : ""}">${money(t.score)}</div>
            <div class="team-controls">
              <button class="btn small" data-adj="${i}:100">+100</button>
              <button class="btn small" data-adj="${i}:-100">−100</button>
              <button class="btn small" data-editscore="${i}">Set…</button>
              <button class="btn small" data-rename="${i}">Name…</button>
            </div>
            <button class="btn small phone-btn ${phoned ? "is-done" : ""}" data-phone="${i}"
              title="${phoned ? "Already used their one call — click to show it again" : "Announce that this team has phoned grandma"}">
              📞 ${phoned ? "Phoned ✓" : "Phone grandma"}</button>
          </div>`;
        }).join("")}
      </div>
    </div>

    <div class="card">
      <h2>🧑‍🏫 Host view <span style="font-weight:400;font-size:14px;opacity:.75">— a private screen for whoever reads &amp; judges</span></h2>
      <p class="hint">Open it on the host's Mac or iPad. It shows the current question, the answer (even before it's revealed on the TV), the 30-second timer, and any note you send below — and never changes the game.</p>
      <div class="field-row">
        <button class="btn" id="btnOpenHostView">Open host view (new tab)</button>
        <span class="hint">…or bookmark <b>this game's address + <code>host.html</code></b> on the host's device.</span>
      </div>
      <div class="field-row" style="margin-top:6px">
        <input type="text" id="hostNoteInput" placeholder="Type a note for the host (it pops up on their screen)…" value="${esc(hostNoteDraft)}">
        <button class="btn primary" id="btnSendHostNote">Send note</button>
        <button class="btn" id="btnClearHostNote" ${activeHostNote ? "" : "disabled"}>Clear</button>
      </div>
      ${activeHostNote
        ? `<p class="hint">📩 The host is currently seeing: “<b>${esc(activeHostNote)}</b>”.</p>`
        : `<p class="hint">No note on the host screen right now.</p>`}
    </div>
  </div>`;

  document.getElementById("btnReopenDisplay").onclick = () => { openDisplay(); renderControl(); };
  document.getElementById("btnScreens").onclick = () => openScreensDialog();
  wireScreensBar();
  const bCats = document.getElementById("btnShowCats");
  if (bCats) bCats.onclick = () => {
    if (!categoriesShown) return showCategories();
    customConfirm("The categories were already shown this game. Show them again?", { okText: "Show again" })
      .then(ok => { if (ok) showCategories(); });
  };
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
    update(() => { S.finalPrep = true; });   // flash "Ready for Final Jeopardy" on the Host View while we confirm
    customConfirm("Start Final Jeopardy? The instructions will appear on the TV, and the board is left behind.",
      { okText: "Start Final Jeopardy" }).then(ok => {
      if (!ok) { update(() => { S.finalPrep = false; }); return; }   // cancelled — drop the host "ready" screen
      liveAnswerDraft = "";
      finalWagerDrafts = null;
      update(() => {
        S.finalPrep = false;
        // If a PRIOR Final Jeopardy was already scored (host is re-running it),
        // un-bank those awards first — otherwise the fresh scoring pass, which
        // sees every team as unscored again, would double-count the wagers.
        if (S.finalAwarded) {
          for (const i of Object.keys(S.finalAwarded)) {
            const w = (S.finalWagers && S.finalWagers[i]) || 0;
            if (S.teams[+i]) S.teams[+i].score -= (S.finalAwarded[i] === "+" ? w : -w);
          }
        }
        S.view = "final-intro"; S.prevView = null;
        S.finalRevealed = false; S.finalAwarded = {}; S.finalReveal = 0;
        S.active = null; S.dd = null; S.awarded = {}; S.timer = null;
        S.finalWagers = S.teams.map(() => 0);   // fresh, blank wagers for this run
      });
    });
  };
  document.getElementById("btnReset").onclick = () => {
    customConfirm("Start over completely? Scores and board progress will be erased.", { okText: "New game", danger: true }).then(ok => {
      if (!ok) return;
      clearSavedGame();
      finalWagerDrafts = null;
      categoriesShown = false;                 // a fresh game can show its categories again
      update(() => { S = freshState(); });
    });
  };
  app.querySelectorAll("[data-adj]").forEach(b => b.onclick = () => {
    const [i, d] = b.dataset.adj.split(":").map(Number);
    update(() => { S.teams[i].score += d; });
  });
  app.querySelectorAll("[data-editscore]").forEach(b => b.onclick = () => {
    const i = +b.dataset.editscore;
    customPrompt("New score for " + teamLabel(S.teams[i], i) + ":", String(S.teams[i].score)).then(v => {
      if (v !== null && v.trim() !== "" && !isNaN(+v)) update(() => { S.teams[i].score = Math.round(+v); });
    });
  });
  /* Name a team mid-game — the box on the setup screen is gone by now, but the
     players may only have settled on a name after the game was already rolling. */
  app.querySelectorAll("[data-rename]").forEach(b => b.onclick = () => {
    const i = +b.dataset.rename;
    customPrompt("Team name for " + teamLabel(S.teams[i], i) + ":", S.teams[i].name || "").then(v => {
      if (v === null) return;
      update(() => { S.teams[i].name = v.trim(); });
    });
  });
  /* 📞 Phone grandma. One call per team; pressing it again asks first, because the
     only reason to do so is that the banner was missed, not that they get another. */
  app.querySelectorAll("[data-phone]").forEach(b => b.onclick = () => {
    const i = +b.dataset.phone;
    const t = S.teams[i];
    if (!t) return;
    const label = teamLabel(t, i);
    const announce = () => update(() => {
      S.phones[i] = true;
      // Snapshot the name too: it's the fallback if this team is later removed.
      S.phoneAlert = { teamIdx: i, name: dispTeamName(t) || label, ts: Date.now() };
    });
    if (S.phones && S.phones[i]) {
      customConfirm(`${label} has already phoned grandma — each team only gets one call. Show the notification again anyway?`,
        { okText: "Show it again" }).then(ok => { if (ok) announce(); });
      return;
    }
    announce();
  });
  /* Correct the rotation by hand, or draw a whole new one. */
  const bPrev = document.getElementById("btnPickPrev");
  if (bPrev) bPrev.onclick = () => update(() => stepPicker(-1));
  const bNext = document.getElementById("btnPickNext");
  if (bNext) bNext.onclick = () => update(() => stepPicker(1));
  const bShuf = document.getElementById("btnPickShuffle");
  if (bShuf) bShuf.onclick = reshufflePickOrder;

  /* Host view: open the passive screen, and send/clear the "Note from Danny". */
  const bOpenHostView = document.getElementById("btnOpenHostView");
  if (bOpenHostView) bOpenHostView.onclick = () => { window.open("host.html", "ppiJeopardyHost"); };
  const hnInput = document.getElementById("hostNoteInput");
  if (hnInput) {
    hnInput.oninput = (e) => { hostNoteDraft = e.target.value; };
    hnInput.onkeydown = (e) => { if (e.key === "Enter") sendHostNote(); };
  }
  const bSendHostNote = document.getElementById("btnSendHostNote");
  if (bSendHostNote) bSendHostNote.onclick = sendHostNote;
  const bClearHostNote = document.getElementById("btnClearHostNote");
  if (bClearHostNote) bClearHostNote.onclick = () => { hostNoteDraft = ""; update(() => { S.hostNote = { text: "", ts: Date.now() }; }); };

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
          S.photoZoom = false;                 // start each clue un-zoomed
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
    const bZoom = document.getElementById("btnPhotoZoom");
    if (bZoom) bZoom.onclick = () => update(() => { S.photoZoom = !S.photoZoom; });
    const bBack = document.getElementById("btnBack");
    if (bBack) bBack.onclick = () => {
      liveAnswerDraft = ""; liveAnswerOpen = false;
      update(() => {
        const c = activeClue(); if (c) c.used = true;
        S.view = "board"; S.active = null; S.revealed = false; S.dd = null; S.awarded = {}; S.timer = null; S.photoZoom = false;
        stepPicker(1);   // that clue is done — the pick passes to the next team in the rotation
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
        S.finalRevealed = true; S.timer = null;
      });
    };
    const finalLiveInp = document.getElementById("finalLiveAnswer");
    if (finalLiveInp) finalLiveInp.oninput = (e) => { liveAnswerDraft = e.target.value; };
    const bTimer = document.getElementById("btnTimer");
    if (bTimer) bTimer.onclick = () => update(() => {
      S.timer = S.timer ? null : { startedAt: Date.now(), seconds: 30 };   // with music (or cancel)
    });
    const bTimerSilent = document.getElementById("btnTimerSilent");
    if (bTimerSilent) bTimerSilent.onclick = () => update(() => {
      S.timer = { startedAt: Date.now(), seconds: 30, silent: true };       // same countdown, no music
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
    /* ---- final jeopardy: stepped flow ---------------------------------
       intro -> category (wagers) -> clue (timer/reveal/score) -> tally
       (loading + confirm scores) -> winner (last-to-first reveal). */
    const bToCat = document.getElementById("btnFinalToCat");
    if (bToCat) bToCat.onclick = () => update(() => { S.view = "final-category"; });
    const bBackIntro = document.getElementById("btnFinalBackIntro");
    if (bBackIntro) bBackIntro.onclick = () => update(() => { S.view = "final-intro"; });

    app.querySelectorAll("[data-fwager]").forEach(inp => {
      inp.oninput = (e) => { if (finalWagerDrafts) finalWagerDrafts[+inp.dataset.fwager] = e.target.value; };
      // Commit on blur/Enter to S.finalWagers and broadcast, so the Host View sees
      // it live. No re-render here (that would destroy the button being clicked and
      // drop focus); the value the operator typed already shows in their field.
      inp.onchange = (e) => {
        const i = +inp.dataset.fwager;
        const w = Math.max(0, Math.round(+e.target.value) || 0);
        if (finalWagerDrafts) finalWagerDrafts[i] = w ? String(w) : "";
        if (Array.isArray(S.finalWagers)) { S.finalWagers[i] = w; send(); }
      };
    });
    const fShow = document.getElementById("btnFinalClue");
    if (fShow) fShow.onclick = () => {
      const wagers = (finalWagerDrafts || []).map(v => Math.max(0, Math.round(+v) || 0));
      while (wagers.length < S.teams.length) wagers.push(0);
      update(() => { S.finalWagers = wagers; S.view = "final-clue"; S.finalRevealed = false; S.finalAwarded = {}; S.timer = null; });
    };
    const bBackCat = document.getElementById("btnFinalBackCat");
    if (bBackCat) bBackCat.onclick = () => update(() => { S.view = "final-category"; S.timer = null; });

    const fReveal = document.getElementById("btnFinalReveal");
    if (fReveal) fReveal.onclick = () => update(() => { S.finalRevealed = true; S.timer = null; });
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
    // Back out of the reveal to fix a wager result (only offered before any
    // place is unveiled, so the reveal itself is never interrupted).
    const bBackClue = document.getElementById("btnFinalBackClue");
    if (bBackClue) bBackClue.onclick = () => update(() => { S.view = "final-clue"; });

    /* the dramatic last-to-first reveal — "Reveal the winner" goes straight to
       the standings view, whose first frame (finalReveal 0) is the "Tallying
       scores…" loader; the host then steps places up from last to first. */
    const bRevealWinner = document.getElementById("btnRevealWinner");
    if (bRevealWinner) bRevealWinner.onclick = () => update(() => { S.view = "final-winner"; S.finalReveal = 0; S.timer = null; });
    const bRevealNext = document.getElementById("btnRevealNext");
    if (bRevealNext) bRevealNext.onclick = () => {
      const N = S.teams.length;
      const next = Math.min((S.finalReveal || 0) + 1, N);
      playFinalSting(finalRevealHitsChampion(next));
      update(() => { S.finalReveal = next; });
    };
    const bRevealAll = document.getElementById("btnRevealAll");
    if (bRevealAll) bRevealAll.onclick = () => {
      playFinalSting(true);
      update(() => { S.finalReveal = S.teams.length; });
    };
    const bRevealReplay = document.getElementById("btnRevealReplay");
    if (bRevealReplay) bRevealReplay.onclick = () => update(() => { S.finalReveal = 0; });
    const bFinalBackGame = document.getElementById("btnFinalBackGame");
    if (bFinalBackGame) bFinalBackGame.onclick = () => update(() => { S.view = "board"; S.prevView = null; });
  }
}

/* True when unveiling `count` places (from last up) puts a top-scoring team on
   screen — i.e. a champion just appeared, so play the big fanfare not a tick.
   The team just revealed sits at index (N - count) in the high->low standings;
   with a tie for first, that can happen a step before the very last reveal. */
function finalRevealHitsChampion(count) {
  const st = finalStandings(S.teams);
  const N = st.length;
  if (count < 1 || count > N) return false;
  const just = st[N - count];
  return !!just && just.isTop;
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
          ${S.teams.map((t, i) => `<option value="${i}" ${i === ddDraft.team ? "selected" : ""}>${esc(teamLabel(t, i))}</option>`).join("")}
        </select>
        <input type="number" id="ddWager" class="wager-input" placeholder="Wager ($)" min="0" step="100" value="${esc(ddDraft.wager)}">
        <button class="btn primary" id="btnDDGo">Show the clue ▶</button>
      </div>
      <p class="hint">House rules: they can wager up to their score (or up to the highest value on the board if they're behind).</p>
    </div>`;
  }
  const amount = S.dd && S.dd.wager != null ? S.dd.wager : cl.value;
  const ddTeam = S.dd && S.dd.teamIdx != null ? S.teams[S.dd.teamIdx] : null;
  const zoomImgs = currentClueImages(cl, S.revealed);   // picture(s) currently on the TV (answer set once revealed)
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
      ${zoomImgs.length ? (zoomImgs.includes(window.__imgErrorSrc)
        ? `<p class="hint" style="margin-top:8px;color:#ff9b9b">📷⚠️ A picture FAILED to load on the TV — describe it aloud, or skip this one.</p>`
        : `<p class="hint" style="margin-top:8px">📷 This question has ${zoomImgs.length > 1 ? "pictures" : "a picture"} — ${zoomImgs.length > 1 ? "they're" : "it's"} on the TV under the clue.</p>`) : ""}
    </div>
    ${answerHtml}
    <div class="field-row">
      ${S.revealed ? "" : `${cl.unknown ? "" : `<button class="btn gold" id="btnReveal">Reveal answer on TV</button>`}
      ${S.timer
        ? `<button class="btn" id="btnTimer">✖ Cancel timer</button>`
        : `<button class="btn" id="btnTimer">🔊 30-second timer</button>
           <button class="btn" id="btnTimerSilent">🔇 Timer — no sound</button>`}`}
      ${zoomImgs.length ? `<button class="btn ${S.photoZoom ? "gold" : ""}" id="btnPhotoZoom">${S.photoZoom ? "◀ Back to the question" : `Show photo${zoomImgs.length > 1 ? "s" : ""} full screen`}</button>` : ""}
      <button class="btn primary" id="btnBack">Done — back to board</button>
    </div>
    ${S.revealed ? `
    <h2 style="margin-top:16px">Award points ${ddTeam ? "(wager: " + money(amount) + ")" : "(" + money(amount) + ")"}</h2>
    ${(ddTeam ? [S.dd.teamIdx] : S.teams.map((_, i) => i)).map((i) =>
      awardRowHtml(i, teamLabel(S.teams[i], i), amount, S.awarded[i])
    ).join("")}` : ""}
  </div>`;
}

/* Right/Wrong (or Undo) rows for scoring each team's wager. Shared by the clue
   screen (right after the reveal) and the "Tallying scores…" screen, so the host
   can score or fix results on whichever one they're on. */
function finalScoreRowsHtml() {
  return S.teams.map((t, i) => {
    const w = S.finalWagers[i] || 0;
    if (S.finalAwarded[i]) {
      const applied = S.finalAwarded[i] === "+" ? `+${money(w)}` : `−${money(w)}`;
      return `<div class="award-row">
        <span class="aw-name">${esc(teamLabel(t, i))} — wagered ${money(w)}</span>
        <span class="hint">${S.finalAwarded[i] === "+" ? "✓ scored " : "✗ scored "}${applied}</span>
        <button class="btn small" data-funaward="${i}">Undo</button>
      </div>`;
    }
    return `<div class="award-row">
      <span class="aw-name">${esc(teamLabel(t, i))} — wagered ${money(w)}</span>
      <button class="btn good small" data-faward="${i}:+">✓ Right</button>
      <button class="btn bad small" data-faward="${i}:-">✗ Wrong</button>
    </div>`;
  }).join("");
}

function finalControlHtml() {
  const f = S.game.final;

  /* Step 1 — the instruction page is on the TV. */
  if (S.view === "final-intro") {
    return `
    <div class="card">
      <h2>🏁 Final Jeopardy — the instructions are on the TV</h2>
      <p class="hint">Everyone reads the rules on the big screen. Collect answer slips and pens, then reveal the category when the room is ready.</p>
      ${f.instructions ? "" : `<div class="setup-err">No instruction text was found in the sheet (⚙️ Game Setup tab, cell <b>D18</b>), so the screen just shows the Final Jeopardy title. Add text to D18 to give players the rules.</div>`}
      <div class="field-row"><button class="btn primary" id="btnFinalToCat">Next: reveal the category ▶</button></div>
    </div>`;
  }

  /* Step 2 — category is on the TV; enter each team's secret wager. */
  if (S.view === "final-category") {
    if (!finalWagerDrafts || finalWagerDrafts.length !== S.teams.length) {
      finalWagerDrafts = S.teams.map((_, i) => S.finalWagers[i] ? String(S.finalWagers[i]) : "");
    }
    return `
    <div class="card">
      <h2>🏁 Final Jeopardy — category is on the TV: "${esc(f.category)}"</h2>
      <p class="hint">Each team secretly writes a wager on paper (up to their score). Enter the wagers here, then reveal the clue.
      If you're playing, have someone else check that wagers don't exceed scores!</p>
      ${S.teams.map((t, i) => `
        <div class="award-row">
          <span class="aw-name">${esc(teamLabel(t, i))} (${money(t.score)})</span>
          <input type="number" data-fwager="${i}" min="0" step="100" placeholder="Wager ($)"
            value="${esc(finalWagerDrafts[i])}">
        </div>`).join("")}
      <div class="field-row">
        <button class="btn primary" id="btnFinalClue">Next: reveal the clue ▶</button>
        <button class="btn small" id="btnFinalBackIntro">◀ Back to instructions</button>
      </div>
    </div>`;
  }

  /* Step 3 — the clue is on the TV; behaves exactly like a normal question
     (30-second timer with/without music, reveal, then score the wagers). */
  if (S.view === "final-clue") {
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
      fAnswerHtml = `<div class="answer-hidden">🙈 Answer hidden — from you too, so you can play! Teams write their answers on paper (start the 30-second timer for the think music!), then reveal.</div>`;
    }
    return `
    <div class="card">
      <h2>🏁 Final Jeopardy — ${esc(f.category)}</h2>
      <div class="clue-box"><div class="label">On the TV right now</div><div class="cluetext">${fmtText(f.clue)}</div></div>
      ${fAnswerHtml}
      <div class="field-row">
        ${S.finalRevealed || f.unknown ? "" : `<button class="btn gold" id="btnFinalReveal">Reveal answer on TV</button>`}
        ${S.finalRevealed ? "" : (S.timer
          ? `<button class="btn" id="btnTimer">✖ Cancel timer</button>`
          : `<button class="btn" id="btnTimer">🔊 30-second timer</button>
             <button class="btn" id="btnTimerSilent">🔇 Timer — no sound</button>`)}
        ${S.finalRevealed ? "" : `<button class="btn small" id="btnFinalBackCat">◀ Back to category</button>`}
      </div>
      ${S.finalRevealed ? `
        <h2 style="margin-top:16px">Score the wagers</h2>
        ${finalScoreRowsHtml()}
        ${S.teams.every((_, i) => S.finalAwarded[i]) ? "" : `<p class="hint" style="color:#e0b24a;margin:4px 0">Some teams aren't scored yet — fine if they didn't wager, but double-check before you reveal.</p>`}
        <div class="field-row"><button class="btn gold" id="btnRevealWinner">Reveal the winner ▶</button></div>
        <p class="hint">The TV shows a “Tallying scores…” screen first, then you unveil the standings from last place up.</p>` : ""}
    </div>`;
  }

  /* Step 4 — the dramatic last-to-first standings reveal (its first frame,
     before any place is unveiled, is the "Tallying scores…" loader). */
  if (S.view === "final-winner") return finalWinnerControlHtml();
  return "";
}

/* The control side of the last-to-first reveal: a host reference of the full
   standings (scores aren't secret) with the reveal button that steps the TV up
   from last place to the champion. */
function finalWinnerControlHtml() {
  const st = finalStandings(S.teams);                 // high -> low
  const N = st.length;
  const revealed = Math.min(Math.max(S.finalReveal || 0, 0), N);
  const champs = st.filter(s => s.isTop);
  const nextIdx = N - 1 - revealed;                   // bottom-most not-yet-shown

  const ref = st.map((s, i) => {
    const shown = i >= N - revealed;
    const isNext = i === nextIdx;
    return `<li class="fj-ref-row${shown ? " revealed" : ""}${isNext ? " next" : ""}">
      <span class="ref-place">${ordinal(s.rank)}</span>
      <span class="ref-team">${esc(teamLabel(s.team, s.idx))}</span>
      <span class="ref-score">${money(s.team.score)}</span>
      <span class="ref-state">${shown ? "shown" : (isNext ? "◀ next up" : "hidden")}</span>
    </li>`;
  }).join("");

  let action;
  if (revealed < N) {
    const next = st[nextIdx];
    const champNext = next.isTop;
    action = `
      <button class="btn gold" id="btnRevealNext">Reveal ${ordinal(next.rank)} place${champNext ? " — the CHAMPION" : ""}: ${esc(teamLabel(next.team, next.idx))} ▶</button>
      <button class="btn" id="btnRevealAll">Reveal all remaining</button>`;
  } else {
    const tie = champs.length > 1;
    action = `<span class="hint" style="font-size:15px">✅ All places revealed — ${tie ? "co-champions" : "champion"}:
      <b>${champs.map(c => esc(teamLabel(c.team, c.idx))).join(" &amp; ")}</b> at ${money(champs.length ? champs[0].team.score : 0)}.</span>`;
  }

  const intro = revealed === 0
    ? `<p class="hint">The TV shows <b>“Tallying scores…”</b>. Build the suspense — announce last place out loud, <b>then</b> reveal it. Each team pops up big in the centre, then drops into place.</p>`
    : `<p class="hint">Announce the next place out loud, <b>then</b> click to reveal it. The reveal climbs from last place to the champion.</p>`;

  return `
  <div class="card">
    <h2>🏆 Final standings — revealing last place → first on the TV</h2>
    ${intro}
    <ol class="fj-ref">${ref}</ol>
    <div class="field-row">${action}</div>
    <div class="field-row" style="margin-top:4px">
      ${revealed === 0 ? `<button class="btn small" id="btnFinalBackClue">◀ Back to fix scoring</button>` : ""}
      ${revealed > 0 ? `<button class="btn small" id="btnRevealReplay">↻ Start the reveal over</button>` : ""}
      <button class="btn primary" id="btnFinalBackGame">Done — back to the game</button>
    </div>
  </div>`;
}
