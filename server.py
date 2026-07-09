#!/usr/bin/env python3
"""
Jeopardy LAN server (optional) — serves the game AND syncs it across devices.

Run this INSTEAD of `python3 -m http.server` when you want the control panel,
the TV display, and the Host View to live on DIFFERENT devices on the same
Wi-Fi (e.g. host panel on a Windows laptop, board on a smart-TV browser).

    python3 server.py            # serves on port 8123
    python3 server.py 9000       # ...or any port you pass

Then, on each device's browser (all on the same network), open the address it
prints — e.g. the control panel at  http://<your-ip>:8123/ , the TV at
http://<your-ip>:8123/#display , and the Host View at
http://<your-ip>:8123/host.html .

It's just the standard library — no pip installs. If you'd rather everything run
on ONE computer (the most reliable setup), you don't need this at all: use the
normal `python3 -m http.server` and drag the display window onto the TV. The game
detects whether this relay is present and uses it only if so.

How it works: the browser receives messages over a Server-Sent-Events stream
(/events) and sends them with POSTs (/send); this process just fans each message
out to every other connected device. Same-machine windows still also use the
browser's BroadcastChannel, so nothing is lost if this relay hiccups.
"""

import json
import os
import queue
import socket
import sys
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))   # serve the app next to this file

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
        if path == "/net-info":
            return self._send_json({"relay": True, "ip": lan_ip(), "port": self.server.server_address[1]})
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


def main():
    port = 8123
    if len(sys.argv) > 1:
        try:
            port = int(sys.argv[1])
        except ValueError:
            print("Port must be a number, e.g.  python3 server.py 8123")
            sys.exit(1)

    httpd = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    httpd.daemon_threads = True
    ip = lan_ip()
    print("=" * 60)
    print("  Jeopardy LAN server is running.")
    print("  Open these in a browser on any device on the same Wi-Fi:")
    print()
    print("    Control panel :  http://%s:%d/" % (ip, port))
    print("    TV display    :  http://%s:%d/#display" % (ip, port))
    print("    Host view     :  http://%s:%d/host.html" % (ip, port))
    print()
    print("  (On the SAME machine you can also use http://localhost:%d/ .)" % port)
    print("  First run on Windows: allow Python through the firewall so other")
    print("  devices can connect. Stop the server with Ctrl+C.")
    print("=" * 60)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
        httpd.shutdown()


if __name__ == "__main__":
    main()
