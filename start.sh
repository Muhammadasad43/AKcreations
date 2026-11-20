#!/bin/sh
# One container: website + optional WhatsApp bot. App data is stored in
# /tmp/akcreations-data.json and is intentionally lost when this instance restarts.

# WhatsApp bot is optional and independent of the website.
(
  while true; do
    EMBEDDED_BOT=1 python3 whatsapp-bot/bot.py
    echo "[bot] exited, restarting in 10s"; sleep 10
  done
) &

# Keep the website in the foreground lifecycle, restarting it if it exits.
while true; do
  npx next start -p "${PORT:-3000}"
  echo "[site] exited, restarting in 5s"; sleep 5
done
