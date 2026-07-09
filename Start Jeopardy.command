#!/bin/bash
# ============================================================
#  Double-click this file to start the Jeopardy game server.
#
#  A "Connect your devices" page opens in your browser with the
#  addresses + QR codes for the TV and the Host view. Keep the
#  Terminal window this opens in the background while you play;
#  close it (or press Ctrl+C) when game night is over.
#
#  If macOS says it "can't be opened because it is from an
#  unidentified developer": right-click the file, choose Open,
#  then Open again. That only has to be done once.
# ============================================================
cd "$(dirname "$0")"
echo "Starting the Jeopardy server..."
echo
if command -v python3 >/dev/null 2>&1; then
  python3 server.py
elif command -v python >/dev/null 2>&1; then
  python server.py
else
  echo "Python 3 isn't installed on this Mac, so the server can't start."
  echo "It comes with Apple's developer tools: open Terminal, type"
  echo "    xcode-select --install"
  echo "and press Return, then try this file again."
fi
echo
read -n 1 -s -r -p "Server stopped — press any key to close this window."
echo
