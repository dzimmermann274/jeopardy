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

function openDisplay() {
  displayWin = window.open(location.pathname + "#display", "ppiJeopardyDisplay",
    "width=1280,height=720");
  setTimeout(send, 600);  // give it a moment, then push state (it also says hello)
}

function displayLooksOpen() { return displayWin && !displayWin.closed; }

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
      <p class="hint">Click the button below — a second window opens. Drag it onto the TV, then click the
      ⛶ Fullscreen button in its top-right corner (or press F in that window).</p>
      <div class="field-row" style="margin-top:12px">
        <button class="btn" id="btnOpenDisplay">Open display window</button>
        <button class="btn primary" id="btnStart" ${S.game ? "" : "disabled"}>Start the game ▶</button>
      </div>
      ${S.game ? "" : `<p class="hint">Load questions first to enable Start.</p>`}
    </div>
  </div>`;

  const bResume = document.getElementById("btnResume");
  if (bResume) bResume.onclick = () => {
    const sg = loadSavedGame();
    if (sg) update(() => { S = sg; });
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
  document.getElementById("btnOpenDisplay").onclick = () => { collectTeamNames(); openDisplay(); renderControl(); };
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
}

/* ---------------- play screen ---------------- */
function renderPlay() {
  const r = currentRound();
  const cl = activeClue();
  const inClue = S.view === "clue" || S.view === "dd";
  const isDD = cl && cl.dd && S.dd;
  const isFinal = S.view === "final-category" || S.view === "final-clue";

  let mainHtml = "";
  if (isFinal) mainHtml = finalControlHtml();
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
        <button class="btn small" id="btnShowScores">${S.view === "bigscores" ? "◀ Back to game" : "Show scores on TV"}</button>
        ${S.game.rounds.length > S.roundIdx + 1 && !isFinal ? `<button class="btn small" id="btnNextRound">Next round →</button>` : ""}
        ${S.game.final && !isFinal && S.view !== "bigscores" ? `<button class="btn small gold" id="btnFinal">Final Jeopardy</button>` : ""}
        <button class="btn small" id="btnReset">⟲ New game</button>
      </div>
    </div>
    ${otherControlBannerHtml()}
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
  document.getElementById("btnShowScores").onclick = () =>
    update(() => {
      if (S.view === "bigscores") { S.view = S.prevView || "board"; S.prevView = null; }
      else { S.prevView = S.view; S.view = "bigscores"; }
    });
  const nx = document.getElementById("btnNextRound");
  if (nx) nx.onclick = () => {
    const cur = currentRound();
    const msg = roundDone(cur) ? "Move on to the next round?" : "Some clues haven't been played yet. Move on to the next round anyway?";
    if (confirm(msg)) update(() => {
      S.roundIdx++; S.view = "board"; S.prevView = null;
      S.active = null; S.revealed = false; S.dd = null; S.awarded = {}; S.timer = null;
    });
  };
  const fj = document.getElementById("btnFinal");
  if (fj) fj.onclick = () => {
    if (confirm("Start Final Jeopardy? (The category will appear on the TV.)")) {
      liveAnswerDraft = "";
      update(() => {
        S.view = "final-category"; S.prevView = null;
        S.finalRevealed = false; S.finalAwarded = {};
        S.active = null; S.dd = null; S.awarded = {}; S.timer = null;
        if (!Array.isArray(S.finalWagers) || S.finalWagers.length !== S.teams.length) {
          S.finalWagers = S.teams.map(() => 0);
        }
      });
    }
  };
  document.getElementById("btnReset").onclick = () => {
    if (confirm("Start over completely? Scores and board progress will be erased.")) {
      clearSavedGame();
      finalWagerDrafts = null;
      update(() => { S = freshState(); });
    }
  };
  app.querySelectorAll("[data-adj]").forEach(b => b.onclick = () => {
    const [i, d] = b.dataset.adj.split(":").map(Number);
    update(() => { S.teams[i].score += d; });
  });
  app.querySelectorAll("[data-editscore]").forEach(b => b.onclick = () => {
    const i = +b.dataset.editscore;
    const v = prompt("New score for " + S.teams[i].name + ":", S.teams[i].score);
    if (v !== null && v.trim() !== "" && !isNaN(+v)) update(() => { S.teams[i].score = Math.round(+v); });
  });

  wireMain();

  function wireMain() {
    app.querySelectorAll("[data-pick]").forEach(b => b.onclick = () => {
      const [c, row] = b.dataset.pick.split(":").map(Number);
      const clue = r.categories[c].clues[row];
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
      if (!txt) { alert("Type the answer first."); return; }
      update(() => {
        const c = activeClue(); if (!c) return;
        c.answer = txt; c.unknown = false;
        S.revealed = true; S.timer = null;
      });
    };
    const bFinalLive = document.getElementById("btnFinalLiveReveal");
    if (bFinalLive) bFinalLive.onclick = () => {
      const txt = liveAnswerDraft.trim();
      if (!txt) { alert("Type the answer first."); return; }
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
      if (String(ddDraft.wager).trim() === "" || isNaN(w) || w < 0) { alert("Enter a wager amount."); return; }
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
      cells += `<button class="mini-tile ${clue.used ? "used" : ""} ${clue.dd && !clue.used ? "dd" : ""}"
        ${clue.used ? "disabled" : ""} data-pick="${c}:${idx}">$${clue.value}</button>`;
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
    answerHtml = `<div class="answer-shown">✅ Answer (now on the TV): &nbsp;${esc(cl.answer)}</div>`;
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
      <div class="cluetext">${esc(cl.clue)}</div>
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
    fAnswerHtml = `<div class="answer-shown">✅ Answer (now on the TV): &nbsp;${esc(f.answer)}</div>`;
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
    <div class="clue-box"><div class="label">On the TV right now</div><div class="cluetext">${esc(f.clue)}</div></div>
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
