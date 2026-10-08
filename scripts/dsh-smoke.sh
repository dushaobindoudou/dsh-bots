#!/usr/bin/env bash
# dsh-bots — fresh-profile smoke: install the packed tarball into a
# throwaway DSH_HOME, verify the composed config carries the plugin row, then
# boot `dsh web` and check both HTTP and client plugin activation.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d)"
WEB_PID=""

cleanup() {
  if [ -n "$WEB_PID" ]; then
    kill "$WEB_PID" 2>/dev/null || true
  fi
  rm -rf "$TMP"
}
trap cleanup EXIT

DSH_BIN="${DSH_BIN:-$(command -v dsh)}"
if [ "$#" -gt 0 ]; then
  TGZ="$1"
else
  pnpm --dir "$ROOT" pack --pack-destination "$TMP" >/dev/null
  TGZ="$(ls "$TMP"/dsh-bots-*.tgz | head -1)"
fi
export DSH_HOME="$TMP/dsh-home"

echo "== install packed plugin into a fresh DSH profile ($TGZ) =="
"$DSH_BIN" plugin --profile web add "$TGZ"

echo "== verify the plugin row exists in the composed config =="
"$DSH_BIN" --profile web --dump-config | grep -q 'dsh-bots'
echo "PASS plugin appears in DSH config"

echo "== boot dsh web with the plugin loaded (bounded retry, 30s cap) =="
PORT="${SMOKE_PORT:-4099}"
"$DSH_BIN" web --port "$PORT" --no-open >"$TMP/web.log" 2>&1 &
WEB_PID=$!

ready=0
for _ in $(seq 1 30); do
  # dsh requires the per-process browser token even for this local probe.
  url="$(grep -m1 -oE 'http://127\.0\.0\.1:[0-9]+/\?token=[^[:space:]]+' "$TMP/web.log" || true)"
  if [ -n "$url" ] && curl --noproxy '*' -sf "$url" >/dev/null 2>&1; then
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
  sed -E 's/token=[^[:space:]]+/token=[redacted]/g' "$TMP/web.log"
  exit 1
fi

echo "PASS dsh web booted with the plugin loaded (HTTP 200)"
printf '%s' "$url" | node "$ROOT/scripts/dsh-client-smoke.mjs"
