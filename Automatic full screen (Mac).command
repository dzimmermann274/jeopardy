#!/bin/bash
# ============================================================
#  Double-click this ONCE to stop the display window asking for
#  a click before it goes full screen.
#
#  Why it's needed: a web page is never allowed to take over the
#  whole screen on its own — that's a browser safety rule. The
#  one exception is when the computer's Chrome has been told to
#  trust a particular address. This file tells Chrome to trust
#  the Jeopardy game, and nothing else.
#
#  It only adds to the list — any address already trusted (for
#  example the copy of the game on the web) is left alone.
#
#  Afterwards: QUIT CHROME COMPLETELY (Cmd-Q — closing the
#  window is not enough) and open it again. From then on a
#  full-screen deploy fills the TV with no click at all.
#
#  To undo it later, run:  defaults delete com.google.Chrome AutomaticFullscreenAllowedForUrls
# ============================================================
set -u

# The addresses the game is served from on this computer. server.py listens on
# 8123 by default; leaving the port off the pattern covers whichever port it uses.
ORIGINS=("http://localhost" "http://127.0.0.1")

# Chrome, and Edge if it's installed. (Two separate browsers, two separate lists.)
BROWSERS=("com.google.Chrome:Google Chrome" "com.microsoft.Edge:Microsoft Edge")
KEY="AutomaticFullscreenAllowedForUrls"

echo "Allowing the Jeopardy game to go full screen on its own."
echo

changed=0
found=0
for entry in "${BROWSERS[@]}"; do
  domain="${entry%%:*}"
  name="${entry#*:}"

  # Skip a browser that isn't installed. Look in the personal Applications folder
  # too — some people keep their browser there.
  if [ ! -d "/Applications/$name.app" ] && [ ! -d "$HOME/Applications/$name.app" ]; then
    continue
  fi
  found=1

  before="$(defaults read "$domain" "$KEY" 2>/dev/null || true)"
  for origin in "${ORIGINS[@]}"; do
    # Already on the list? Don't add it twice.
    case "$before" in
      *"\"$origin\""*) echo "  $name — $origin was already allowed."; continue ;;
    esac
    # -array-add appends; it never replaces addresses that are already trusted.
    defaults write "$domain" "$KEY" -array-add "$origin"
    echo "  $name — added $origin"
    changed=1
    before="$(defaults read "$domain" "$KEY" 2>/dev/null || true)"
  done
done

echo
if [ "$found" -eq 0 ]; then
  echo "Couldn't find Google Chrome or Microsoft Edge on this computer, so there"
  echo "was nothing to set up. Automatic full screen only exists in those two"
  echo "browsers (version 127 or newer) — in Safari and Firefox the display window"
  echo "will always ask for one click before it fills the screen. That's normal,"
  echo "and the game works exactly the same."
elif [ "$changed" -eq 0 ]; then
  echo "Nothing to change — this computer was already set up."
  echo "(If the display still asks for a click, quit the browser fully with Cmd-Q"
  echo " and open it again, then check chrome://policy.)"
else
  echo "Done."
  echo
  echo "NOW: quit Chrome completely with Cmd-Q — closing the window is not enough —"
  echo "then open it again and start the game. The display window will fill the"
  echo "screen by itself."
  echo
  echo "To check it worked, visit  chrome://policy  and look for"
  echo "$KEY."
fi
echo
read -n 1 -s -r -p "Press any key to close this window."
echo
