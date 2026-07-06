"use strict";
/* ============================================================
   Data loading: Google Sheets fetch + CSV parsing + game building.
   A game object looks like:
   { title, rounds: [{ name, categories: [{ name, clues: [{value, clue, answer, dd, used}] }] }],
     final: { category, clue, answer } | null }
   ============================================================ */

function parseCSV(text) {
  const rows = []; let row = []; let field = ""; let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else { inQ = false; }
      } else field += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (ch === "\r") { /* skip */ }
    else field += ch;
  }
  row.push(field);
  if (row.length > 1 || row[0] !== "") rows.push(row);
  return rows;
}

/* Build a game object from spreadsheet rows.
   Expected headers (case-insensitive, order-free, extra columns ignored):
   Round | Category | Value | Clue (or Question) | Answer | Daily Double
   Blank Round/Category cells inherit the value from the row above, so
   spreadsheet "ditto" habits work.                                       */
function buildGameFromRows(rows) {
  if (!rows.length) throw new Error("The sheet appears to be empty.");
  const headers = rows[0].map(h => h.trim().toLowerCase());
  // exact header match wins; only fall back to a prefix match for longer
  // names so e.g. "Question ID" can't shadow a real "Clue" column.
  const col = (names) => {
    let idx = headers.findIndex(h => names.some(n => h === n));
    if (idx === -1) idx = headers.findIndex(h => names.some(n => n.length > 2 && h.startsWith(n)));
    return idx;
  };
  const cRound = col(["round"]);
  const cCat   = col(["category"]);
  const cVal   = col(["value", "points", "amount"]);
  const cClue  = col(["clue", "question"]);
  const cAns   = col(["answer"]);
  const cDD    = col(["daily double", "dailydouble", "daily_double", "dd"]);
  if (cCat === -1 || cClue === -1 || cAns === -1) {
    throw new Error("Couldn't find the required columns. The sheet needs header columns named Category, Clue (or Question), and Answer — plus optional Round, Value, and Daily Double columns.");
  }

  const roundsMap = new Map();  // key -> Map(categoryName -> clues[])
  let final = null;
  let lastCat = "";
  let lastRound = "1";
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.every(f => !String(f ?? "").trim())) continue;
    let cat = String(r[cCat] ?? "").trim();
    if (!cat) cat = lastCat; else lastCat = cat;
    const clue = String(r[cClue] ?? "").trim();
    const ans = String(r[cAns] ?? "").trim();
    if (!clue && !ans) continue;
    let roundRaw = cRound >= 0 ? String(r[cRound] ?? "").trim().toLowerCase() : "";
    if (!roundRaw) roundRaw = lastRound; else lastRound = roundRaw;
    if (roundRaw === "f" || roundRaw.startsWith("final")) {   // Final Jeopardy row (first one wins)
      if (!final) final = { category: cat || "Final Jeopardy", clue, answer: ans };
      continue;
    }
    const rKey = roundRaw;
    if (!roundsMap.has(rKey)) roundsMap.set(rKey, new Map());
    const cats = roundsMap.get(rKey);
    if (!cats.has(cat)) cats.set(cat, []);
    const valRaw = cVal >= 0 ? String(r[cVal] ?? "").replace(/[$,\s]/g, "") : "";
    const dd = cDD >= 0 ? /^(y|yes|true|x|1)$/i.test(String(r[cDD] ?? "").trim()) : false;
    cats.get(cat).push({ value: valRaw ? parseInt(valRaw, 10) || 0 : 0, clue, answer: ans, dd });
  }

  const roundKeys = [...roundsMap.keys()].sort((a, b) => (parseInt(a) || 99) - (parseInt(b) || 99));
  if (!roundKeys.length && !final) throw new Error("No question rows found under the header row.");
  const rounds = roundKeys.map((key, ri) => {
    const cats = roundsMap.get(key);
    const categories = [...cats.entries()].map(([name, clues]) => {
      // fill in missing values by position: 200/400/... doubled in round 2+
      const mult = (ri + 1) * 200;
      clues.forEach((cl, idx) => { if (!cl.value) cl.value = (idx + 1) * mult; });
      clues.sort((a, b) => a.value - b.value);
      return { name, clues };
    });
    const label = roundKeys.length > 1
      ? (ri === 0 ? "Jeopardy!" : ri === 1 ? "Double Jeopardy!" : "Round " + key)
      : "Jeopardy!";
    return { name: label, categories };
  });
  if (!rounds.length) throw new Error("The sheet only has a Final Jeopardy row — add regular question rows too.");
  return { title: "Custom Game", rounds, final };
}

/* Extract a spreadsheet ID (and optional tab gid) from whatever gets pasted. */
function parseSheetRef(input) {
  const s = input.trim();
  const idMatch = s.match(/\/d\/([a-zA-Z0-9-_]{20,})/) || s.match(/^([a-zA-Z0-9-_]{25,})$/);
  if (!idMatch) return null;
  const gidMatch = s.match(/[#?&]gid=(\d+)/);
  return { id: idMatch[1], gid: gidMatch ? gidMatch[1] : null };
}

/* Fetch a CSV URL with a timeout; returns null on any failure
   (network error, non-200, or an HTML page such as a login redirect). */
async function fetchCsv(url, timeoutMs) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { signal: ctrl.signal });
    if (!resp.ok) return null;
    const text = await resp.text();
    if (/^\s*</.test(text)) return null;
    return text;
  } catch (e) {
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function loadSheet(input) {
  const ref = parseSheetRef(input);
  if (!ref) throw new Error("That doesn't look like a Google Sheets link. Paste the full link from the browser address bar (it contains /spreadsheets/d/...).");
  const gid = ref.gid ? `&gid=${ref.gid}` : "";
  // Primary: the export endpoint — no type inference, so a Round column of
  // mixed numbers and "Final" survives verbatim. Fallback: the gviz endpoint.
  const exportUrl = `https://docs.google.com/spreadsheets/d/${ref.id}/export?format=csv${gid}`;
  const gvizUrl = `https://docs.google.com/spreadsheets/d/${ref.id}/gviz/tq?tqx=out:csv${gid}`;
  const text = (await fetchCsv(exportUrl, 20000)) ?? (await fetchCsv(gvizUrl, 20000));
  if (text == null) {
    throw new Error("Couldn't load the sheet. This usually means it isn't shared as “Anyone with the link – Viewer” — ask the question-writer to double-check Share settings. (If sharing is right, check the internet connection and the link itself.)");
  }
  return buildGameFromRows(parseCSV(text));
}
