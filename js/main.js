"use strict";
/* ============================================================
   Boot. The same page is both apps:
     index.html          -> control panel
     index.html#display  -> display (TV) window
   ============================================================ */

if (IS_DISPLAY) {
  document.title = "Jeopardy — Display";
  renderDisplay();
  CHANNEL.postMessage({ type: "hello" });   // ask the control window for current state
  document.addEventListener("keydown", (e) => {
    if (e.key.toLowerCase() === "f") goFullscreen();
  });
  document.addEventListener("fullscreenchange", renderDisplay);
  document.addEventListener("webkitfullscreenchange", renderDisplay);
  // Opened with "#display&fs=1" (a fullscreen deploy from the control panel):
  // enter true fullscreen automatically — on the first key/click, or with no
  // interaction at all if this site is allow-listed for automatic fullscreen.
  if (location.hash.includes("fs=1")) armAutoFullscreen();
} else {
  document.title = "Jeopardy — Control Panel";
  renderControl();   // if a saved game exists, the setup screen offers to resume it
  // Check for another open control tab before claiming the display: broadcast
  // hello, and only push our state if nobody objects within half a second.
  CHANNEL.postMessage({ type: "control-hello" });
  setTimeout(() => { if (!otherControlDetected) send(); }, 500);
  window.addEventListener("beforeunload", () => { save(); });
}
