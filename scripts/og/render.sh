#!/usr/bin/env sh
# Gera public/og.png (1200×630) e public/apple-touch-icon.png (180×180) a partir dos HTML desta pasta,
# usando o Chrome em modo headless (as fontes da marca vêm do Google Fonts, então precisa de rede).
# Uso: sh scripts/og/render.sh   (ou CHROME=/caminho/pro/chrome sh scripts/og/render.sh)
set -eu
cd "$(dirname "$0")/../.."
CHROME="${CHROME:-}"
for c in "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" google-chrome chromium chromium-browser; do
  [ -n "$CHROME" ] && break
  if [ -x "$c" ] || command -v "$c" >/dev/null 2>&1; then CHROME="$c"; fi
done
[ -n "$CHROME" ] || { echo "Chrome/Chromium não encontrado; defina CHROME=" >&2; exit 1; }
shot() { # $1 html, $2 png, $3 WxH
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
    --virtual-time-budget=6000 --window-size="$3" --screenshot="$2" "file://$PWD/$1" >/dev/null 2>&1
  echo "gerado $2"
}
shot scripts/og/og.html public/og.png 1200,630
shot scripts/og/icon.html public/apple-touch-icon.png 180,180
