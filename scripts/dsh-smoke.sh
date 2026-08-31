#!/usr/bin/env bash
# dsh-plugin-bots — fresh-profile smoke: install the packed tarball into a
# throwaway DSH_HOME, verify the composed config carries the plugin row, then
# boot `dsh web` against that home and expect HTTP 200.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TGZ="${1:-$(ls "$ROOT"/dsh-plugin-bots-*.tgz | sort | tail -1)}"
TMP="$(mktemp -d)"
WEB_PID=""

cleanup() {
  if [ -n "$WEB_PID" ]; then
    kill "$WEB_PID" 2>/dev/null || true
  fi
  rm -rf "$TMP"
}
trap cleanup EXIT

DSH_BIN="$(command -v dsh)"
export DSH_HOME="$TMP/dsh-home"

echo "== install packed plugin into a fresh DSH profile ($TGZ) =="
"$DSH_BIN" plugin --profile web add "$TGZ"

echo "== verify the plugin row exists in the composed config =="
"$DSH_BIN" --profile web --dump-config | grep -q 'dsh-plugin-bots'
echo "PASS plugin appears in DSH config"

echo "== boot dsh web with the plugin loaded (bounded retry, 30s cap) =="
PORT="${SMOKE_PORT:-4099}"
"$DSH_BIN" web --port "$PORT" >"$TMP/web.log" 2>&1 &
WEB_PID=$!

ready=0
for _ in $(seq 1 30); do
  if curl -sf "http://127.0.0.1:$PORT" >/dev/null 2>&1; then
    ready=1
    break
  fi
  if ! kill -0 "$WEB_PID" 2>/dev/null; then
    break
  fi
  sleep 1
done

if [ "$ready" -ne 1 ]; then
  echo "FAIL dsh web did not become ready within 30s"
  cat "$TMP/web.log"
  exit 1
fi

echo "PASS dsh web booted with the plugin loaded (HTTP 200)"
