"use strict";
/* ============================================================
   Bulletproof clue pictures — shared by the TV (display.js) and
   the Host View (host.js). Standalone: no other script needed.

   THE PROBLEM. Pictures come from the web (usually the Google-
   hosted lh3.googleusercontent.com links the Image Bank resolves
   to). The TV rebuilds its DOM on every state change, and every
   rebuild made the browser ask Google for the pictures again.
   After a while of play Google starts refusing those repeated
   anonymous requests (rate limiting), and a mid-game Wi-Fi blip
   fails a load outright — and the old code gave a picture exactly
   ONE chance before replacing it with "Picture couldn't load"
   for good.

   THE FIX, in two layers:

   1. FETCH ONCE, KEEP FOREVER — imgPrefetch(urls) downloads every
      picture in the background as soon as a window knows the game
      and pins the bytes in memory as a blob: URL. cachedImg(url)
      hands renders the pinned copy, so a re-render costs no
      network at all: Google is asked for each picture roughly
      once per window, and a pinned picture can never fail again,
      even if the Wi-Fi dies mid-game. Prefetch failures retry
      quietly with growing delays. A host that blocks cross-origin
      reads (fetch refused by CORS) is probed with a plain <img>
      instead — that can't be pinned, but it warms the browser's
      HTTP cache and proves the URL is renderable.

   2. RETRY BEFORE GIVING UP — imgRetry(img) is the onerror
      handler for every game <img>. A load that fails before its
      prefetch has landed retries several times with growing
      delays (cache-busting the later tries so the browser really
      re-asks) and only then shows the placeholder. Known-dead
      URLs (several straight background failures) skip the ladder
      so the host hears about a truly missing picture quickly.

   RECOVERY. When a prefetch finally lands, window.imgCacheOnPin
   (set by display.js / host.js) repaints the screen, so even a
   picture that already showed the placeholder comes back by
   itself. window.onImgGiveUp (display.js) reports a final failure
   to the control panel, exactly like the old imgFail did.
   ============================================================ */

const IMG_PIN = Object.create(null);   // original URL -> pinned blob: URL (lives as long as the page)
const IMG_JOB = Object.create(null);   // original URL -> { state, tries, nextAt, timer }
                                       //   state: "pending" | "pinned" | "nocors" | "failed"
const IMG_FETCH_MAX = 3;               // gentle prefetch: never hammer the image host
const imgFetchQueue = [];
let imgFetchActive = 0;

/* The URL renders should use: the pinned in-memory copy when we have one,
   otherwise the original (network) URL — exactly what was rendered before. */
function cachedImg(url) { return IMG_PIN[url] || url; }

/* Every picture URL a game can ever show — both rounds and Final Jeopardy,
   question AND answer pictures. This is the prefetch worklist. */
function gameImageUrls(game) {
  const out = [];
  const add = (v) => {
    const list = Array.isArray(v) ? v : v ? [v] : [];
    for (const u of list) if (u && out.indexOf(u) === -1) out.push(u);
  };
  if (!game) return out;
  for (const r of game.rounds || []) {
    for (const c of r.categories || []) {
      for (const cl of c.clues || []) if (cl) { add(cl.image); add(cl.answerImage); }
    }
  }
  if (game.final) { add(game.final.image); add(game.final.answerImage); }
  return out;
}

/* Queue URLs for background pinning. Cheap and idempotent — call it on every
   state receipt: URLs already pinned / in flight / backing off are skipped. */
function imgPrefetch(urls) {
  const now = Date.now();
  for (const u of urls || []) {
    if (!u || !/^https?:/i.test(u)) continue;      // data:/blob:/relative — nothing to prefetch
    const j = IMG_JOB[u];
    if (j && j.state !== "failed") continue;       // pinned, probing, or already in flight
    if (j && now < j.nextAt) continue;             // failed, but its next go isn't due yet
    IMG_JOB[u] = { state: "pending", tries: j ? j.tries : 0, nextAt: 0, timer: null };
    imgFetchQueue.push(u);
  }
  imgPump();
}

function imgPump() {
  while (imgFetchActive < IMG_FETCH_MAX && imgFetchQueue.length) {
    const u = imgFetchQueue.shift();
    imgFetchActive++;
    const done = () => { imgFetchActive--; imgPump(); };
    imgFetchOne(u).then(done, done);
  }
}

function imgFirePin(url) {
  if (typeof window.imgCacheOnPin === "function") { try { window.imgCacheOnPin(url); } catch (e) {} }
}

async function imgFetchOne(u) {
  const j = IMG_JOB[u];
  try {
    // Abort a hung download after 20s so it can't clog a prefetch slot forever.
    const ctl = (typeof AbortController !== "undefined") ? new AbortController() : null;
    const kill = ctl ? setTimeout(() => ctl.abort(), 20000) : null;
    let res;
    try { res = await fetch(u, ctl ? { signal: ctl.signal } : {}); }
    finally { if (kill) clearTimeout(kill); }
    if (!res.ok) throw new Error("HTTP " + res.status);
    const blob = await res.blob();
    IMG_PIN[u] = URL.createObjectURL(blob);
    j.state = "pinned";
    imgFirePin(u);
    return;
  } catch (e) { /* fall through to the <img> probe */ }
  // fetch() is refused by CORS on some hosts even though an <img> tag shows the
  // picture fine. Probe with a plain image: success => renderable, just not
  // pinnable (and the browser's HTTP cache is now warm); failure => a real
  // network/URL problem worth retrying.
  const probeOk = await new Promise((resolve) => {
    const im = new Image();
    im.onload = () => resolve(true);
    im.onerror = () => resolve(false);
    im.src = u;
  });
  if (probeOk) { j.state = "nocors"; imgFirePin(u); return; }
  j.state = "failed";
  j.tries++;
  // 4s, 8s, 16s… capped at a minute between goes — and it never stops for good:
  // the pictures matter for the whole game, so keep quietly trying.
  const wait = Math.min(60000, 4000 * Math.pow(2, Math.min(j.tries - 1, 5)));
  j.nextAt = Date.now() + wait;
  clearTimeout(j.timer);
  j.timer = setTimeout(() => imgPrefetch([u]), wait + 100);
}

/* Per-<img> retry ladder before the visible placeholder. Re-renders create
   fresh <img>s (restarting the ladder), which is fine: the background prefetch
   independently decides when a URL is hopeless. */
const IMG_RETRY_MS = [600, 1500, 3000, 6000, 10000];

function imgRetry(img) {
  const orig = img.dataset.orig || img.src;
  // A pinned blob: URL that itself failed means the pinned bytes are bad
  // (truncated download) — drop the pin and go back to the network for it.
  if (img.src && img.src.indexOf("blob:") === 0 && IMG_PIN[orig]) {
    try { URL.revokeObjectURL(IMG_PIN[orig]); } catch (e) {}
    delete IMG_PIN[orig];
    if (IMG_JOB[orig]) { IMG_JOB[orig].state = "failed"; IMG_JOB[orig].nextAt = 0; }
    imgPrefetch([orig]);
  }
  const n = +(img.dataset.retry || 0);
  // Known-dead (several straight background failures) or out of chances:
  // show the placeholder and tell the host. A later successful prefetch
  // still repaints and brings the picture back (imgCacheOnPin).
  const bg = IMG_JOB[orig];
  const hopeless = bg && bg.state === "failed" && bg.tries >= 3;
  if (hopeless || n >= IMG_RETRY_MS.length) {
    const ph = document.createElement("div");
    ph.className = "clue-img-fail";
    ph.textContent = "⚠️ Picture couldn't load";
    img.replaceWith(ph);
    if (typeof window.onImgGiveUp === "function") { try { window.onImgGiveUp(orig); } catch (e) {} }
    return;
  }
  img.dataset.retry = n + 1;
  setTimeout(() => {
    if (!img.isConnected) return;   // a re-render replaced this element; its successor loads afresh
    // Use the pinned copy if the prefetch landed meanwhile; otherwise ask the
    // network again with a cache-buster so the browser doesn't just replay the
    // failure it cached.
    img.src = IMG_PIN[orig] || (orig + (orig.indexOf("?") !== -1 ? "&" : "?") + "retry=" + (n + 1));
  }, IMG_RETRY_MS[n]);
}
