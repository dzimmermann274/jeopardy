"use strict";
/* ============================================================
   Host View — a private, read-only companion screen (host.html).

   Whoever reads the questions and judges the answers opens this on
   a Mac or iPad. It is a PASSIVE listener on the same
   BroadcastChannel the game already uses, so it shows:
     • the current question in big, plain text;
     • the answer — even before it's revealed on the TV — so the
       host can judge responses;
     • the 30-second timer, in a corner, only while it's running;
     • during the winner reveal, a heads-up of which team is
       announced next and their score;
     • "notes from Danny" pushed from the control panel.

   It NEVER mutates game state and NEVER affects the control panel
   or the TV.

   Isolation guarantee: this page does NOT load core.js / control.js
   / display.js. It only READS {type:"state"} broadcasts and sends a
   single {type:"host-hello"} to request the current snapshot when it
   opens — so it can never be mistaken for a TV (display) or for a
   second control panel (which would trip the game's own guards).
   ============================================================ */

const CHANNEL = new BroadcastChannel("ppi-jeopardy-v1");
const SAVE_KEY = "ppi-jeopardy-state-v1";
let S = null;            // latest received game state (null until we hear anything)
let gotState = false;    // true once a live broadcast (not just localStorage) arrives

/* ---------------- helpers (mirrored from core.js) ---------------- */
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
/* "##" in a sheet cell marks a line break (a cell can't hold a real newline). */
function fmtText(s) { return esc(s).split("##").join("<br>"); }
function money(n) { return (n < 0 ? "-$" : "$") + Math.abs(n).toLocaleString(); }
function ordinal(n) {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
function winnersOf(teams) {
  if (!teams || !teams.length) return [];
  const max = Math.max(...teams.map(t => t.score));
  return teams.filter(t => t.score === max);
}
/* Teams high -> low with standard competition ranks (ties share a place); each
   keeps its ORIGINAL index so we can look up that team's Final wager/result. */
function finalStandings(teams) {
  const sorted = teams.map((t, i) => ({ team: t, idx: i })).sort((a, b) => b.team.score - a.team.score);
  const top = sorted.length ? sorted[0].team.score : null;
  return sorted.map(e => ({
    team: e.team,
    idx: e.idx,
    rank: sorted.findIndex(x => x.team.score === e.team.score) + 1,
    isTop: top !== null && e.team.score === top,
  }));
}
/* A team's Final Jeopardy swing: +wager if right, -wager if wrong, 0 otherwise. */
function finalDelta(teamIdx) {
  const sign = S && S.finalAwarded && S.finalAwarded[teamIdx];
  const w = (S && S.finalWagers && S.finalWagers[teamIdx]) || 0;
  return sign === "+" ? w : sign === "-" ? -w : 0;
}
function currentRound() { return S && S.game ? S.game.rounds[S.roundIdx] : null; }
function activeClue() {
  const r = currentRound();
  if (!r || !S.active) return null;
  const cat = r.categories[S.active.cat];
  if (!cat) return null;
  return cat.clues[S.active.row] || null;
}
function activeCatName() {
  const r = currentRound();
  return r && S.active ? (r.categories[S.active.cat] && r.categories[S.active.cat].name || "") : "";
}

/* ---------------- receive state (passive) ---------------- */
CHANNEL.onmessage = (ev) => {
  const msg = ev.data;
  if (msg && msg.type === "state") {   // the ONLY message we ever act on
    S = msg.state;
    gotState = true;
    render();
  }
};

/* Ask the control panel for the current snapshot. It answers read-only (see
   core.js "host-hello") without treating us as a TV. Retry a while in case the
   Host View was opened before the control panel — and re-ask on refocus so a
   backgrounded tab catches up instantly. */
function askForState() { try { CHANNEL.postMessage({ type: "host-hello" }); } catch (e) {} }
let helloTries = 0;
const helloTimer = setInterval(() => {
  if (gotState || ++helloTries > 40) { clearInterval(helloTimer); return; }
  askForState();
}, 1500);
document.addEventListener("visibilitychange", () => { if (!document.hidden) askForState(); });

/* Seed instantly from the last saved play state (the control panel persists on
   every change), so a mid-game open paints before the live reply arrives. This
   never sets gotState, so the retry above keeps asking for the authoritative copy. */
try {
  const saved = localStorage.getItem(SAVE_KEY);
  if (saved) { const p = JSON.parse(saved); if (p && p.game) S = p; }
} catch (e) { /* no/blocked storage — we'll paint once a broadcast arrives */ }

/* ---------------- render ---------------- */
/* The main area is "idle" (no question to protect) on the setup/title/board
   screens — that's when a note may fill the screen. */
function mainIsIdle() {
  if (!S || S.phase === "setup") return true;
  return S.view === "welcome" || S.view === "board";
}

function render() {
  const el = document.getElementById("host-content");
  if (el) el.innerHTML = contentHtml();
  renderNote();
}

function contentHtml() {
  if (!S) return idleHtml("Connecting…", "Waiting to hear from the control panel — keep this tab open.");
  const title = (S.game && S.game.title) || "Jeopardy";
  if (S.phase === "setup") {
    return idleHtml(title, S.game ? "Game loaded — waiting for the host to start." : "Waiting for the game to be set up.");
  }
  switch (S.view) {
    case "welcome":       return idleHtml(title, "Title screen is on the TV. Get ready…");
    case "board":         return idleHtml(title, "Board is up — waiting for a question to be picked.");
    case "bigscores":     return scoresHtml("Current scores");
    case "winner":        return winnerHtml();
    case "final-winner":  return finalWinnerHtml();
    case "final-intro":
    case "final-category": return finalPrepHtml(S.view);
    case "final-clue":    return finalClueHtml();
    case "clue":
    case "dd":            return clueHtml();
    default:              return idleHtml(title, "");
  }
}

function idleHtml(title, sub) {
  return `<div class="idle">
    <div class="idle-title">${esc(title)}</div>
    ${sub ? `<div class="idle-sub">${esc(sub)}</div>` : ""}
  </div>`;
}

/* The core question + answer block. The answer always shows (that's the point of
   this screen) — with a clear badge for whether it's on the TV yet. */
function qaHtml(o) {
  const answerInner = o.answer
    ? `<div class="a-text">${fmtText(o.answer)}</div>`
    : `<div class="a-text muted">${o.unknown ? "No preset answer — Danny types it in live on the control panel." : "(no answer in the sheet)"}</div>`;
  return `<div class="qa">
    <div class="qa-head">
      ${o.tag ? `<span class="qa-tag">${esc(o.tag)}</span>` : ""}
      <span class="qa-cat">${fmtText(o.label)}</span>
    </div>
    <div class="qa-q">${fmtText(o.question)}</div>
    <div class="qa-answer">
      <div class="a-label">Answer</div>
      ${answerInner}
    </div>
    <div class="qa-status ${o.revealed ? "on" : "off"}">
      ${o.revealed ? "● Answer is showing on the TV" : "○ Not yet revealed on the TV — only you can see it"}
    </div>
  </div>`;
}

function clueHtml() {
  const cl = activeClue();
  if (!cl) return idleHtml((S.game && S.game.title) || "Jeopardy", "Waiting for the clue…");
  const amount = S.dd && S.dd.wager != null ? S.dd.wager : cl.value;
  const label = activeCatName() + (amount ? " — " + money(amount) : "");
  return qaHtml({ label, tag: cl.dd ? "DAILY DOUBLE" : "", question: cl.clue, answer: cl.answer, unknown: cl.unknown, revealed: !!S.revealed });
}

function finalClueHtml() {
  const f = S.game && S.game.final;
  if (!f) return idleHtml("Final Jeopardy", "Waiting…");
  return qaHtml({ label: f.category, tag: "FINAL JEOPARDY", question: f.clue, answer: f.answer, unknown: f.unknown, revealed: !!S.finalRevealed });
}

/* During the Final intro / category reveal, show the clue and answer ahead of
   time so the host can prepare to judge (this screen is private to the host). */
function finalPrepHtml(view) {
  const f = S.game && S.game.final;
  if (!f) return idleHtml("Final Jeopardy", "Getting ready…");
  const where = view === "final-intro" ? "Instructions are on the TV" : "Category is on the TV";
  return `<div class="prep-banner">Coming up — Final Jeopardy · ${esc(where)}</div>` +
    qaHtml({ label: f.category, tag: "FINAL JEOPARDY · PREP", question: f.clue, answer: f.answer, unknown: f.unknown, revealed: !!S.finalRevealed });
}

function scoresHtml(title) {
  const sorted = [...(S.teams || [])].sort((a, b) => b.score - a.score);
  return `<div class="scores">
    <div class="scores-title">${esc(title)}</div>
    <div class="scores-list">
      ${sorted.map(t => `<div class="score-row">
        <span class="s-name">${esc(t.name)}</span>
        <span class="s-score ${t.score < 0 ? "neg" : ""}">${money(t.score)}</span>
      </div>`).join("")}
    </div>
  </div>`;
}

function winnerHtml() {
  const teams = S.teams || [];
  const champs = winnersOf(teams);
  const tie = champs.length > 1;
  const top = champs.length ? champs[0].score : 0;
  const sorted = [...teams].sort((a, b) => b.score - a.score);
  return `<div class="scores">
    <div class="winner-banner">${tie ? "IT'S A TIE" : "WINNER"} — on the TV now</div>
    <div class="winner-name">${champs.map(t => esc(t.name)).join(" &amp; ")}</div>
    <div class="winner-score">${money(top)}</div>
    <div class="scores-list">
      ${sorted.map(t => `<div class="score-row ${t.score === top ? "win" : ""}">
        <span class="s-name">${esc(t.name)}</span>
        <span class="s-score ${t.score < 0 ? "neg" : ""}">${money(t.score)}</span>
      </div>`).join("")}
    </div>
  </div>`;
}

/* The winner-reveal heads-up: which team is announced NEXT and their score, plus
   a small reference of the whole field (matches the control panel's last->first
   reveal: nextIdx = N-1-revealed). */
function finalWinnerHtml() {
  const teams = S.teams || [];
  const st = finalStandings(teams);        // high -> low
  const N = st.length;
  const revealed = Math.min(Math.max(S.finalReveal || 0, 0), N);
  const nextIdx = N - 1 - revealed;        // bottom-most not-yet-shown

  let headsUp;
  if (N === 0) {
    headsUp = `<div class="headsup"><div class="hu-kicker">No teams</div></div>`;
  } else if (revealed >= N) {
    const champs = st.filter(s => s.isTop);
    headsUp = `<div class="headsup done">
      <div class="hu-kicker">All places revealed</div>
      <div class="hu-name">${champs.map(c => esc(c.team.name)).join(" &amp; ")}</div>
      <div class="hu-line">${champs.length > 1 ? "Co-champions" : "Champion"} · ${money(champs.length ? champs[0].team.score : 0)}</div>
    </div>`;
  } else {
    const next = st[nextIdx];
    const d = finalDelta(next.idx);
    const dTxt = d > 0 ? "+" + money(d) : d < 0 ? money(d) : "$0";
    const dCls = d > 0 ? "up" : d < 0 ? "down" : "";
    headsUp = `<div class="headsup">
      <div class="hu-kicker">${revealed === 0 ? "Tallying scores… announce first:" : "Announce next:"}</div>
      <div class="hu-place">${ordinal(next.rank)} place${next.isTop ? " — the CHAMPION" : ""}</div>
      <div class="hu-name">${esc(next.team.name)}</div>
      <div class="hu-line">Score <b>${money(next.team.score)}</b> &nbsp;·&nbsp; Final Jeopardy <b class="${dCls}">${dTxt}</b></div>
    </div>`;
  }

  const ref = st.map((s, i) => {
    const shown = i >= N - revealed;
    const isNext = i === nextIdx && revealed < N;
    return `<div class="hu-ref-row ${shown ? "shown" : ""} ${isNext ? "next" : ""}">
      <span class="r-place">${ordinal(s.rank)}</span>
      <span class="r-name">${esc(s.team.name)}</span>
      <span class="r-score">${money(s.team.score)}</span>
      <span class="r-state">${shown ? "revealed" : isNext ? "next ▸" : "hidden"}</span>
    </div>`;
  }).join("");

  return `<div class="headsup-wrap">
    <div class="hu-title">🏆 Winner reveal — last place to first</div>
    ${headsUp}
    ${N ? `<div class="hu-ref">${ref}</div>` : ""}
  </div>`;
}

/* ---------------- note from Danny ---------------- */
let lastNoteTs = null;
function renderNote() {
  const el = document.getElementById("host-note");
  if (!el) return;
  const note = (S && S.hostNote && S.hostNote.text) ? S.hostNote.text : "";
  const ts = (S && S.hostNote && S.hostNote.ts) || 0;
  const large = mainIsIdle();
  document.body.classList.toggle("has-large-note", !!note && large);
  if (!note) {
    el.hidden = true;
    el.className = "host-note";
    el.innerHTML = "";
    lastNoteTs = ts;
    return;
  }
  el.hidden = false;
  el.className = "host-note " + (large ? "large" : "compact");
  el.innerHTML = `<div class="note-label">Note from Danny</div><div class="note-text">${fmtText(note)}</div>`;
  if (ts !== lastNoteTs) {   // a freshly-sent note pops, even if the text repeats
    el.classList.remove("pop");
    void el.offsetWidth;
    el.classList.add("pop");
    lastNoteTs = ts;
  }
}

/* ---------------- 30-second timer (corner) ---------------- */
/* A steady interval reads the live S.timer so the countdown ticks between state
   broadcasts; it hides itself when no timer is running (and never over the
   scores/winner screens, matching the TV). setInterval (not requestAnimationFrame)
   keeps ticking even if the host's tab is backgrounded or the screen dims — rAF
   pauses in a hidden tab and would freeze the number. */
function timerTick() {
  const el = document.getElementById("host-timer");
  const num = document.getElementById("host-timer-num");
  if (!el || !num) return;
  let show = false;
  const blocked = !S || !S.timer || S.view === "winner" || S.view === "bigscores";
  if (!blocked) {
    const remaining = S.timer.seconds - (Date.now() - S.timer.startedAt) / 1000;
    if (remaining > 0) {
      show = true;
      num.textContent = String(Math.ceil(remaining));
      el.classList.toggle("low", remaining <= 5);
    }
  }
  el.hidden = !show;
  // While the timer shows, drop the content below it so a long question never
  // runs under the corner numerals (see body.timer-on in host.html).
  document.body.classList.toggle("timer-on", show);
}

/* ---------------- boot ---------------- */
askForState();
setInterval(timerTick, 200);
timerTick();
render();
