"use strict";
/* ============================================================
   Core: shared state, window sync, persistence, and helpers.

   The control window owns the authoritative state object S and
   broadcasts a full snapshot after every change (send()). The
   display window is a pure renderer of received snapshots.
   ============================================================ */

const IS_DISPLAY = location.hash === "#display";
const CHANNEL = new BroadcastChannel("ppi-jeopardy-v1");
const SAVE_KEY = "ppi-jeopardy-state-v1";
const app = document.getElementById("app");

function freshState() {
  return {
    phase: "setup",          // setup | play
    game: null,              // see js/data.js for the game object shape
    roundIdx: 0,
    teams: [],               // [{name, score}]
    view: "welcome",         // welcome | board | clue | dd | final-category | final-clue | bigscores | winner
    prevView: null,          // view to return to when leaving bigscores
    winnerPrev: null,        // view to return to when leaving the winner screen (separate from bigscores)
    active: null,            // {cat, row}
    revealed: false,
    dd: null,                // {teamIdx, wager} while a daily double is being played
    awarded: {},             // teamIdx -> "+"|"-" for the active clue (double-award guard)
    finalWagers: [],         // per-team wagers for final
    finalRevealed: false,
    finalAwarded: {},        // teamIdx -> "+"|"-" for final (double-award guard)
    timer: null,             // {startedAt, seconds}
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

CHANNEL.onmessage = (ev) => {
  const msg = ev.data;
  if (IS_DISPLAY) {
    if (msg.type === "state") { S = msg.state; renderDisplay(); }
  } else {
    if (msg.type === "hello") { CHANNEL.postMessage({ type: "state", state: snapshot() }); }
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
/* The team(s) with the top score — used by the winner screen (handles ties). */
function winnersOf(teams) {
  if (!teams || !teams.length) return [];
  const max = Math.max(...teams.map(t => t.score));
  return teams.filter(t => t.score === max);
}
function money(n) { return (n < 0 ? "-$" : "$") + Math.abs(n).toLocaleString(); }
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
