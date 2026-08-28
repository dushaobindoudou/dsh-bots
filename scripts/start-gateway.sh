#!/usr/bin/env bash
# sdk-bots 网关启动脚本（固定 7331 端口，dsh 插件经 ~/.sdk-bots/gateway.json 自动发现）
# 用法: ./scripts/start-gateway.sh          # 前台启动
#       ./scripts/start-gateway.sh -d       # 后台启动（nohup，日志 /tmp/sdk-bots-gateway.log）
set -euo pipefail

SDK_BOTS_DIR="${SDK_BOTS_DIR:-$HOME/workspaces/sdk-bots}"
PORT="${SAND_HOST_PORT:-7331}"

if curl -sS -m 3 "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1; then
  echo "[start-gateway] 端口 ${PORT} 已有网关在运行："
  curl -sS -m 3 "http://127.0.0.1:${PORT}/health"
  echo
  exit 0
fi

cd "$SDK_BOTS_DIR"
export SAND_HOST_PORT="$PORT"
echo "[start-gateway] 在 ${SDK_BOTS_DIR} 启动网关（端口 ${PORT}）..."
if [ "${1:-}" = "-d" ]; then
  nohup pnpm tsx src/bootstrap/index.ts > /tmp/sdk-bots-gateway.log 2>&1 &
  disown
  for i in $(seq 1 10); do
    sleep 2
    if curl -sS -m 3 "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1; then
      echo "[start-gateway] 就绪："
      curl -sS -m 3 "http://127.0.0.1:${PORT}/health"; echo
      exit 0
    fi
  done
  echo "[start-gateway] 20s 内未就绪，查看 /tmp/sdk-bots-gateway.log" >&2
  exit 1
else
  exec pnpm tsx src/bootstrap/index.ts
fi
