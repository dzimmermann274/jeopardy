"use strict";
/* ============================================================
   Data loading: Google Sheets fetch + workbook/CSV parsing.

   PRIMARY FORMAT — the "Jeopardy Questions" workbook:
     • every tab is ONE category, named by its tab name;
     • tabs named like "READ ME"/"Instructions" or "Game Setup"
       are not categories;
     • each category tab has a header row containing "Question"
       and "Answer"; data rows below hold Value | Question | Answer;
     • a row whose question is blank produces NO tile, an empty
       tab produces NO category — the game mirrors the sheet;
     • a "Daily Double" label followed by a dollar amount marks
       that level as the Daily Double;
     • the Game Setup tab supplies the game title, team names,
       players per team, and an optional Final Jeopardy.

   LEGACY FORMAT (still supported): one tab with header row
   Round | Category | Value | Clue | Answer | Daily Double.

   A game object:
   { title, rounds: [{ name, categories: [{ name, clues: [{value, clue, answer, dd, used}] }] }],
     final: {category, clue, answer, unknown, instructions} | null,
     teams: [{name, players: []}] }          // suggested teams from the sheet
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

/* ---------------- workbook (tab-per-category) format ---------------- */

/* Special-tab names are matched only at the START of the tab name (after any
   emoji/punctuation) so a category named e.g. "Cooking Instructions" or
   "Greek Gods & Attributes" is NOT swallowed as a special tab. */
function isMetaTabName(n) { return /^\W*(read\s*me|instructions?\b)/iu.test(n.trim()); }
function isSetupTabName(n) { return /^\W*(game\s*setup|game\s*attributes?|setup\b|attributes?\b)/iu.test(n.trim()); }
function isQuestionBankTabName(n) { return /^\W*(question\s*bank|master\s*list)/iu.test(n.trim()); }
function isImageBankTabName(n) { return /^\W*(image\s*bank|picture\s*bank)/iu.test(n.trim()); }

/* Google Drive share links can't be used in <img> directly — convert them
   to the direct-view host. Anything else passes through untouched. */
function normalizeImageUrl(url) {
  const m = String(url).match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:.*&)?id=)([-\w]{20,})/);
  return m ? `https://lh3.googleusercontent.com/d/${m[1]}` : String(url).trim();
}

/* The Image Bank tab -> map of image ID -> direct URL.
   The ID header and the link header must be DIFFERENT cells — otherwise the
   tab's banner row ("...paste picture links... Image ID...") is mistaken for
   the header and the whole bank parses empty. */
function parseImageBank(ws) {
  const rows = sheetRows(ws);
  const map = {};
  const headerIdx = rows.findIndex(r => {
    const i = r.findIndex(c => /\bid\b/i.test(c));
    return i !== -1 && r.some((c, j) => j !== i && /link|url/i.test(c));
  });
  if (headerIdx === -1) return map;
  const header = rows[headerIdx];
  const idCol = header.findIndex(c => /\bid\b/i.test(c));
  const urlCol = header.findIndex((c, j) => j !== idCol && /link|url/i.test(c));
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const id = (rows[i][idCol] || "").trim();
    const url = (rows[i][urlCol] || "").trim();
    if (id && /^https?:\/\//i.test(url)) map[id] = normalizeImageUrl(url);
  }
  return map;
}

/* Question IDs arrive as "40", "40.0", or 40 — normalize so a category tab's
   Question ID matches the bank's ID column. */
function normId(s) {
  const t = String(s ?? "").trim();
  if (!t) return "";
  const n = parseFloat(t.replace(/,/g, ""));
  return isNaN(n) ? t.toLowerCase() : String(n);
}
function isAffirmative(v) { return /^\s*(y|yes|true|x|1|✓|replace|hide)\b/i.test(String(v ?? "")); }

/* The 🗂 Question Bank's optional "Answer replaces question?" column -> the set
   of Question IDs whose answer should REPLACE the clue text on the TV when it's
   revealed (a photo, if any, always stays). Absent column or blank cell = a
   normal clue (question stays on screen next to the answer). */
function parseQuestionBankFlags(ws) {
  const rows = sheetRows(ws);
  const flags = {};
  const headerIdx = rows.findIndex(r => r.some(c => /^\s*id\s*$/i.test(c)) && r.some(c => /replace/i.test(c)));
  if (headerIdx === -1) return flags;                 // no such column -> nobody replaces
  const header = rows[headerIdx];
  const idCol = header.findIndex(c => /^\s*id\s*$/i.test(c));
  const flagCol = header.findIndex(c => /replace/i.test(c));
  if (idCol === -1 || flagCol === -1) return flags;
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const id = normId(rows[i][idCol]);
    if (id && isAffirmative(rows[i][flagCol])) flags[id] = true;
  }
  return flags;
}

/* An image cell may hold a bank ID or a pasted URL. */
function resolveImage(cellValue, imageMap) {
  const v = String(cellValue || "").trim();
  if (!v) return "";
  if (/^https?:\/\//i.test(v)) return normalizeImageUrl(v);
  return imageMap[v] || "";
}

/* An image cell may hold ONE image, or TWO separated by a comma ("3, 7", or a
   URL then another). Each part is a bank ID or a pasted URL. Returns the list of
   resolved URLs (empty, one, or more). */
function resolveImages(cellValue, imageMap) {
  const v = String(cellValue || "").trim();
  if (!v) return [];
  return v.split(",").map(p => resolveImage(p.trim(), imageMap)).filter(Boolean);
}

/* An image cell can optionally use different pictures on the answer: write the
   question image ID(s), then "THEN" (caps), then the answer image ID(s) — e.g.
   "6, 5THEN7" = 6 & 5 on the question, 7 on the answer. Each side takes one or
   two images (or none). No "THEN" -> the same picture(s) show on both.
   Returns { question:[urls], answer:[urls]|null }  (answer null = same as question). */
function parseImagePair(cellValue, imageMap) {
  const v = String(cellValue || "").trim();
  const i = v.indexOf("THEN");
  if (i === -1) return { question: resolveImages(v, imageMap), answer: null };
  return { question: resolveImages(v.slice(0, i), imageMap), answer: resolveImages(v.slice(i + 4), imageMap) };
}
/* Count of image IDs/URLs a raw cell mentions (for "one of them didn't resolve" warnings). */
function countImageRefs(raw) {
  return String(raw || "").split(/THEN|,/).map(s => s.trim()).filter(Boolean).length;
}

/* Formula error text from the category tabs ("⚠ ID not found") — never
   show it as a question or answer. */
function isNotFound(s) { return /id\s*not\s*found/i.test(s); }

function sheetRows(ws) {
  return XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", raw: false })
    .map(r => r.map(c => String(c ?? "").trim()));
}

function parseMoney(s) {
  const n = parseInt(String(s).replace(/[$,\s]/g, ""), 10);
  return isNaN(n) ? 0 : n;
}

/* One category tab -> { name, clues, warnings } or null if it holds no questions. */
function parseCategoryTab(tabName, ws, imageMap, bankFlags) {
  const rows = sheetRows(ws);
  // header row = a QUESTION column and an ANSWER column in two DIFFERENT
  // cells. "Question ID" is the reference column, not the question itself,
  // so a header counts as the question column only when it isn't ".. ID ..".
  const isQuestionHeader = c => /question/i.test(c) && !/question\s*id/i.test(c);
  const headerIdx = rows.findIndex(r => {
    const qi = r.findIndex(isQuestionHeader);
    return qi !== -1 && r.some((c, j) => j !== qi && /answer/i.test(c));
  });
  if (headerIdx === -1) return null;
  const header = rows[headerIdx];
  const qCol = header.findIndex(isQuestionHeader);
  const aCol = header.findIndex(c => /answer/i.test(c));
  const imgCol = header.findIndex(c => /image/i.test(c));
  const qidCol = header.findIndex(c => /question\s*id/i.test(c));   // reference back to the bank
  let vCol = header.findIndex(c => /value/i.test(c));
  if (vCol === -1) vCol = 0;

  const clues = [];
  const warnings = [];
  let ddValue = null;
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    const clue = (r[qCol] || "").trim();
    // Daily Double marker row: a label-only row (no question text!) with a
    // dollar amount after the label. A real clue that merely MENTIONS
    // "daily double" must not be swallowed.
    const ddCell = r.findIndex(c => /daily\s*double/i.test(c));
    if (ddCell !== -1 && !clue) {
      for (let j = ddCell + 1; j < r.length; j++) {
        const n = parseMoney(r[j]);
        if (n > 0) { ddValue = n; break; }
      }
      continue;
    }
    if (!clue) continue;                       // blank question -> no tile
    const rowLabel = `"${tabName.trim()}" ${r[vCol] || ""}`;
    if (isNotFound(clue)) {                    // formula couldn't find the bank ID
      warnings.push(`${rowLabel}: that Question ID isn't in the 🗂 Question Bank — tile skipped.`);
      continue;
    }
    const rawAnswer = (r[aCol] || "").trim();
    let answer = rawAnswer;
    if (isNotFound(rawAnswer)) {
      warnings.push(`${rowLabel}: the answer couldn't be looked up in the 🗂 Question Bank — you'll type the answer live.`);
      answer = "";
    } else if (!rawAnswer) {
      warnings.push(`${rowLabel}: no answer in the sheet — you'll type the answer live during the game.`);
    }
    // UNKNOWN (incl. variants like "Unknown?") or a missing answer both mean:
    // the host types the answer live during the game.
    const unknown = !answer || /^unknown\b/i.test(answer);
    const imgRaw = imgCol !== -1 ? (r[imgCol] || "").trim() : "";
    const pair = parseImagePair(imgRaw, imageMap);    // { question, answer|null } — one or two each, "THEN" splits
    const rawCount = countImageRefs(imgRaw);
    const gotCount = pair.question.length + (pair.answer ? pair.answer.length : 0);
    if (rawCount && !gotCount) {
      warnings.push(`${rowLabel}: Image ID "${imgRaw}" isn't in the 🖼 Image Bank — the picture won't show.`);
    } else if (gotCount < rawCount) {
      warnings.push(`${rowLabel}: one of the images ("${imgRaw}") isn't in the 🖼 Image Bank — only the others will show.`);
    }
    // "Answer replaces question?" is set in the bank and matched here by Question ID.
    const qid = qidCol !== -1 ? normId(r[qidCol]) : "";
    clues.push({
      value: parseMoney(r[vCol]),
      clue,
      answer: unknown ? "" : answer,
      unknown,
      image: pair.question,      // question picture(s): array of 0/1/2 URLs
      answerImage: pair.answer,  // answer picture(s), or null = same as the question
      dd: false,
      replace: !!(qid && bankFlags && bankFlags[qid]),
    });
  }
  if (!clues.length) return null;              // empty tab -> no category
  clues.forEach((cl, idx) => { if (!cl.value) cl.value = (idx + 1) * 200; });
  clues.sort((a, b) => a.value - b.value);
  if (ddValue != null) {
    const hit = clues.find(cl => cl.value === ddValue);
    if (hit) hit.dd = true;
  }
  return { name: tabName.trim(), clues, warnings };
}

/* Read one cell (e.g. "C5") straight from the worksheet, since sheet_to_json
   is range-relative and a positional rows[][] lookup can't reliably hit a
   fixed cell when the used range doesn't start at A1. */
function cellText(ws, addr) {
  const c = ws[addr];
  const v = c ? (c.w != null ? c.w : c.v) : null;
  return v != null ? String(v).trim() : "";
}

/* The Game Setup tab -> { title, subtitle, categoryNames, teams, final }. */
function parseSetupTab(ws) {
  const rows = sheetRows(ws);
  const out = { title: "", subtitle: "", categoryNames: [], teams: [], final: null };

  const findValue = (re) => {
    for (const r of rows) {
      const idx = r.findIndex(c => re.test(c));
      if (idx !== -1) {
        for (let j = idx + 1; j < r.length; j++) if (r[j]) return r[j];
      }
    }
    return "";
  };

  out.title = findValue(/game\s*(title|name)/i);
  // The small "precursor" line above the big title lives in cell C5 of the
  // Game Setup tab. Read that cell DIRECTLY from the worksheet — sheet_to_json
  // (used by sheetRows) indexes relative to the used range's top-left, so a
  // positional rows[][] lookup would miss C5 when the range doesn't start at A1.
  out.subtitle = cellText(ws, "C5");
  // Fall back to a labelled cell if a writer adds one; never duplicate the title.
  if (!out.subtitle) out.subtitle = findValue(/subtitle|pre[- ]?title|tagline/i);
  if (out.subtitle && out.subtitle === out.title) out.subtitle = "";

  // Category display names live in row 4, columns E..J (up to 6), mapped
  // left-to-right onto the categories on the board. This lets a category be
  // named from a cell (where apostrophes etc. survive) instead of the tab name.
  out.categoryNames = ["E4", "F4", "G4", "H4", "I4", "J4"].map(a => cellText(ws, a));

  const teamHeaderIdx = rows.findIndex(r => r.some(c => /team\s*name/i.test(c)));
  if (teamHeaderIdx !== -1) {
    const header = rows[teamHeaderIdx];
    const nameCol = header.findIndex(c => /team\s*name/i.test(c));
    const playerCol = header.findIndex(c => /player/i.test(c));
    for (let i = teamHeaderIdx + 1; i < rows.length; i++) {
      const r = rows[i];
      if (r.some(c => /final\s*jeopardy/i.test(c))) break;   // reached the Final section
      const name = (r[nameCol] || "").trim();
      if (!name) continue;
      const players = playerCol !== -1
        ? (r[playerCol] || "").split(/[,;]/).map(p => p.trim()).filter(Boolean)
        : [];
      out.teams.push({ name, players });
    }
  }

  const fCat = findValue(/final\s*jeopardy\s*category/i);
  let fClue = findValue(/final\s*jeopardy\s*(question|clue)/i);
  const fAns = findValue(/final\s*jeopardy\s*answer/i);
  // Final Jeopardy instructions (shown on the intro screen) live in a dedicated
  // cell — Game Setup D18. Read it directly by address, like C5/E4, since
  // sheet_to_json indexes relative to the used range and can't hit a fixed cell.
  const fInstr = cellText(ws, "D18");
  // Guard: the "Final Jeopardy question" label sits in B18, so if the writer
  // left the question cell (C18) blank, findValue would walk right and wrongly
  // grab the instructions from D18. Only discard it in THAT case (C18 blank) —
  // a filled C18 is always the clue, even if it happens to equal the instructions.
  if (fClue && fInstr && fClue === fInstr && !cellText(ws, "C18")) fClue = "";
  if (fClue) {
    // No/UNKNOWN answer -> the host types the final answer live.
    const unknown = !fAns || /^unknown\b/i.test(fAns);
    out.final = { category: fCat || "Final Jeopardy", clue: fClue, answer: unknown ? "" : fAns, unknown, instructions: fInstr };
  }
  return out;
}

function buildGameFromWorkbook(wb) {
  // Banks + Game Setup first: categories need the image map to resolve Image
  // IDs, and the Game Setup tab supplies the category display names (E4..J4).
  let imageMap = {};
  let bankFlags = {};
  let setup = null;
  for (const name of wb.SheetNames) {
    if (isImageBankTabName(name)) imageMap = parseImageBank(wb.Sheets[name]);
    else if (isQuestionBankTabName(name)) bankFlags = parseQuestionBankFlags(wb.Sheets[name]);
    else if (isSetupTabName(name) && !setup) setup = parseSetupTab(wb.Sheets[name]);
  }
  const categoryNames = (setup && setup.categoryNames) || [];

  const categories = [];
  const warnings = [];
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    if (isMetaTabName(name) || isQuestionBankTabName(name) || isImageBankTabName(name) || isSetupTabName(name)) continue;
    const cat = parseCategoryTab(name, ws, imageMap, bankFlags);
    if (cat) {
      // Game Setup's E4..J4 names (left to right on the board) override the tab
      // name; an empty cell leaves the tab name in place.
      const overrideName = (categoryNames[categories.length] || "").trim();
      if (overrideName) cat.name = overrideName;
      warnings.push(...(cat.warnings || []));
      delete cat.warnings;
      categories.push(cat);
    }
  }

  if (categories.length) {
    return {
      title: (setup && setup.title) || "Jeopardy!",
      subtitle: (setup && setup.subtitle) || "",
      rounds: [{ name: "Jeopardy!", categories }],
      final: (setup && setup.final) || null,
      teams: (setup && setup.teams) || [],
      warnings,
    };
  }

  // No category tabs found — try the legacy row-list format on each tab.
  for (const name of wb.SheetNames) {
    const rows = sheetRows(wb.Sheets[name]);
    if (!rows.length) continue;
    const h = rows[0].map(c => c.toLowerCase());
    if (h.some(c => c.startsWith("category")) && h.some(c => c.startsWith("clue") || c.startsWith("question")) && h.some(c => c.startsWith("answer"))) {
      const game = buildGameFromRows(rows);
      game.teams = [];
      return game;
    }
  }
  throw new Error("Couldn't find any questions in that sheet. Each category tab needs its Question column filled in (and the workbook needs at least one category tab with a question). If this isn't a copy of the “Jeopardy Questions” workbook, check that it matches the expected layout.");
}

/* ---------------- legacy row-list format ---------------- */
function buildGameFromRows(rows) {
  if (!rows.length) throw new Error("The sheet appears to be empty.");
  const headers = rows[0].map(h => h.trim().toLowerCase());
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

  const roundsMap = new Map();
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
    if (roundRaw === "f" || roundRaw.startsWith("final")) {
      const fu = !ans || /^unknown\b/i.test(ans);
      if (!final) final = { category: cat || "Final Jeopardy", clue, answer: fu ? "" : ans, unknown: fu };
      continue;
    }
    const rKey = roundRaw;
    if (!roundsMap.has(rKey)) roundsMap.set(rKey, new Map());
    const cats = roundsMap.get(rKey);
    if (!cats.has(cat)) cats.set(cat, []);
    const valRaw = cVal >= 0 ? String(r[cVal] ?? "").replace(/[$,\s]/g, "") : "";
    const dd = cDD >= 0 ? /^(y|yes|true|x|1)$/i.test(String(r[cDD] ?? "").trim()) : false;
    const unknown = !ans || /^unknown\b/i.test(ans);
    cats.get(cat).push({ value: valRaw ? parseInt(valRaw, 10) || 0 : 0, clue, answer: unknown ? "" : ans, unknown, dd });
  }

  const roundKeys = [...roundsMap.keys()].sort((a, b) => (parseInt(a) || 99) - (parseInt(b) || 99));
  if (!roundKeys.length && !final) throw new Error("No question rows found under the header row.");
  const rounds = roundKeys.map((key, ri) => {
    const cats = roundsMap.get(key);
    const categories = [...cats.entries()].map(([name, clues]) => {
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
  return { title: "Custom Game", subtitle: "", rounds, final, teams: [] };
}

/* ---------------- fetching ---------------- */

function parseSheetRef(input) {
  const s = input.trim();
  const idMatch = s.match(/\/d\/([a-zA-Z0-9-_]{20,})/) || s.match(/^([a-zA-Z0-9-_]{25,})$/);
  if (!idMatch) return null;
  const gidMatch = s.match(/[#?&]gid=(\d+)/);
  return { id: idMatch[1], gid: gidMatch ? gidMatch[1] : null };
}

async function fetchWithTimeout(url, timeoutMs, asBinary) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { signal: ctrl.signal });
    if (!resp.ok) return null;
    if (asBinary) return await resp.arrayBuffer();
    const text = await resp.text();
    if (/^\s*</.test(text)) return null;       // HTML login page, not data
    return text;
  } catch (e) {
    return null;
  } finally {
    clearTimeout(t);
  }
}

const SHARING_ERROR = "Couldn't load the sheet. This usually means it isn't shared as “Anyone with the link – Viewer” — ask the question-writer to double-check Share settings. (If sharing is right, check the internet connection and the link itself.)";

async function loadSheet(input) {
  const ref = parseSheetRef(input);
  if (!ref) throw new Error("That doesn't look like a Google Sheets link. Paste the full link from the browser address bar (it contains /spreadsheets/d/...).");

  // Primary: the whole workbook (every tab + tab names) in one request.
  const buf = await fetchWithTimeout(`https://docs.google.com/spreadsheets/d/${ref.id}/export?format=xlsx`, 30000, true);
  // A real xlsx is a zip and starts with "PK"; a private sheet serves an HTML
  // login page instead — treat that as a sharing problem, not a parse error.
  const looksLikeXlsx = buf && buf.byteLength > 4 &&
    new Uint8Array(buf, 0, 2)[0] === 0x50 && new Uint8Array(buf, 0, 2)[1] === 0x4B;
  if (looksLikeXlsx) {
    let wb;
    try { wb = XLSX.read(buf, { type: "array" }); }
    catch (e) { throw new Error("Downloaded the sheet but couldn't read it as a spreadsheet — is the link really a Google Sheet?"); }
    return buildGameFromWorkbook(wb);
  }

  // Fallback: single-tab CSV endpoints (legacy sheets / odd permissions).
  const gid = ref.gid ? `&gid=${ref.gid}` : "";
  const text = (await fetchWithTimeout(`https://docs.google.com/spreadsheets/d/${ref.id}/export?format=csv${gid}`, 20000, false))
            ?? (await fetchWithTimeout(`https://docs.google.com/spreadsheets/d/${ref.id}/gviz/tq?tqx=out:csv${gid}`, 20000, false));
  if (text == null) throw new Error(SHARING_ERROR);
  return buildGameFromRows(parseCSV(text));
}
