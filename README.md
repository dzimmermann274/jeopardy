# 🎯 Jeopardy — dual-screen party game

A free, self-hosted Jeopardy game built for game nights: the **control panel** runs on the
host's laptop screen while the **game board** shows full-screen on a TV or projector
(extended desktop). Questions load live from a Google Sheets workbook, and **answers never
appear on the control panel until revealed** — so the host can play too.

**Play it:** https://dzimmermann274.github.io/jeopardy/

## The question workbook (primary format)

The game **mirrors a copy of the "Jeopardy Questions" workbook** (template in
[`template/Jeopardy Questions.xlsx`](template/) — regenerate with
`python3 tools/make_template.py`):

- **📖 READ ME FIRST** tab — instructions for the question-writer.
- **⚙️ Game Setup** tab — game title (shown on the TV), team names, players per team
  (shown on the TV scoreboard), and an optional Final Jeopardy.
- **🗂 Question Bank** tab — the master list: every question gets an ID number. An answer
  of **UNKNOWN** means no preset answer — the host types it live in the control panel and
  releases it to the TV (every question also has a subtle "type a different answer"
  override).
- **🖼 Image Bank** tab — picture links, each with an Image ID. Putting an Image ID next
  to a question shows the picture on the TV under the clue. Google Drive share links are
  converted automatically to direct-view URLs.
- **Six category tabs** — each tab is ONE category; **the tab's name is the category
  title** (writers rename the tab). Writers type just a Question ID next to each dollar
  amount and the question/answer auto-fill via VLOOKUP (typing directly also works), plus
  an optional Daily Double dollar amount.

Mirroring rules: a **blank question ⇒ no tile** on the board; an **untouched tab ⇒ no
category**; 4 filled tabs ⇒ a 4-category board; 6 ⇒ 6. The board's dollar rows come from
whatever values actually exist in the sheet (duplicate values get their own rows).
Unresolvable Question IDs are skipped with a warning shown on the setup screen.

Multi-line clues/answers: since a Google Sheets cell can't hold a real newline, type
**`##`** anywhere in a clue or answer and the game turns it into a line break on the TV
(e.g. `Abraham Lincoln##(1809–1865)`). Two hashes, chosen so ordinary answers like `C#`
or `#1` aren't affected.

The writer finishes with **Share → Anyone with the link → Viewer** and sends the link to
the host, who pastes it into the game without ever opening the sheet.

A legacy single-tab format (header row `Round | Category | Value | Clue | Answer | Daily
Double`) is still auto-detected and supported.

## Game night — host steps

1. Open the game link on the laptop (this is the control panel).
2. Paste the workbook link from your question-writer → **Load from Google Sheets**
   (or use the built-in sample game). Title, teams, and players fill in automatically.
3. Put the game on the TV. **Easiest (Chrome/Edge):** click **Display setup** and pick an option
   — deploy straight onto the external display, or the safe **black-screen-first** flow (put up a
   black screen, make it borderless with **F** while only black shows, then **Show the game**).
   The first time, Chrome asks permission to "manage windows on all your displays" — approve it.
   **Or the manual way:** **Open display window** → drag it onto the TV → click **⛶ Fullscreen**
   (or press **F** in that window). External-display options only appear when a second screen is
   connected as an *extended* (not mirrored) display.
4. Click **Start the game ▶** and run everything from the laptop. Answers appear on the TV
   for everyone — including you — at the same moment.

**Display setup** (button in the header, any time) also has **fade to the title screen**,
**fade to black**, and **show the game** as failsafes if anything looks wrong on the TV mid-game.

Use **🏆 Announce winner** (top of the control panel) at any point to show a final
results screen on the TV with the champion highlighted (ties handled); it asks "are you
sure" first. **◀ Back to game** returns to play.

If the browser reloads mid-game, reopen the link: the setup screen offers **Resume that
game** with scores and board progress intact.

Note: the control panel uses in-page dialogs (not the browser's popup boxes) so the TV
never gets kicked out of fullscreen. Bump the `?v=` number on the script tags in
`index.html` on each deploy so browsers pick up new code immediately.

## How it works (for future changes)

Plain HTML/CSS/JS, no build step, no backend. Deployed as-is on GitHub Pages.

| File | Responsibility |
|------|----------------|
| `index.html` | Shell; loads everything. Same page is both apps: plain = control panel, `#display` = TV view. |
| `styles.css` | All styles. Control-panel styles under `body.control`, TV styles under `body.display`. |
| `js/core.js` | Shared state object `S`, BroadcastChannel sync, localStorage save/resume, helpers. |
| `js/data.js` | Google Sheets fetch (whole-workbook xlsx export; CSV fallbacks), workbook parser (tab-per-category), legacy row-list parser. |
| `js/control.js` | The entire control-panel UI and game-flow handlers, plus the **Display setup** dialog (multi-screen deploy via the Window Management API + the fade failsafes). |
| `js/display.js` | The entire TV rendering (board, clue, Daily Double, Final, scores, timer) and the fade **curtain** overlay driven by `S.stage` (`game`/`black`/`title`). |
| `js/sample-game.js` | The built-in demo game. |
| `js/main.js` | Boot: decides which mode this window is. |
| `js/vendor/xlsx.full.min.js` | SheetJS (reads the workbook in the browser). |
| `tools/make_template.py` | Generates `template/Jeopardy Questions.xlsx` (openpyxl). The parser and this template are a matched pair — change them together. |

Design rules to preserve when adding features:

- **Single source of truth:** the control window owns `S` and broadcasts full snapshots
  after every change (`update()` in `core.js`). The display is a pure renderer — it never
  mutates game state. New features should follow the same pattern: mutate inside
  `update(() => {...})`, render from `S`.
- **Host-blind guarantee:** nothing in `control.js` may render an answer unless
  `S.revealed` / `S.finalRevealed` is already true.
- **The game mirrors the sheet**, never the other way around: the sheet's tabs, filled
  rows, teams, and title decide what exists in the game.
- **Re-render safety:** the panel re-renders `innerHTML` on every update, so any
  in-progress form input must live in a module-level draft variable (see `sheetUrlDraft`,
  `ddDraft`, `finalWagerDrafts` in `control.js`).

Run locally: any static server in this folder, e.g. `python3 -m http.server 8123`, then
open `http://localhost:8123/`. (Opening `index.html` directly as a file breaks the
Google-Sheets fetch and the window sync — always use a server or the live site.)
`test-data/filled-test.xlsx` is a filled example workbook for testing the parser.

Idea backlog: buzzer support, sounds, board-fill animation, themes, round-2 support in
the workbook format, per-question stats.
