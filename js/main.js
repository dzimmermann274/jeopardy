"use strict";
/* ============================================================
   Boot. The same page is both apps:
     index.html          -> control panel
     index.html#display  -> display (TV) window
   ============================================================ */

if (IS_DISPLAY) {
  document.title = "Jeopardy — Display";
  // The control panel encodes the opening stage in the URL (e.g. #display&stage=black)
  // so the very first paint is already the curtain it should be — no flash of the
  // game before a black deploy. The state broadcast that follows keeps it in sync.
  const stageMatch = location.hash.match(/[?&]stage=([a-z]+)/);
  if (stageMatch) S.stage = stageMatch[1];
  renderDisplay();
  const displayHello = () => {
    CHANNEL.postMessage({ type: "hello" });          // ask the control window for current state
    CHANNEL.postMessage({ type: "display-alive" });  // announce presence right away
  };
  displayHello();
  CHANNEL.onnetopen = displayHello;                  // re-announce when the LAN relay (re)connects
  setInterval(() => CHANNEL.postMessage({ type: "display-alive" }), 1000);  // heartbeat: the control trusts a recent beat
  document.addEventListener("keydown", (e) => {
    if (e.key.toLowerCase() === "f") goFullscreen();
  });
  // A real viewport change (resize, or entering/leaving fullscreen) can invalidate
  // the cached clue fit (it's viewport-relative), so drop it and re-fit fresh.
  const onViewportChange = () => { clearFitCache(); renderDisplay(); };
  document.addEventListener("fullscreenchange", onViewportChange);
  document.addEventListener("webkitfullscreenchange", onViewportChange);
  window.addEventListener("resize", onViewportChange);
  // Re-offer one-click full screen if the TV drops out of it (e.g. opening the
  // Host View in another tab steals the browser's focus and exits full screen).
  document.addEventListener("fullscreenchange", onFullscreenChange);
  document.addEventListener("webkitfullscreenchange", onFullscreenChange);
  // Opened with "#display&fs=1" (a fullscreen deploy from the control panel):
  // enter true fullscreen automatically — on the first key/click, or with no
  // interaction at all if this site is allow-listed for automatic fullscreen.
  if (location.hash.includes("fs=1")) armAutoFullscreen();
} else {
  document.title = "Jeopardy — Control Panel";
  ensureTimerAudio();   // start buffering the think music so the first timer is instant
  renderControl();   // if a saved game exists, the setup screen offers to resume it
  // Check for another open control tab before claiming the display: broadcast
  // hello, and only push our state if nobody objects within half a second.
  const controlHello = () => {
    CHANNEL.postMessage({ type: "control-hello" });
    CHANNEL.postMessage({ type: "ping-display" });  // ask any already-open display to announce itself (survives a reload)
    if (S.phase === "play") send();                 // push current state to devices that connected first
  };
  controlHello();
  // When the LAN relay (re)connects, re-do the handshake so devices on other
  // machines sync, and refresh the control panel so its network status shows.
  CHANNEL.onnetopen = controlHello;
  CHANNEL.onnetchange = () => {
    const el = document.activeElement;
    if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;   // don't yank focus mid-typing
    collectTeamNames();
    renderControl();
  };
  setTimeout(() => { if (!otherControlDetected) send(); }, 500);
  window.addEventListener("beforeunload", () => { save(); });
  setInterval(refreshDisplayOpenState, 1000);      // flip the "display open?" UI if the display closes elsewhere
}
