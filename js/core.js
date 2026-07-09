"use strict";
/* ============================================================
   Core: shared state, window sync, persistence, and helpers.

   The control window owns the authoritative state object S and
   broadcasts a full snapshot after every change (send()). The
   display window is a pure renderer of received snapshots.
   ============================================================ */

const IS_DISPLAY = location.hash.startsWith("#display");
const CHANNEL = new BroadcastChannel("ppi-jeopardy-v1");
const SAVE_KEY = "ppi-jeopardy-state-v1";
const app = document.getElementById("app");

function freshState() {
  return {
    phase: "setup",          // setup | play
    game: null,              // see js/data.js for the game object shape
    roundIdx: 0,
    teams: [],               // [{name, score}]
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

function loadSavedGame() {
  try {
    const saved = localStorage.getItem(SAVE_KEY);
    if (!saved) return null;
    const parsed = JSON.parse(saved);
    if (parsed && parsed.phase === "play" && parsed.game) return parsed;
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

CHANNEL.onmessage = (ev) => {
  const msg = ev.data;
  if (IS_DISPLAY) {
    if (msg.type === "state") { S = msg.state; renderDisplay(); }
    else if (msg.type === "ping-display") { CHANNEL.postMessage({ type: "display-alive" }); }
    else if (msg.type === "play-intro") { playCategoryIntro(); }   // full-screen category reveal
  } else {
    if (msg.type === "hello") { CHANNEL.postMessage({ type: "state", state: snapshot() }); noteDisplaySeen(); }
    else if (msg.type === "display-alive") { noteDisplaySeen(); }
    else if (msg.type === "control-hello") { CHANNEL.postMessage({ type: "control-active" }); }
    else if (msg.type === "control-active") {
      if (!otherControlDetected) { otherControlDetected = true; renderControl(); }
    }
    else if (msg.type === "img-error") {
      // the display couldn't load a clue picture — surface it to the host
      window.__imgErrorSrc = msg.src;
      renderControl();
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
