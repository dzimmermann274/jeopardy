"use strict";
/* ============================================================
   Shared message bus for the Jeopardy windows.

   By DEFAULT this is a thin wrapper over BroadcastChannel — the
   reliable local mode: it syncs windows/tabs of the same site in
   the same browser on the SAME computer (control panel + TV
   display + Host View), exactly like before. No server needed.

   OPTIONALLY, when the page is served by the little LAN relay
   (server.py), it ALSO syncs over the network: it receives with an
   SSE stream (EventSource) and sends with plain POSTs, so the
   control panel, the game display, and the Host View can each live
   on a DIFFERENT device on the same Wi-Fi. Both paths run together
   and duplicates are dropped, so same-machine windows stay instant
   and cross-device windows stay in sync. If the relay isn't there
   (plain file:// or `python3 -m http.server`), it's pure
   BroadcastChannel — nothing changes.

   Drop-in compatible with BroadcastChannel:
     const bus = createBus("name");
     bus.postMessage(msg);     // fan out to every OTHER window/device
     bus.onmessage = fn;       // fn({ data: msg })
   Extra network hooks (harmless in local mode):
     bus.net                   // { enabled, connected, info } live status
     bus.onnetopen  = fn;      // called each time the relay (re)connects
     bus.onnetchange = fn;     // called when enabled/connected flips (UI)
   ============================================================ */
function createBus(name) {
  const bc = (typeof BroadcastChannel !== "undefined") ? new BroadcastChannel(name) : null;
  // A per-window id: tags our outgoing messages so the relay can skip echoing
  // them back to us, and receivers can drop a duplicate that arrived on both
  // transports (BroadcastChannel AND the network) for a same-machine window.
  const myId = Math.random().toString(36).slice(2) + Date.now().toString(36);

  const bus = {
    onmessage: null,
    onnetopen: null,
    onnetchange: null,
    net: { enabled: false, connected: false, info: null },
  };

  let seq = 0;
  const seen = new Set();
  const seenOrder = [];
  function alreadySeen(id) {
    if (!id) return false;
    if (seen.has(id)) return true;
    seen.add(id); seenOrder.push(id);
    if (seenOrder.length > 600) seen.delete(seenOrder.shift());
    return false;
  }
  function deliver(msg) {
    if (!msg) return;
    if (alreadySeen(msg.__id)) return;   // same message already delivered via the other transport
    if (bus.onmessage) { try { bus.onmessage({ data: msg }); } catch (e) {} }
  }
  if (bc) bc.onmessage = (ev) => deliver(ev.data);

  /* ---- optional LAN relay: SSE to receive, POST to send ---- */
  let es = null, reconnectTimer = null;
  function fireNetChange() { if (bus.onnetchange) { try { bus.onnetchange(bus.net); } catch (e) {} } }
  function setConnected(v) { if (bus.net.connected !== v) { bus.net.connected = v; fireNetChange(); } }

  function openStream() {
    try { es = new EventSource("events?id=" + encodeURIComponent(myId)); }
    catch (e) { return; }
    es.onmessage = (ev) => { try { deliver(JSON.parse(ev.data)); } catch (e) {} };
    es.onopen = () => { setConnected(true); if (bus.onnetopen) { try { bus.onnetopen(); } catch (e) {} } };
    es.onerror = () => {
      setConnected(false);
      // EventSource retries on its own while the connection is merely dropped
      // (readyState CONNECTING). If the server actually went away (CLOSED), it
      // won't retry — so recreate it after a short delay.
      if (es && es.readyState === 2 /* CLOSED */) {
        try { es.close(); } catch (e) {}
        es = null;
        clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(openStream, 2000);
      }
    };
  }

  function enableRelay(info) {
    if (bus.net.enabled) return;
    bus.net.enabled = true;
    bus.net.info = info;
    fireNetChange();
    openStream();
  }

  // Ask the origin whether it's the relay. Plain static servers / GitHub Pages
  // 404 here (or aren't http) -> we quietly stay BroadcastChannel-only.
  if (location.protocol === "http:" || location.protocol === "https:") {
    fetch("net-info", { cache: "no-store" })
      .then((r) => (r && r.ok) ? r.json() : null)
      .then((info) => { if (info && info.relay) enableRelay(info); })
      .catch(() => { /* no relay here — local mode */ });
  }

  bus.postMessage = (msg) => {
    const tagged = Object.assign({}, msg, { __id: myId + ":" + (++seq) });
    if (bc) { try { bc.postMessage(tagged); } catch (e) {} }   // same-machine windows
    if (bus.net.enabled) {                                      // other devices, via the relay
      try {
        fetch("send?id=" + encodeURIComponent(myId), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(tagged),
          keepalive: true,
        }).catch(() => {});
      } catch (e) {}
    }
  };

  return bus;
}
