#!/bin/sh
# One container: website + WhatsApp bot, each supervised on its own.
# Neither depends on the other, and neither depends on the database being up.

# Database schema sync: runs in the background, never delays or blocks anything.
# (Uses Neon's direct host when available: DIRECT_URL, else DATABASE_URL minus "-pooler".)
(
  DIRECT="${DIRECT_URL:-$(printf '%s' "$DATABASE_URL" | sed 's/-pooler//')}"
  for i in 1 2 3 4 5; do
    DATABASE_URL="$DIRECT" npx prisma db push --skip-generate && exit 0
    echo "[db] schema sync attempt $i/5 failed; retrying in 15s"; sleep 15
  done
  echo "[db] schema sync gave up; the site keeps running without it"
) &

# WhatsApp bot: restarts itself forever, independent of the website.
(
  while true; do
    EMBEDDED_BOT=1 python3 whatsapp-bot/bot.py
    echo "[bot] exited, restarting in 10s"; sleep 10
  done
) &

# Website: restarts itself forever, independent of the bot.
(
  while true; do
    npx next start -p "${PORT:-3000}"
    echo "[site] exited, restarting in 5s"; sleep 5
  done
) &

trap 'kill 0' TERM INT
wait
