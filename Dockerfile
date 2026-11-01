FROM node:20-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-pip python3-venv openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Python deps for the WhatsApp bot (isolated venv)
COPY whatsapp-bot/requirements.txt whatsapp-bot/requirements.txt
RUN python3 -m venv /opt/venv && /opt/venv/bin/pip install --no-cache-dir -r whatsapp-bot/requirements.txt

# Node deps + build
COPY package*.json ./
RUN npm install
COPY . .
# If `next build` needs the database, uncomment so Render passes it at build time:
# ARG DATABASE_URL
RUN npm run build

ENV NODE_ENV=production PATH="/opt/venv/bin:$PATH"
RUN chmod +x start.sh
CMD ["./start.sh"]
