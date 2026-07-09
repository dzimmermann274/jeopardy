#!/usr/bin/env python3
"""
Jeopardy LAN server (optional) — serves the game AND syncs it across devices.

Run this INSTEAD of `python3 -m http.server` when you want the control panel,
the TV display, and the Host View to live on DIFFERENT devices on the same
Wi-Fi (e.g. host panel on a Windows laptop, board on a smart-TV browser).

Easiest: double-click "Start Jeopardy.command" (Mac) or "Start Jeopardy
(Windows).bat" — they just run this. Or from a terminal:

    python3 server.py            # serves on port 8123
    python3 server.py 9000       # ...or any port you pass
    python3 server.py --no-open  # don't auto-open the connect page

On start it opens the CONNECT PAGE (connect.html) in the browser: each screen's
address shown big with a QR code to scan. Short addresses for easy typing:
/tv -> the TV board, /host -> the Host view, /connect -> that page. The
computer's name.local address is shown too, since it survives IP changes.

It's just the standard library — no pip installs. If you'd rather everything run
on ONE computer (the most reliable setup), you don't need this at all: use the
normal `python3 -m http.server` and drag the display window onto the TV. The game
detects whether this relay is present and uses it only if so.

How it works: the browser receives messages over a Server-Sent-Events stream
(/events) and sends them with POSTs (/send); this process just fans each message
out to every other connected device. Same-machine windows still also use the
browser's BroadcastChannel, so nothing is lost if this relay hiccups.
"""

import errno
import json
import os
import queue
import socket
import sys
import threading
import urllib.request
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))   # serve the app next to this file

# Short, easy-to-type addresses (what the connect page and QR codes use).
SHORTCUTS = {
    "/tv": "/#display",         # the TV board
    "/host": "/host.html",      # the Host view
    "/connect": "/connect.html",
    "/join": "/connect.html",
}

# id -> Queue of pending message strings for that client's SSE stream
_clients = {}
_clients_lock = threading.Lock()


def lan_ip():
    """Best-effort local network IP (the address other devices should use)."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))          # no packets sent; just picks the route/interface
        return s.getsockname()[0]
    except Exception:
        return "127.0.0.1"
    finally:
        s.close()


def mdns_name():
    """The computer's `name.local` address — stays the same even if the IP changes.

    Resolves via mDNS/Bonjour: works from Apple devices and modern Windows/Linux;
    some smart TVs can't use it, which is why the IP is always shown too.
    """
    try:
        name = socket.gethostname().split(".")[0].strip()
    except Exception:
        return ""
    return (name.lower() + ".local") if name else ""


class Handler(SimpleHTTPRequestHandler):
    # Serve files from the app directory regardless of the current working dir.
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    # Quieter logs — one line per client connect/relay is plenty; drop the
    # per-file 200s that http.server normally spams.
    def log_message(self, fmt, *args):
        pass

    def _client_id(self):
        # /events?id=xxx  or  /send?id=xxx
        q = self.path.split("?", 1)[1] if "?" in self.path else ""
        for part in q.split("&"):
            if part.startswith("id="):
                return part[3:]
        return ""

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path in SHORTCUTS:
            self.send_response(302)
            self.send_header("Location", SHORTCUTS[path])
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        if path == "/net-info":
            return self._send_json({"relay": True, "ip": lan_ip(),
                                    "port": self.server.server_address[1],
                                    "name": mdns_name()})
        if path == "/events":
            return self._serve_events()
        return super().do_GET()

    def do_POST(self):
        path = self.path.split("?", 1)[0]
        if path == "/send":
            return self._relay()
        self.send_error(404)

    def _send_json(self, obj):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def _relay(self):
        """Read one message and hand it to every OTHER connected client."""
        try:
            length = int(self.headers.get("Content-Length", 0))
        except (TypeError, ValueError):
            length = 0
        data = self.rfile.read(length) if length else b""
        sender = self._client_id()
        text = data.decode("utf-8", "replace")
        with _clients_lock:
            targets = [(cid, q) for cid, q in _clients.items() if cid != sender]
        for _cid, q in targets:
            try:
                q.put_nowait(text)
            except queue.Full:
                pass
        # 204 No Content — nothing to send back.
        self.send_response(204)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def _serve_events(self):
        """Hold the connection open and stream messages as they arrive."""
        cid = self._client_id() or ("anon-" + str(id(self)))
        q = queue.Queue(maxsize=1000)
        with _clients_lock:
            _clients[cid] = q
        try:
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache, no-store")
            self.send_header("Connection", "keep-alive")
            self.send_header("X-Accel-Buffering", "no")   # in case any proxy sits in front
            self.end_headers()
            # An initial comment opens the stream immediately for the browser.
            self.wfile.write(b": connected\n\n")
            self.wfile.flush()
            while True:
                try:
                    msg = q.get(timeout=15)             # block for a message...
                    payload = "data: " + msg + "\n\n"
                except queue.Empty:
                    payload = ": ping\n\n"              # ...or send a heartbeat to keep it alive
                self.wfile.write(payload.encode("utf-8"))
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass                                        # client (device) went away
        except Exception:
            pass
        finally:
            with _clients_lock:
                if _clients.get(cid) is q:
                    del _clients[cid]


def our_server_already_on(port):
    """True if something answering like this relay is already serving `port`."""
    try:
        with urllib.request.urlopen("http://127.0.0.1:%d/net-info" % port, timeout=2) as r:
            return bool(json.load(r).get("relay"))
    except Exception:
        return False


def main():
    port = 8123
    no_open = False
    for arg in sys.argv[1:]:
        if arg == "--no-open":                  # skip auto-opening the browser
            no_open = True
        else:
            try:
                port = int(arg)
            except ValueError:
                print("Port must be a number, e.g.  python3 server.py 8123")
                sys.exit(1)

    connect_url = "http://localhost:%d/connect" % port

    try:
        httpd = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    except OSError as e:
        if e.errno == errno.EADDRINUSE and our_server_already_on(port):
            # Double-clicked the launcher twice? Totally fine — reuse the running one.
            print("The Jeopardy server is ALREADY running — using that one.")
            print("Opening the connect page: %s" % connect_url)
            if not no_open:
                webbrowser.open(connect_url)
            return
        print("Port %d is busy. Close the other program using it, or pick" % port)
        print("another port, e.g.:  python3 server.py %d" % (port + 1))
        sys.exit(1)

    httpd.daemon_threads = True
    ip = lan_ip()
    name = mdns_name()
    print("=" * 62)
    print("  Jeopardy LAN server is running.  KEEP THIS WINDOW OPEN.")
    print()
    print("  A 'Connect your devices' page is opening in your browser --")
    print("  it shows these addresses big, with QR codes you can scan:")
    print()
    print("    Control panel :  http://%s:%d/" % (ip, port))
    print("    TV display    :  http://%s:%d/tv" % (ip, port))
    print("    Host view     :  http://%s:%d/host" % (ip, port))
    print("    Connect page  :  http://%s:%d/connect" % (ip, port))
    if name:
        print()
        print("  If that number ever changes, this name works too:")
        print("    http://%s:%d/  (and /tv, /host, /connect)" % (name, port))
    print()
    print("  First run: if the firewall asks, click Allow so other devices")
    print("  can connect. Stop the server with Ctrl+C.")
    print("=" * 62)
    sys.stdout.flush()   # show the banner even when output is piped/logged
    if not no_open:
        # Give the server a beat to start accepting, then pop the connect page.
        threading.Timer(0.8, webbrowser.open, args=(connect_url,)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
        httpd.shutdown()


if __name__ == "__main__":
    main()
