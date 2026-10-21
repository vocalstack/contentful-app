#!/usr/bin/env bash
# One command: build the app and its function, start the fake Contentful, run the
# browser test against a real VocalStack, stop the servers.
#
#   VOCALSTACK_API_KEY=vs_key_… e2e/run.sh
#
# Optional: VOCALSTACK_API_URL (default http://127.0.0.1:8090), E2E_AUDIO (an mp3 of
# speech; default e2e/fixtures/episode-042.mp3), E2E_CHROMIUM, E2E_SHOTS, E2E_SKIP_BUILD=1,
# E2E_HOST_PORT / E2E_APP_PORT / E2E_ASSET_PORT (5180-5182).
set -euo pipefail
cd "$(dirname "$0")/.."

: "${VOCALSTACK_API_KEY:?Set VOCALSTACK_API_KEY to a VocalStack key with read and write}"
export VOCALSTACK_API_URL="${VOCALSTACK_API_URL:-http://127.0.0.1:8090}"
export E2E_AUDIO="${E2E_AUDIO:-$PWD/e2e/fixtures/episode-042.mp3}"
export E2E_HOST_PORT="${E2E_HOST_PORT:-5180}" E2E_APP_PORT="${E2E_APP_PORT:-5181}" E2E_ASSET_PORT="${E2E_ASSET_PORT:-5182}"
[ -f "$E2E_AUDIO" ] || { echo "No audio at $E2E_AUDIO: set E2E_AUDIO to a short mp3 of speech" >&2; exit 2; }

ports=("$E2E_HOST_PORT" "$E2E_APP_PORT" "$E2E_ASSET_PORT")
stop_servers() {
  for p in "${ports[@]}"; do
    lsof -t -nP -iTCP:"$p" -sTCP:LISTEN 2>/dev/null | xargs kill 2>/dev/null || true
  done
}
for p in "${ports[@]}"; do
  if lsof -nP -iTCP:"$p" -sTCP:LISTEN >/dev/null 2>&1; then echo "Port $p is in use" >&2; exit 2; fi
done

[ "${E2E_SKIP_BUILD:-}" = 1 ] || npm run build >/dev/null

mkdir -p e2e/results
node e2e/server.mjs >e2e/results/server.log 2>&1 &
trap stop_servers EXIT
for _ in $(seq 50); do
  curl -sf "http://127.0.0.1:$E2E_HOST_PORT/api/state" >/dev/null && break
  sleep 0.2
done

node e2e/contentful.spec.mjs
