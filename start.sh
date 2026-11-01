#!/bin/sh
# One container, one Render service: website (foreground) + WhatsApp bot (background).

# Sync DB schema at boot (env vars exist at runtime). Never blocks startup.
npx prisma db push || echo "prisma db push failed, continuing"

# Bot: restarts itself if it crashes, without touching the website.
(
  while true; do
    EMBEDDED_BOT=1 python3 whatsapp-bot/bot.py
    echo "bot exited, restarting in 10s"; sleep 10
  done
) &

# Website on Render's $PORT; this is the process Render health-checks.
exec npx next start -p "${PORT:-3000}"
