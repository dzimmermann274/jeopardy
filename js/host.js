"use strict";
/* ============================================================
   Host View — a private companion screen (host.html), for whoever
   reads the questions and judges answers (open on a Mac or iPad).

   TWO MODES, switched by the tabs at the top:

   • LIVE VIEW — a passive mirror of the game: the current question in
     big plain text, the answer (shown to the host even before it's
     revealed on the TV), the 30-second timer, the winner-reveal
     heads-up, and "notes from Danny". The one thing the host can
     CHANGE from here is Final Jeopardy wagers (see below).

   • QUESTION PREVIEW — a bare-bones browser: tap any clue on the board
     to see its question, picture, and answer on one readable screen,
     plus the teams and their scores. Purely for the host's reference;
     it does not touch the game or the TV.

   Isolation: this page loads ONLY js/host.js — none of the game's
   other scripts. It acts on {type:"state"} broadcasts, and it SENDS
   only two things: a read-only "host-hello" snapshot request, and
   "set-final-wager" (the sanctioned Final Jeopardy wager write, which
   the control panel applies to the single source of truth). It can
   never be mistaken for a TV or a second control panel.
   ============================================================ */

const CHANNEL = createBus("ppi-jeopardy-v1");   // js/bus.js: BroadcastChannel + optional LAN relay
const SAVE_KEY = "ppi-jeopardy-state-v1";
const MODE_KEY = "ppi-jeopardy-host-mode";
let S = null;            // latest received game state (null until we hear anything)
let gotState = false;    // true once a live broadcast (not just localStorage) arrives

let mode = "live";       // "live" | "preview" — a per-device UI choice, not game state
try { const m = localStorage.getItem(MODE_KEY); if (m === "live" || m === "preview") mode = m; } catch (e) {}
let previewSel = null;   // preview mode: {cat,row} | "final" | null (the clue being previewed)
let lastContent = null;  // cache of #host-content HTML, so an unchanged state doesn't rebuild
                         //   the DOM (avoids reloading preview <img>s and losing scroll)

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
/* A clue's image field can be one URL, an array, or absent — normalize to a list. */
function imageList(image) {
  if (Array.isArray(image)) return image.filter(Boolean);
  return image ? [image] : [];
}
/* Every picture worth previewing for a clue: the question image(s) plus any
   distinct answer image(s) the sheet gave via "THEN". */
function clueImages(cl) {
  const out = imageList(cl.image);
  imageList(cl.answerImage).forEach(u => { if (!out.includes(u)) out.push(u); });
  return out;
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
// When the LAN relay (re)connects, re-ask so a Host View on another device
// immediately gets the current snapshot from the control panel.
CHANNEL.onnetopen = askForState;
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

/* ---------------- modes ---------------- */
function setMode(m) {
  if (m !== "live" && m !== "preview") return;
  mode = m;
  try { localStorage.setItem(MODE_KEY, m); } catch (e) {}
  updateTabs();
  lastContent = null;   // force a rebuild for the new mode
  render();
}
function updateTabs() {
  document.querySelectorAll("[data-mode]").forEach(b => b.classList.toggle("active", b.dataset.mode === mode));
  document.body.classList.toggle("mode-preview", mode === "preview");
  document.body.classList.toggle("mode-live", mode === "live");
}

/* ---------------- render ---------------- */
/* Live mode is "idle" (no question to protect) on the setup/title/board screens —
   that's when a note may fill the screen. */
function mainIsIdle() {
  if (mode !== "live") return false;
  if (!S || S.phase === "setup") return true;
  if (S.finalPrep) return false;   // the "Ready for Final Jeopardy" screen is content, not idle
  return S.view === "welcome" || S.view === "board";
}

function render() {
  // Don't rebuild the content while the host is typing a Final Jeopardy wager —
  // a state broadcast mid-typing would yank focus / lose the in-progress entry.
  const el = document.activeElement;
  const typingWager = el && el.classList && el.classList.contains("hv-wager-input");
  if (!typingWager) renderContent();
  renderNote();
}

function renderContent() {
  const c = document.getElementById("host-content");
  if (!c) return;
  const html = contentHtml();
  if (html === lastContent) return;   // unchanged — leave the DOM (and its <img>s / handlers) alone
  lastContent = html;
  c.innerHTML = html;
  wireContent();
}

/* (Re)attach handlers after a content rebuild: preview picks + wager commits. */
function wireContent() {
  document.querySelectorAll("[data-pick]").forEach(b => b.onclick = () => {
    const v = b.dataset.pick;
    previewSel = v === "final" ? "final" : { cat: +v.split(":")[0], row: +v.split(":")[1] };
    lastContent = null; render();
  });
  document.querySelectorAll(".hv-wager-input").forEach(inp => {
    inp.onchange = (e) => commitHostWager(+inp.dataset.wager, e.target.value);
  });
}

function contentHtml() {
  if (!S) return idleHtml("Connecting…", "Waiting to hear from the control panel — keep this tab open.");
  if (mode === "preview") return previewHtml();

  // ---- live mode ----
  if (S.finalPrep) return finalReadyHtml();
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
    case "final-intro":   return finalSimpleHtml();
    case "final-category": return `<div class="fj-live">${finalSimpleHtml()}${hostWagerHtml()}</div>`;
    case "final-clue":    return S.finalRevealed ? finalSimpleHtml()
                                 : `<div class="fj-live">${finalSimpleHtml()}${hostWagerHtml()}</div>`;
    case "clue":
    case "dd":            return clueHtml();
    default:              return idleHtml(title, "");
  }
}

/* ---------------- live mode pieces ---------------- */
function idleHtml(title, sub) {
  return `<div class="idle">
    <div class="idle-title">${esc(title)}</div>
    ${sub ? `<div class="idle-sub">${esc(sub)}</div>` : ""}
  </div>`;
}

/* The core question + answer block. The answer always shows (that's the point of
   this screen) — gold while it's host-only, green once it's revealed on the TV. */
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
    <div class="qa-answer ${o.revealed ? "revealed" : ""}">
      <div class="a-label">Answer${o.revealed ? " — revealed on the TV" : " — only you can see this"}</div>
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

/* The control panel is confirming "Start Final Jeopardy?" — a full-screen heads-up. */
function finalReadyHtml() {
  return `<div class="final-ready">
    <div class="fr-kicker">Get ready</div>
    <div class="fr-title">Ready for<br>Final Jeopardy!</div>
  </div>`;
}

/* The whole Final Jeopardy stretch on the live view: deliberately plain —
   Category / Question / Answer, big and readable, gold-while-secret /
   green-once-revealed on the answer. */
function finalSimpleHtml() {
  const f = S.game && S.game.final;
  if (!f) return idleHtml("Final Jeopardy", "Getting ready…");
  const revealed = !!S.finalRevealed;
  const answer = f.answer
    ? `<span class="fs-answer ${revealed ? "revealed" : "secret"}">${fmtText(f.answer)}</span>`
    : `<span class="fs-answer muted">${f.unknown ? "No preset answer — Danny types it in live." : "(no answer in the sheet)"}</span>`;
  return `<div class="final-simple">
    <div class="fs-banner">Final Jeopardy</div>
    <div class="fs-row"><span class="fs-label">Category:</span> <span class="fs-val">${fmtText(f.category)}</span></div>
    <div class="fs-row"><span class="fs-label">Question:</span> <span class="fs-val">${fmtText(f.clue)}</span></div>
    <div class="fs-row"><span class="fs-label">Answer:</span> ${answer}</div>
  </div>`;
}

/* Final Jeopardy wager entry — the one place the host can change the game. Seeded
   from S.finalWagers (the single source of truth) and committed on blur/Enter via
   a set-final-wager message; the control panel can enter the same wagers, and both
   ends stay in sync. */
function hostWagerHtml() {
  const teams = S.teams || [];
  if (!teams.length || !Array.isArray(S.finalWagers)) return "";
  return `<div class="hv-wagers">
    <div class="hv-wagers-title">Final Jeopardy wagers</div>
    <div class="hv-wagers-sub">Enter each team's wager — this syncs with the control panel.</div>
    ${teams.map((t, i) => `<div class="hv-wager-row">
      <span class="hv-wager-name">${esc(t.name)} <span class="hv-wager-score">(${money(t.score)})</span></span>
      <input class="hv-wager-input" type="number" inputmode="numeric" min="0" step="100"
             data-wager="${i}" value="${S.finalWagers[i] ? esc(String(S.finalWagers[i])) : ""}" placeholder="0">
    </div>`).join("")}
  </div>`;
}
function commitHostWager(i, value) {
  const w = Math.max(0, Math.round(+value) || 0);
  try { CHANNEL.postMessage({ type: "set-final-wager", teamIdx: i, wager: w }); } catch (e) {}
  // The control applies it and broadcasts back; that echo re-renders us with the
  // committed value. (While a wager field is focused, render() leaves the DOM be.)
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

/* The winner-reveal heads-up: which team is announced NEXT and their score, plus a
   small reference of the whole field (matches the control panel's last->first
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

/* ---------------- preview mode ---------------- */
function previewHtml() {
  if (!S || !S.game) return idleHtml("Question preview", "No game loaded yet — pick a game on the control panel.");
  const r = currentRound();
  return `<div class="pv">
    ${scoresPanelHtml()}
    ${r ? previewBoardHtml(r) : `<div class="pv-empty">No board to preview.</div>`}
    ${previewSelectionHtml(r)}
  </div>`;
}

function scoresPanelHtml() {
  const teams = S.teams || [];
  if (!teams.length) return "";
  const sorted = [...teams].sort((a, b) => b.score - a.score);
  return `<div class="pv-scores">
    ${sorted.map(t => `<div class="pv-score">
      <span class="pvs-name">${esc(t.name)}</span>
      <span class="pvs-val${t.score < 0 ? " neg" : ""}">${money(t.score)}</span>
    </div>`).join("")}
  </div>`;
}

function previewBoardHtml(r) {
  const cols = r.categories.map((c, ci) => `
    <div class="pv-col">
      <div class="pv-col-head">${esc(c.name)}</div>
      ${c.clues.map((cl, ri) => {
        const seld = previewSel && previewSel.cat === ci && previewSel.row === ri;
        return `<button class="pv-cell${cl.used ? " used" : ""}${seld ? " sel" : ""}" data-pick="${ci}:${ri}">${money(cl.value)}${cl.dd ? ` <span class="pv-dd">DD</span>` : ""}</button>`;
      }).join("")}
    </div>`).join("");
  const fin = (S.game.final) ? `<button class="pv-cell pv-final${previewSel === "final" ? " sel" : ""}" data-pick="final">Final Jeopardy</button>` : "";
  return `<div class="pv-board">${cols}</div>${fin}`;
}

function previewSelectionHtml(r) {
  let head, question, images, answer, unknown;
  if (previewSel === "final" && S.game.final) {
    const f = S.game.final;
    head = "Final Jeopardy — " + f.category;
    question = f.clue; images = clueImages(f); answer = f.answer; unknown = f.unknown;
  } else if (previewSel && r && r.categories[previewSel.cat] && r.categories[previewSel.cat].clues[previewSel.row]) {
    const cat = r.categories[previewSel.cat], cl = cat.clues[previewSel.row];
    head = cat.name + " — " + money(cl.value) + (cl.dd ? " · Daily Double" : "");
    question = cl.clue; images = clueImages(cl); answer = cl.answer; unknown = cl.unknown;
  } else {
    return `<div class="pv-empty">Tap a question above to preview it.</div>`;
  }
  const imgs = images.map(u => `<img class="pv-img" src="${esc(u)}" alt="">`).join("");
  return `<div class="pv-card">
    <div class="pv-card-head">${esc(head)}</div>
    <div class="pv-q">${fmtText(question)}</div>
    ${imgs ? `<div class="pv-imgs">${imgs}</div>` : ""}
    <div class="pv-a-row"><span class="pv-a-label">Answer:</span>
      <span class="pv-a-text${!answer ? " muted" : ""}">${answer ? fmtText(answer) : (unknown ? "No preset answer — decided live." : "(no answer in the sheet)")}</span>
    </div>
  </div>`;
}

/* ---------------- note from Danny ---------------- */
let lastNoteTs = null;
function renderNote() {
  const el = document.getElementById("host-note");
  if (!el) return;
  const note = (S && S.hostNote && S.hostNote.text) ? S.hostNote.text : "";
  const ts = (S && S.hostNote && S.hostNote.ts) || 0;
  const large = mainIsIdle();   // large only in live mode when nothing else is on screen
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

/* ---------------- 30-second timer (corner, live mode) ---------------- */
/* A steady interval reads the live S.timer so the countdown ticks between state
   broadcasts; it hides itself when no timer is running, in preview mode, and over
   the scores/winner screens. setInterval (not requestAnimationFrame) keeps ticking
   even if the host's tab is backgrounded — rAF pauses in a hidden tab. */
function timerTick() {
  const el = document.getElementById("host-timer");
  const num = document.getElementById("host-timer-num");
  if (!el || !num) return;
  let show = false;
  const blocked = mode !== "live" || !S || !S.timer || S.view === "winner" || S.view === "bigscores";
  if (!blocked) {
    const remaining = S.timer.seconds - (Date.now() - S.timer.startedAt) / 1000;
    if (remaining > 0) {
      show = true;
      num.textContent = String(Math.ceil(remaining));
      el.classList.toggle("low", remaining <= 5);
    }
  }
  el.hidden = !show;
  document.body.classList.toggle("timer-on", show);
}

/* ---------------- boot ---------------- */
document.querySelectorAll("[data-mode]").forEach(b => b.onclick = () => setMode(b.dataset.mode));
updateTabs();
askForState();
setInterval(timerTick, 200);
timerTick();
render();
