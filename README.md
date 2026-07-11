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
- **⚙️ Game Setup** tab — game title (shown on the TV), the house **rules**, the teams and
  their players, and an optional Final Jeopardy (category, question, and answer). The
  optional **Final Jeopardy instructions** shown on the intro screen are read from **cell
  D18** of this tab (leave it blank to just show the title).
  - The **rules** live in **cell D7** and appear on the **Rules screen** (see *Game night*
    below). Separate each rule with **`##`** and they come out as a numbered list; leave D7
    blank and the screen says so.
  - The **turn bonus** ("bump") lives in **cell F7** — extra points the team whose *turn it
    is to pick* earns for a **correct** answer on their turn (a reward for going first each
    round). Put a dollar amount there (e.g. `200`), or leave it blank / `0` for no bonus.
    It's built into the **✓ Right** button when you score a clue, and you can change it live
    on the control panel (under **Scores → Turn bonus**).
  - The team column holds a **number, 1–6** — an *ID* for the group, not a name. It is
    never shown on the TV. Teams choose their real names during the game and the host types
    them into the control panel. (A sheet that already has real names there still works:
    they're used as-is.) The **players** column is what identifies each group on the TV, so
    fill it in.
- **🗂 Question Bank** tab — the master list: every question gets an ID number. An answer
  of **UNKNOWN** means no preset answer — the host types it live in the control panel and
  releases it to the TV (every question also has a subtle "type a different answer"
  override). The optional **"Answer replaces question?"** column: type **YES** to make that
  answer fill the whole screen on reveal (the question disappears — a photo, if any, always
  stays); blank = normal (question and answer show together). The game matches this flag to
  each clue by its Question ID, so it needs no change to the category tabs.
- **🖼 Image Bank** tab — picture links, each with an Image ID. Putting an Image ID next
  to a question shows the picture on the TV under the clue. **Two Image IDs separated by a
  comma (e.g. `3, 7`) show two pictures side by side** on the same slide (a pasted URL or a
  mix works too). To show **different pictures once the answer is revealed**, write the
  question image(s), then **`THEN`** (caps), then the answer image(s) — e.g. `6, 5THEN7`
  puts 6 & 5 on the question and 7 on the answer (each side can be one, two, or none).
  Google Drive share links are converted automatically to direct-view URLs.
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
   (or use the built-in sample game). Title, rules, teams, and players fill in automatically.
3. Put the game on the TV. **Easiest (Chrome/Edge):** click **Display setup** and pick an option
   — deploy straight onto the external display, or the safe **black-screen-first** flow (put up a
   black screen, make it borderless with **F** while only black shows, then **Show the game**).
   The first time, Chrome asks permission to "manage windows on all your displays" — approve it.
   **Or the manual way:** **Open display window** → drag it onto the TV → click **⛶ Fullscreen**
   (or press **F** in that window). External-display options only appear when a second screen is
   connected as an *extended* (not mirrored) display.
4. Walk the room through the openers with the **TV screens** bar on the control panel
   (see *Opening the show* below): **Title** → **Rules** → **Show teams** → **Show who
   picks first**.
5. Click **Start the game ▶** and run everything from the laptop. Answers appear on the TV
   for everyone — including you — at the same moment.

## Opening the show

The **TV screens** bar (on both the setup and the play screen) puts any of six screens on
the TV, and highlights whichever one is up:

- **Title** — the title card.
- **Rules** — the numbered rules from cell D7 of the sheet.
- **Show teams** — each group with its players and a **blank line where its name will go**,
  under the heading *“Find your team and choose a team name!”*. As you type each name into
  the **Teams** boxes on the control panel it appears on the TV straight away. The sheet's
  team numbers are never shown — players find themselves by their own name.
- **Show who picks first** — shuffles the teams into a **picking order**, shows who leads,
  and lists the rotation. The order is drawn **once**: pressing the button again just shows
  the same order (use **Reshuffle**, next to the scores, to redraw it).
- **Black** and **Show the game** — the two failsafes, also in **Display setup**.

Once the order exists, the **pick passes to the next team every time a clue is put away**.
The picking team's pod on the TV scoreboard glows a subtle green, and the control panel says
*Picking now: …* with **◀ / ▶** buttons to correct the turn if you mis-click.

## 📞 Phone grandma

Each team's card in **Scores** has a **📞 Phone grandma** button. Click it and *“(team) has
phoned grandma!”* flashes briefly on the TV and stays up longer, with the team's players, on
the Host View. **Every team gets one call per game** — the button greys out afterwards, and
pressing it again asks you to confirm before showing the banner a second time.

**Display setup** (button in the header, any time) also has **fade to the title screen**,
**fade to black**, and **show the game** as failsafes if anything looks wrong on the TV mid-game.

**True fullscreen:** a fullscreen deploy fills the screen, and the display window enters real
fullscreen mode on the **first click or key press** in it — browsers won't let a normal site take
over the screen with no gesture. With the black-first flow that click is invisible: only black is
showing while it happens.

**Skipping that click (zero-touch).** The one exception to the gesture rule is Chrome/Edge 127+
allow-listing an address for *automatic fullscreen*, via the `AutomaticFullscreenAllowedForUrls`
policy. **Double-click `Automatic full screen (Mac).command` once**, then quit the browser
completely (⌘Q — closing the window is not enough) and reopen it. The Display setup dialog shows
whether it's on and, if not, the exact one-line command to run. (On Windows the same policy lives in
the registry under `HKLM\SOFTWARE\Policies\Google\Chrome\AutomaticFullscreenAllowedForUrls` and
needs an administrator; without it, the one click is the floor there.) Verify either at
`chrome://policy`. Safari and Firefox have no equivalent — they always need the click.

The allow-list is **per address**, so each copy of the game needs its own entry: the one you
publish on the web (`https://…github.io`) and the one `server.py` serves over Wi-Fi
(`http://localhost:8123`) are two different addresses. That's why a deploy can be zero-click on one
and still ask for a tap on the other. The `.command` file adds the local addresses without
disturbing any you've already allowed.

When the game is served by `server.py`, open the control panel on the host computer at
**`http://localhost:8123`**, not at the `http://192.168.…` address. Browsers treat a bare Wi-Fi
address as untrusted and switch off *both* automatic fullscreen and automatic external-display
placement — and the number can change when the router restarts, which would silently invalidate the
allow-list. Other devices still use the Wi-Fi addresses. (Double-clicking **Start Jeopardy** opens
the right address for you.)

Once the display is genuinely fullscreen it stays that way: re-deploying doesn't reload it out of
fullscreen, and if the browser drops fullscreen because focus moved elsewhere (opening the Host
View does this), the display puts itself back — silently on an allow-listed machine, otherwise with
the one-click prompt. Pressing **Esc** or **F** in the display window still exits for good.

Use **Show categories** (top of the control panel) at the start to play a full-screen
animation that reveals each of the day's categories to the players. After it plays once the
button greys out but still works (it asks to confirm before replaying); it resets every time
the control panel is reloaded or a new game starts.

Use **🏆 Announce winner** (top of the control panel) at any point to show a final
results screen on the TV with the champion highlighted (ties handled); it asks "are you
sure" first. **◀ Back to game** returns to play. **Show scores on TV** puts up the
current standings with no winner regalia — both of those buttons are independent of the
Final Jeopardy sequence below.

**Final Jeopardy** (the gold button in the toolbar, shown once a game with a Final is
loaded) asks "are you sure", then runs a host-paced, TV-driven sequence — you push it
forward one step at a time from the control panel:

1. **Instructions** — a *FINAL JEOPARDY!* card flies in from a point to full screen, holds,
   then flies off to reveal the rules from the sheet (Game Setup **D18**).
2. **Category** — a huge *FINAL JEOPARDY — CATEGORY* holds for ~3s, then shrinks and rises
   as the actual category effects in; enter each team's secret wager on the control panel.
3. **Clue** — the question appears and behaves exactly like a normal clue: a **30-second
   timer** (with or without the think music), then **Reveal answer**, then score each
   team's wager Right/Wrong.
4. **Reveal the winner** — the post-results button. The TV first shows a *Tallying scores…*
   loader; then, one click per place, the standings are unveiled **last place → first**.
   Each team pops up **large in the center** and holds a couple of seconds (so everyone can
   read the numbers) before dropping into its slot. Every card shows two big labelled
   numbers — the team's **Score** and its green/red **Final Jeopardy result** — and when the
   last place is revealed the champion grows, the rest recede, and a fanfare plays.
   **Done — back to the game** returns to the board.

The existing **Announce winner** and **Show scores on TV** buttons are unchanged and stay
independent of this sequence.

**Host view** — a separate screen for whoever reads the questions and judges answers. Open
it on the host's Mac or iPad (the **🧑‍🏫 Host view** card on the control panel has an
**Open host view** button, or bookmark the game's address with `host.html` on the end). It
has two tabs:

**Live view** mirrors the game as it happens — it never touches the game, showing:

- the **current question** in big, plain text, easy to read at a glance;
- the **answer — even before it's revealed on the TV** — so the host can tell whether a
  team is right and judge on the spot (for an UNKNOWN clue it shows once Danny types it);
  the answer is gold while it's still host-only and turns green once it's revealed on the TV;
- the **30-second timer** in a corner, as plain numerals, appearing only while it runs;
- a **synced category teleprompter** while the control panel is running **Show categories** on
  the TV: it takes over the whole host screen (pulling the host out of Question preview) with a
  bold *GET READY TO READ CATEGORIES* while the TV holds its title card, then — a beat before
  the first category lands on the TV — the full list of the day's categories, with a big green
  rectangle that slides down one at a time **in sync with the TV**, so the host always knows
  which category to read; it clears itself as the TV fades to the board;
- a full-screen **"Ready for Final Jeopardy"** cue while the control panel is confirming the
  start, then a deliberately plain Category / Question / Answer screen for the Final;
- during the **winner reveal**, a heads-up of **which team is announced next and their
  score** (matching the control panel's last-place-to-first order);
- **notes from Danny** — from the same card, the control-panel operator can push a note
  that pops onto the host screen. It sits out of the way of a question/answer and fills the
  screen when nothing else is showing.

**Question preview** is a bare-bones browser: tap any clue on the board to see its question,
picture, and answer on one plain, highly readable screen, alongside the teams and their
scores. It's for the host's reference only and never changes the game.

The one thing the host CAN change is **Final Jeopardy wagers** — the Live view shows wager
boxes during the wager step, editable "alongside" the control panel (either end can enter
them; they stay in sync). This is the sole write the Host view is allowed: it sends a
`set-final-wager` message that the control panel (which owns the state) applies. Otherwise
the Host view is a passive listener on the same window-sync channel, so any number can be
open and none of them can affect the TV or the control panel.

If the browser reloads mid-game, reopen the link: the setup screen offers **Resume that
game** with scores and board progress intact.

## Play across separate devices (optional)

By default the windows sync through the browser's **BroadcastChannel**, which only connects
tabs/windows of the **same browser on the same computer**. So the normal, most-reliable
setup is **one computer** running the control panel with the game board on a **TV/monitor
plugged into (or extended from) that same computer**, and the Host view in another window
there.

To instead put the control panel, the TV board, and the Host view on **different devices**
on the same Wi-Fi (e.g. the host panel on a Windows laptop, the board on a smart-TV
browser), run the included relay on ONE machine. **Easiest: double-click
`Start Jeopardy.command`** (Mac) or **`Start Jeopardy (Windows).bat`** — no typing. (From a
terminal it's `python3 server.py`, optionally with a port: `python3 server.py 9000`.)

The server then **opens the "Connect your devices" page** (`connect.html`, also at `/connect`)
in the browser: each screen's address shown big, **with a QR code** — scan the Host view one
with an iPad/phone camera, and type the short TV address into the TV's browser. Every
browser on the network stays in sync. The control panel also shows a **LAN sync** badge and
lists the addresses under **Display setup** and Step 3.

Short addresses (what the connect page shows): **`/tv`** → the TV board, **`/host`** → the
Host view, **`/connect`** → the connect page itself.

**Will the address be the same next time?** Usually yes — bookmarks are fine. The IP number
can occasionally change (router restart, new network), so the connect page always shows the
*current* one; the server also prints a `name.local` address that survives IP changes
(works from Apple devices and modern laptops; some TVs want the IP form).

Notes:
- Plain Python standard library — no installs. First run on Windows, allow Python through
  the firewall so other devices can reach it. Keep the server window open while you play.
- Double-clicking the launcher when the server is already running is harmless — it notices
  and just reopens the connect page.
- Same-computer windows still also use BroadcastChannel, so local windows stay instant and
  nothing breaks if the relay hiccups. If `server.py` isn't running, the game just works in
  the reliable local mode above (it auto-detects whether the relay is there).
- Everything stays on your own network — no cloud, works offline.

Note: the control panel uses in-page dialogs (not the browser's popup boxes) so the TV
never gets kicked out of fullscreen. Bump the `?v=` number on the script tags in
`index.html` on each deploy so browsers pick up new code immediately.

## How it works (for future changes)

Plain HTML/CSS/JS, no build step, no backend (the optional `server.py` relay is pure
standard-library and only needed for cross-device play). Deployed as-is on GitHub Pages.

| File | Responsibility |
|------|----------------|
| `index.html` | Shell; loads everything. Same page is both apps: plain = control panel, `#display` = TV view. |
| `host.html` | The **Host view** page — a standalone, read-only companion screen (host's Mac/iPad). Loads `js/bus.js` then `js/host.js`; its styles are inline. |
| `connect.html` | The **"Connect your devices"** page `server.py` auto-opens — each screen's address big with a QR code (from `/net-info`). Standalone; loads only `js/vendor/qrcode.js`, styles inline. |
| `Start Jeopardy.command` / `Start Jeopardy (Windows).bat` | Double-click launchers that just run `python3 server.py` — for game night without a terminal. |
| `styles.css` | All styles. Control-panel styles under `body.control`, TV styles under `body.display`. |
| `js/bus.js` | The window/device sync transport: a drop-in `createBus()` wrapping BroadcastChannel (same-machine), plus an OPTIONAL LAN relay (SSE receive + POST send) auto-enabled only when served by `server.py`. Both `core.js` and `host.js` use it. |
| `server.py` | Optional LAN relay + static file server (stdlib only) for cross-device play — see "Play across separate devices". Auto-opens `/connect`, serves the `/tv` `/host` `/connect` short redirects, reports `ip`/`name`/`port` at `/net-info`. Not needed for same-computer use. |
| `js/core.js` | Shared state object `S`, the sync bus (`CHANNEL = createBus(...)`), localStorage save/resume, helpers. |
| `js/data.js` | Google Sheets fetch (whole-workbook xlsx export; CSV fallbacks), workbook parser (tab-per-category), legacy row-list parser. |
| `js/control.js` | The entire control-panel UI and game-flow handlers, plus the **Display setup** dialog (multi-screen deploy via the Window Management API + the fade failsafes). |
| `js/display.js` | The entire TV rendering (board, clue, Daily Double, Final, scores, timer) and the fade **curtain** overlay driven by `S.stage` (`game`/`black`/`title`). |
| `js/sample-game.js` | The built-in demo game. |
| `js/main.js` | Boot: decides which mode this window is. |
| `js/host.js` | The Host view logic: a BroadcastChannel listener with two modes — **Live view** (current question, host-visible answer, timer, winner-reveal heads-up, notes, Final Jeopardy wager entry) and **Question preview** (a board browser showing each clue's question/picture/answer plus the scores). Reads state; its only write is `set-final-wager`. |
| `js/vendor/xlsx.full.min.js` | SheetJS (reads the workbook in the browser). |
| `js/vendor/qrcode.js` | qrcode-generator (MIT, Kazuhiko Arase) — draws the QR codes on `connect.html`. |
| `tools/make_template.py` | Generates `template/Jeopardy Questions.xlsx` (openpyxl). The parser and this template are a matched pair — change them together. |

Design rules to preserve when adding features:

- **Single source of truth:** the control window owns `S` and broadcasts full snapshots
  after every change (`update()` in `core.js`). The display is a pure renderer — it never
  mutates game state. New features should follow the same pattern: mutate inside
  `update(() => {...})`, render from `S`.
- **Host-blind guarantee:** nothing in `control.js` may render an answer unless
  `S.revealed` / `S.finalRevealed` is already true. (The **Host view**, `host.html`, is the
  deliberate exception — a private screen for the person judging, so it *does* show the
  answer early; it is never the control panel or the TV.)
- **The Host view is near-passive:** `host.html` / `js/host.js` only READ `{type:"state"}`
  broadcasts (plus a read-only `host-hello` snapshot request), and it loads none of the
  game's other scripts. Its ONE write is Final Jeopardy wagers: it sends a `set-final-wager`
  message that `control.js` (`applyFinalWager`) applies to `S`. It must never send the
  display/control handshake messages or mutate `S` directly, or it'd be mistaken for a TV or
  a second control panel and fight over the game.
- **The game mirrors the sheet**, never the other way around: the sheet's tabs, filled
  rows, teams, and title decide what exists in the game.
- **Re-render safety:** the panel re-renders `innerHTML` on every update, so any
  in-progress form input must live in a module-level draft variable (see `sheetUrlDraft`,
  `ddDraft`, `finalWagerDrafts` in `control.js`).

Run locally: any static server in this folder, e.g. `python3 -m http.server 8123`, then
open `http://localhost:8123/` (or `python3 server.py` to also sync across devices on your
Wi-Fi — see "Play across separate devices"). Opening `index.html` directly as a file breaks
the Google-Sheets fetch and the window sync — always use a server or the live site.
`test-data/filled-test.xlsx` is a filled example workbook for testing the parser.

Idea backlog: buzzer support, sounds, board-fill animation, themes, round-2 support in
the workbook format, per-question stats.
