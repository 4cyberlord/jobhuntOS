#!/bin/zsh
# Install with mode 700. Store API URL and the DESKTOP_SYNC_KEY in a mode-600 local config.
CONFIG="$HOME/Library/Application Support/JobHuntOS/notifier.env"
[[ -r "$CONFIG" ]] || exit 0
source "$CONFIG"
[[ -n "$JOB_HUNT_API_URL" && -n "$JOB_HUNT_DESKTOP_SYNC_KEY" ]] || exit 0
curl --silent --fail --max-time 15 -H "Authorization: Bearer $JOB_HUNT_DESKTOP_SYNC_KEY" "$JOB_HUNT_API_URL/v1/desktop/notifications" | /usr/bin/python3 -c 'import json,sys,subprocess; [subprocess.run(["/usr/bin/osascript","-e",f"display notification {json.dumps(x["body"])} with title {json.dumps(x["title"])}"]) for x in json.load(sys.stdin)]' 2>/dev/null
