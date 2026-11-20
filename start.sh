#!/bin/sh
# One container, one Render service: website (foreground) + WhatsApp bot (background).

# Prisma needs a DIRECT (non-pooler) URL for schema sync. If DIRECT_URL isn't set,
# derive it from DATABASE_URL by removing "-pooler" from the Neon host.
if [ -z "$DIRECT_URL" ]; then
  export DIRECT_URL="$(printf '%s' "$DATABASE_URL" | sed 's/-pooler//')"
fi

# Sync DB schema at boot. Retry a few times so a sleeping Neon database can wake up.
# Never blocks startup, but the failure is printed loudly.
ok=0
for i in 1 2 3 4 5; do
  if npx prisma db push --skip-generate; then ok=1; break; fi
  echo "!!! prisma db push failed (attempt $i/5), retrying in 5s"; sleep 5
done
[ "$ok" = 1 ] || echo "!!!!!! DATABASE UNREACHABLE: check DATABASE_URL / DIRECT_URL in Render and that the Neon project is active !!!!!!"

# Bot: restarts itself if it crashes, without touching the website.
(
  while true; do
    EMBEDDED_BOT=1 python3 whatsapp-bot/bot.py
    echo "bot exited, restarting in 10s"; sleep 10
  done
) &

# Website on Render's $PORT; this is the process Render health-checks.
exec npx next start -p "${PORT:-3000}"
