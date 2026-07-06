# 🎯 Jeopardy — dual-screen party game

A free, self-hosted Jeopardy game built for game nights: the **control panel** runs on the
host's laptop screen while the **game board** shows full-screen on a TV or projector
(extended desktop). Questions load live from a Google Sheet, and **answers never appear on
the control panel until revealed** — so the host can play too.

**Play it:** https://dzimmermann274.github.io/jeopardy/

## Game night — host steps

1. Open the game link on the laptop (this is the control panel).
2. Paste the Google Sheets link from your question-writer → **Load from Google Sheets**
   (or use the built-in sample game).
3. Name the teams.
4. Click **Open display window** → drag that window onto the TV → click **⛶ Fullscreen**
   (or press **F** in that window).
5. Click **Start the game ▶** and run everything from the laptop: click tiles, reveal
   answers, award points. Answers appear on the TV for everyone — including you — at the
   same moment.

If the browser reloads mid-game, reopen the link: the setup screen offers **Resume that
game** with scores and board progress intact.

## For the question-writer

1. Go to `sheets.new` and put these headers in row 1:

   | Round | Category | Value | Clue | Answer | Daily Double |
   |-------|----------|-------|------|--------|--------------|
   | 1 | U.S. History | 200 | This document begins "We the People". | The Constitution | |
   | 1 | U.S. History | 400 | … | … | yes |
   | Final | Geography | | … | … | |

2. One row per question. Details:
   - **Round**: `1`, `2`, or `Final`. Blank repeats the row above.
   - **Category**: blank repeats the row above (normal spreadsheet "ditto" style is fine).
   - **Value**: optional — blanks auto-fill 200/400/…, doubled in round 2.
   - **Daily Double**: put `yes` on one or two rows.
   - Aim for 6 categories × 5 clues per round; the board adapts to whatever is there.
3. **Share → Anyone with the link → Viewer**, copy the link, send it to the host.
   The host pastes the link without ever opening the sheet.

A starter template is in [`question-template.csv`](question-template.csv) — import it into
a blank Google Sheet via **File → Import** if you'd rather start from a file.

## How it works (for future changes)

Plain HTML/CSS/JS, no build step, no backend. Deployed as-is on GitHub Pages.

| File | Responsibility |
|------|----------------|
| `index.html` | Shell; loads everything. Same page is both apps: plain = control panel, `#display` = TV view. |
| `styles.css` | All styles. Control-panel styles under `body.control`, TV styles under `body.display`. |
| `js/core.js` | Shared state object `S`, BroadcastChannel sync, localStorage save/resume, helpers. |
| `js/data.js` | Google Sheets fetch (export-CSV endpoint with gviz fallback), CSV parser, sheet → game builder. |
| `js/control.js` | The entire control-panel UI and game-flow handlers. |
| `js/display.js` | The entire TV rendering (board, clue, Daily Double, Final, scores, timer). |
| `js/sample-game.js` | The built-in demo game. |
| `js/main.js` | Boot: decides which mode this window is. |

Design rules to preserve when adding features:

- **Single source of truth:** the control window owns `S` and broadcasts full snapshots
  after every change (`update()` in `core.js`). The display is a pure renderer — it never
  mutates game state. New features should follow the same pattern: mutate inside
  `update(() => {...})`, render from `S`.
- **Host-blind guarantee:** nothing in `control.js` may render an answer unless
  `S.revealed` / `S.finalRevealed` is already true.
- **Re-render safety:** the panel re-renders `innerHTML` on every update, so any
  in-progress form input must live in a module-level draft variable (see `sheetUrlDraft`,
  `ddDraft`, `finalWagerDrafts` in `control.js`).

Run locally: any static server in this folder, e.g. `python3 -m http.server 8123`, then
open `http://localhost:8123/`. (Opening `index.html` directly as a file breaks the
Google-Sheets fetch and the window sync — always use a server or the live site.)

Idea backlog: buzzer support (phones via WebRTC/WebSocket would need a backend, or
keyboard keys locally), sounds, board-fill animation, images in clues, themes,
per-question stats.
