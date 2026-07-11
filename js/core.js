"use strict";
/* ============================================================
   Core: shared state, window sync, persistence, and helpers.

   The control window owns the authoritative state object S and
   broadcasts a full snapshot after every change (send()). The
   display window is a pure renderer of received snapshots.
   ============================================================ */

const IS_DISPLAY = location.hash.startsWith("#display");
// Message bus (js/bus.js): BroadcastChannel for same-machine windows, plus an
// optional LAN relay when the page is served by server.py, so the control panel /
// TV / Host View can be on separate devices. Drop-in for BroadcastChannel.
const CHANNEL = createBus("ppi-jeopardy-v1");
const SAVE_KEY = "ppi-jeopardy-state-v1";
const app = document.getElementById("app");

function freshState() {
  return {
    phase: "setup",          // setup | play
    game: null,              // see js/data.js for the game object shape
    roundIdx: 0,
    teams: [],               // [{id, name, players, score}] — id is the sheet's team number,
                             //   name is typed on the control panel (blank until the team picks one)
    view: "welcome",         // welcome | board | clue | dd | bigscores | winner
                             //   Final Jeopardy sequence (stepped from the control panel):
                             //   final-intro | final-category | final-clue | final-tally | final-winner
    prevView: null,          // view to return to when leaving bigscores
    winnerPrev: null,        // view to return to when leaving the winner screen (separate from bigscores)
    active: null,            // {cat, row}
    revealed: false,
    dd: null,                // {teamIdx, wager} while a daily double is being played
    awarded: {},             // teamIdx -> "+"|"-" for the active clue (double-award guard)
    finalWagers: [],         // per-team wagers for final
    finalRevealed: false,
    finalAwarded: {},        // teamIdx -> "+"|"-" for final (double-award guard)
    finalReveal: 0,          // final-winner: how many places are unveiled so far (from last place up)
    timer: null,             // {startedAt, seconds}
    photoZoom: false,        // blow the current clue's photo(s) up to fill the TV
    stage: "game",           // display curtain, independent of the game view:
                             //   "game"  = show the live game (no curtain)
                             //   "black" = fade the TV to solid black
                             //   "title" = fade the TV to the title screen
                             //   "rules" = the house rules, read from the sheet's Game Setup D7
                             //   "teams" = the team groups, so players find theirs and pick a name
                             //   "picks" = the shuffled picking order and who goes first
    pickOrder: [],           // shuffled team indexes — the rotation for who picks the next clue.
                             //   Empty until "Show who picks first" draws it (once per game).
    pickIdx: 0,              // pointer into pickOrder: whose turn it is to pick right now
    pickShuffleTs: 0,        // one-shot trigger: bumped when a FRESH order is drawn so the TV
                             //   plays its shuffle-into-place reveal once (a reopened TV, seeing
                             //   the same ts, shows the settled order without re-rolling it)
    phones: {},              // teamIdx -> true once that team has spent its one "phone grandma"
    phoneAlert: null,        // {teamIdx, name, ts} — the one-shot "…has phoned grandma!" banner.
                             //   The TV and Host View fire on a CHANGED ts, so an ordinary
                             //   re-render (or a score edit) never replays it.
    hostNote: { text: "", ts: 0 },  // "Note from Danny" pushed to the passive Host View
                             //   (host.html). Never rendered on the TV; the display ignores it.
    finalPrep: false,        // true while the control panel's "Start Final Jeopardy?" confirm is
                             //   open — flashes a "Ready for Final Jeopardy" screen on the Host View.
  };
}
let S = freshState();

/* ---------------- sync + persistence ---------------- */
function snapshot() { return JSON.parse(JSON.stringify(S)); }

function save() {
  // Only persist mid-game state. Saving during setup would clobber a
  // previous game's save before the host gets the chance to resume it.
  if (S.phase !== "play") return;
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(S)); }
  catch (e) { /* storage blocked/full: play on without persistence */ }
}

/* A save written before the picking order / phone-a-grandma fields existed is
   still a perfectly good game — fill in what it's missing rather than refusing it. */
function normalizeState(s) {
  if (!Array.isArray(s.pickOrder)) s.pickOrder = [];
  if (typeof s.pickIdx !== "number" || !isFinite(s.pickIdx)) s.pickIdx = 0;
  if (typeof s.pickShuffleTs !== "number" || !isFinite(s.pickShuffleTs)) s.pickShuffleTs = 0;
  if (!s.phones || typeof s.phones !== "object") s.phones = {};
  if (!s.phoneAlert || typeof s.phoneAlert !== "object") s.phoneAlert = null;
  (s.teams || []).forEach((t, i) => {
    if (t.id == null) t.id = i + 1;
    if (typeof t.name !== "string") t.name = "";
    if (!Array.isArray(t.players)) t.players = [];
  });
  return s;
}

function loadSavedGame() {
  try {
    const saved = localStorage.getItem(SAVE_KEY);
    if (!saved) return null;
    const parsed = JSON.parse(saved);
    if (parsed && parsed.phase === "play" && parsed.game) return normalizeState(parsed);
  } catch (e) { /* corrupt save */ }
  return null;
}

function clearSavedGame() {
  try { localStorage.removeItem(SAVE_KEY); } catch (e) {}
}

function send() {
  CHANNEL.postMessage({ type: "state", state: snapshot() });
  save();
}

/* Mutate state, then broadcast + persist + re-render the control panel. */
function update(mutator) { mutator(); send(); renderControl(); }

/* True when another control-panel tab answered our boot hello —
   two control tabs would fight over the display and the save. */
let otherControlDetected = false;

/* Heartbeat-based "is a display open?" detection. The window.open reference
   (displayWin) is lost when the control panel reloads, so instead an open
   display keeps announcing itself over the channel ("display-alive" every
   second + an instant reply to "ping-display"); the control trusts a recent
   beat. This is what makes display/fullscreen detection survive a reload. */
let lastDisplayBeat = 0;
const DISPLAY_BEAT_MS = 2500;         // consider a display gone after ~2 missed beats
let displayOpenKnown = false;         // last open-state the control panel rendered
function noteDisplaySeen() { lastDisplayBeat = Date.now(); refreshDisplayOpenState(); }
/* Re-render the control panel only when the display's open/closed state actually
   flips — and never while the host is typing (would yank focus; caught next tick). */
function refreshDisplayOpenState() {
  if (IS_DISPLAY) return;
  const open = displayLooksOpen();
  if (open === displayOpenKnown) return;
  const el = document.activeElement;
  if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
  displayOpenKnown = open;
  collectTeamNames();
  renderControl();
  if (screensOv) renderScreensDialog();
}

/* The display's first real snapshot is a starting point, not news: a TV opened
   (or reopened) mid-game must not replay the phone-a-grandma banner that fired
   before it existed. primeDisplayOneShots (display.js) records what has already
   happened so only genuinely NEW events animate. */
let displaySeenState = false;

CHANNEL.onmessage = (ev) => {
  const msg = ev.data;
  if (IS_DISPLAY) {
    if (msg.type === "state") {
      const first = !displaySeenState;
      displaySeenState = true;
      S = msg.state;
      // Pin every clue picture in memory the moment the game is known, so
      // re-renders never re-ask Google and a mid-game Wi-Fi blip can't kill a
      // picture (js/img-cache.js). Idempotent — already-pinned URLs are skipped.
      if (S.game) imgPrefetch(gameImageUrls(S.game));
      if (first) primeDisplayOneShots();
      renderDisplay();
    }
    else if (msg.type === "ping-display") { CHANNEL.postMessage({ type: "display-alive" }); }
    else if (msg.type === "play-intro") { playCategoryIntro(!!msg.reveal); }   // full-screen category reveal (reveal => also populate the board)
  } else {
    if (msg.type === "hello") { CHANNEL.postMessage({ type: "state", state: snapshot() }); noteDisplaySeen(); }
    // The passive Host View (host.html) requests the current state on open. Reply
    // with a snapshot but do NOT mark a display beat — the Host View is not a TV,
    // and must never be mistaken for one or for a second control panel.
    else if (msg.type === "host-hello") { CHANNEL.postMessage({ type: "state", state: snapshot() }); }
    // The Host View can enter Final Jeopardy wagers "alongside" the control panel;
    // this is the one write it's allowed. The control (which owns S) applies it.
    else if (msg.type === "set-final-wager") { applyFinalWager(msg.teamIdx, msg.wager); }
    else if (msg.type === "display-alive") { noteDisplaySeen(); }
    else if (msg.type === "board-beep") { playBoardBeep(msg.step, msg.total); }   // arcade blip per board-reveal group (played on the control window)
    else if (msg.type === "control-hello") { CHANNEL.postMessage({ type: "control-active" }); }
    else if (msg.type === "control-active") {
      if (!otherControlDetected) { otherControlDetected = true; renderControl(); }
    }
    else if (msg.type === "img-error") {
      // the display couldn't load a clue picture — surface it to the host
      window.__imgErrorSrc = msg.src;
      renderControl();
    }
    else if (msg.type === "img-recovered") {
      // a picture the TV had written off has come back (its prefetch finally
      // landed) — withdraw the control panel's failure warning if it was for it
      if (window.__imgErrorSrc === msg.src) { window.__imgErrorSrc = null; renderControl(); }
    }
  }
};

/* ---------------- helpers ---------------- */
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
/* Google Sheets can't hold a real newline inside a cell, so a writer marks a
   line break with "##". Escape first (safe), then turn ## into <br>. */
function fmtText(s) { return esc(s).split("##").join("<br>"); }
/* A clue's image can be one URL or two (comma-separated in the sheet). Normalize
   to an array so the display/control handle one or two the same way. */
function imageList(image) {
  if (Array.isArray(image)) return image.filter(Boolean);
  return image ? [image] : [];
}
/* The images to show for a clue right now: the answer's images once revealed (if
   the sheet gave separate ones via "THEN"), otherwise the question's images. */
function currentClueImages(cl, revealed) {
  if (!cl) return [];
  const set = (revealed && cl.answerImage != null) ? cl.answerImage : cl.image;
  return imageList(set);
}
/* True when the answer shows DIFFERENT picture(s) than the question (the sheet
   used "THEN" with different IDs) — the display accentuates the new picture. */
function clueImageChanges(cl) {
  if (!cl || cl.answerImage == null) return false;
  const a = imageList(cl.answerImage), q = imageList(cl.image);
  return a.length > 0 && a.join("|") !== q.join("|");
}
/* ---------------- teams: IDs vs names ----------------
   The sheet numbers its teams 1-6. That number is an ID — a handle for the group,
   not something anyone should ever read on the TV. Real names are chosen by the
   players while the "teams" screen is up and typed into the control panel.

   So there are two ways to write a team down:
     teamLabel()     — for the CONTROL PANEL and Host View: the name, or "Team 3"
                       while it hasn't got one. The host needs to tell them apart.
     dispTeamName()  — for the TV: the name, or "" (the screens draw a blank line).
                       Never falls back to the ID.                                  */
function teamIdOf(t, i) { return (t && t.id != null) ? t.id : i + 1; }
function teamNamed(t) { return !!(t && String(t.name || "").trim()); }
function dispTeamName(t) { return String((t && t.name) || "").trim(); }
function teamLabel(t, i) { return dispTeamName(t) || ("Team " + teamIdOf(t, i)); }

/* ---------------- picking order ----------------
   Who chooses the next category rotates equally: S.pickOrder is a shuffle of the
   team indexes, S.pickIdx walks it one step per clue. Anything that changes the
   team list clears the order (see control.js) rather than leaving a stale index
   pointing at a team that no longer exists — but validate anyway, since a state
   snapshot can arrive from another device. */
function pickOrderValid(s) {
  const o = s && s.pickOrder, teams = (s && s.teams) || [];
  if (!Array.isArray(o) || !o.length || o.length !== teams.length) return false;
  if (new Set(o).size !== o.length) return false;
  return o.every(i => Number.isInteger(i) && i >= 0 && i < teams.length);
}
/* The team index whose turn it is to pick, or -1 when no order has been drawn. */
function currentPicker(s) {
  s = s || S;
  if (!pickOrderValid(s)) return -1;
  const n = s.pickOrder.length;
  return s.pickOrder[((s.pickIdx % n) + n) % n];   // wraps, and survives a negative pickIdx
}
/* Fisher-Yates over [0..n-1] — the one-time draw for who picks first. */
function shuffledOrder(n) {
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* The team(s) with the top score — used by the winner screen (handles ties). */
function winnersOf(teams) {
  if (!teams || !teams.length) return [];
  const max = Math.max(...teams.map(t => t.score));
  return teams.filter(t => t.score === max);
}
function money(n) { return (n < 0 ? "-$" : "$") + Math.abs(n).toLocaleString(); }
/* "1st", "2nd", "3rd", "4th"… — place labels for the Final Jeopardy standings. */
function ordinal(n) {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
/* Teams ranked high -> low (1st place first), with standard competition ranks
   so ties share a place (1, 2, 2, 4). Each entry keeps its ORIGINAL index (idx)
   in the passed array, so callers can look up that team's final wager/result.
   Used by the Final Jeopardy standings reveal. */
function finalStandings(teams) {
  const sorted = teams.map((t, i) => ({ team: t, idx: i })).sort((a, b) => b.team.score - a.team.score);
  const top = sorted.length ? sorted[0].team.score : null;
  return sorted.map(e => ({
    team: e.team,
    idx: e.idx,
    rank: sorted.findIndex(x => x.team.score === e.team.score) + 1,   // ties => same rank
    isTop: top !== null && e.team.score === top,
  }));
}
/* A team's Final Jeopardy swing: +wager if it was marked right, -wager if wrong,
   0 if it wasn't scored (or wagered nothing). Drives the green/red delta shown on
   each winner-reveal card. */
function finalDelta(teamIdx) {
  const sign = S.finalAwarded && S.finalAwarded[teamIdx];
  const w = (S.finalWagers && S.finalWagers[teamIdx]) || 0;
  return sign === "+" ? w : sign === "-" ? -w : 0;
}
function currentRound() { return S.game ? S.game.rounds[S.roundIdx] : null; }
function activeClue() {
  const r = currentRound();
  if (!r || !S.active) return null;
  const cat = r.categories[S.active.cat];
  if (!cat) return null;
  return cat.clues[S.active.row] || null;
}
function activeCatName() {
  const r = currentRound();
  return r && S.active ? (r.categories[S.active.cat]?.name || "") : "";
}
function roundDone(r) { return r.categories.every(c => c.clues.every(cl => cl.used)); }
