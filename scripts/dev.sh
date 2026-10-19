#!/usr/bin/env bash
# Chạy lại web (FE) và API (BE) ở chế độ dev: tắt tiến trình đang giữ cổng cũ trước, rồi mở lại cả hai.
# Dùng: ./scripts/dev.sh   (Ctrl+C để tắt cả hai). Log: logs/api.log, logs/web.log (thư mục logs/ nằm trong .gitignore)
set -u

WEB_PORT="${WEB_PORT:-3801}"
API_PORT="${API_PORT:-3802}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$ROOT/logs"
mkdir -p "$LOG_DIR"

# --- 1. Kill pid đang giữ cổng cũ ---
for port in "$WEB_PORT" "$API_PORT"; do
  pids="$(lsof -nP -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
  if [ -n "$pids" ]; then
    echo "Cổng $port đang bị giữ bởi pid: $(echo $pids | tr '\n' ' ') -> kill"
    kill $pids 2>/dev/null || true
    sleep 1
    pids="$(lsof -nP -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
    [ -n "$pids" ] && kill -9 $pids 2>/dev/null || true
  fi
done

# --- 2. Chuẩn bị node/pnpm: engines của api cần đúng Node theo .nvmrc (24), nên node trong PATH lệch bản (vd 22) thì đổi sang bản nvm khớp; pnpm qua corepack ---
want="$(tr -d 'v \n' < "$ROOT/.nvmrc")"
have="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || true)"
if [ "$have" != "$want" ]; then
  dir="$(ls -d "$HOME"/.nvm/versions/node/v"$want".* 2>/dev/null | sort -V | tail -1)"
  [ -n "$dir" ] || { echo "Cần Node $want (đang có: ${have:-không có}), không thấy trong ~/.nvm. Cài bằng: nvm install $want"; exit 1; }
  export PATH="$dir/bin:$PATH"
fi
echo "Node $(node -v)"
if command -v pnpm >/dev/null 2>&1; then PNPM=(pnpm); else PNPM=(corepack pnpm); fi

# --- 3. Chạy BE và FE ---
# Web gọi API cùng origin qua rewrite /api/v1 của Next (xem apps/web/next.config.mjs), nên mở được qua ngrok.
(cd "$ROOT/apps/api" && exec "${PNPM[@]}" dev) > "$LOG_DIR/api.log" 2>&1 &
API_PID=$!
(cd "$ROOT/apps/web" && NEXT_PUBLIC_API_BASE_URL=/api/v1 WEB_PORT="$WEB_PORT" exec "${PNPM[@]}" dev) > "$LOG_DIR/web.log" 2>&1 &
WEB_PID=$!

cleanup() {
  echo; echo "Tắt FE, BE..."
  pkill -P "$API_PID" 2>/dev/null; pkill -P "$WEB_PID" 2>/dev/null
  kill "$API_PID" "$WEB_PID" 2>/dev/null
  for port in "$WEB_PORT" "$API_PORT"; do
    pids="$(lsof -nP -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
    [ -n "$pids" ] && kill $pids 2>/dev/null
  done
  exit 0
}
trap cleanup INT TERM

echo "BE (pid $API_PID): http://localhost:$API_PORT   log: $LOG_DIR/api.log"
echo "FE (pid $WEB_PID): http://localhost:$WEB_PORT   log: $LOG_DIR/web.log"
echo "Ctrl+C để tắt cả hai."
wait
