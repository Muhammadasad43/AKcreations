"""
Standalone 24/7 WhatsApp bot worker for AK Creations.
Deployed as its OWN Render service (see render.yaml in the repo root) so it
runs independently of the main website and keeps going even if the site
restarts or redeploys. UptimeRobot pings its health endpoint to keep the
free Render instance from spinning down.
"""
import multiprocessing
import os
import re
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

import requests
from whagent import Agent

# ---------- Config (Render environment variables) ----------
# WhatsApp agent keys: WA_AGENT_TOKEN, WA_AGENT_TOKEN_2, WA_AGENT_TOKEN_3 ...
# (or several keys in one variable, separated by commas)
GROQ_KEY = os.environ.get("GROQ_API_KEY", "").strip()
CEREBRAS_KEY = os.environ.get("CEREBRAS_API_KEY", "").strip()
POLL_KEY = os.environ.get("POLLINATIONS_API_KEY", "").strip()

# Model names change often on free tiers, so they can be overridden without editing code.
GROQ_MODEL = os.environ.get("GROQ_MODEL", "openai/gpt-oss-120b")
CEREBRAS_MODEL = os.environ.get("CEREBRAS_MODEL", "gpt-oss-120b")
CEREBRAS_MODEL_2 = os.environ.get("CEREBRAS_MODEL_2", "zai-glm-4.7")

SYSTEM = (
    "You are a helpful ChatGPT-style assistant chatting on WhatsApp. "
    "Be clear and concise. Use WhatsApp formatting only: *bold*, _italic_, and '- ' lists. "
    "No markdown headers or tables."
)

MAX_AGENTS = 5        # Meta allows up to 5 agents per account
MAX_MESSAGES = 30     # recent messages remembered per agent (memory only)
MAX_CHARS = 12000     # keeps prompts small enough for free-tier context limits

# Tried in order; if one fails, is rate limited or out of credits, the next is used.
PROVIDERS = []
if GROQ_KEY:
    PROVIDERS.append(("https://api.groq.com/openai/v1/chat/completions", GROQ_KEY, GROQ_MODEL))
if CEREBRAS_KEY:
    PROVIDERS.append(("https://api.cerebras.ai/v1/chat/completions", CEREBRAS_KEY, CEREBRAS_MODEL))
    if CEREBRAS_MODEL_2:
        PROVIDERS.append(("https://api.cerebras.ai/v1/chat/completions", CEREBRAS_KEY, CEREBRAS_MODEL_2))
PROVIDERS.append(("https://gen.pollinations.ai/v1/chat/completions", POLL_KEY, "openai"))


def ask_llm(messages):
    last_err = None
    for url, key, model in PROVIDERS:
        try:
            headers = {"Content-Type": "application/json"}
            if key:
                headers["Authorization"] = f"Bearer {key}"
            r = requests.post(url, headers=headers, timeout=60,
                              json={"model": model, "messages": messages})
            r.raise_for_status()
            text = (r.json()["choices"][0]["message"]["content"] or "").strip()
            # Pollinations sometimes returns a credits error as normal text
            if text and "enough credits" not in text.lower():
                return text
            last_err = f"{model}: empty reply or credits error"
        except Exception as e:  # noqa: BLE001
            last_err = f"{model}: {e}"
            print(f"provider failed -> {last_err}", flush=True)
    raise RuntimeError(last_err)


def to_whatsapp(text):
    text = re.sub(r"\*\*(.+?)\*\*", r"*\1*", text)                 # **bold** -> *bold*
    text = re.sub(r"^#{1,6}\s*(.+)$", r"*\1*", text, flags=re.M)   # headers -> bold
    return text


def chunks(text, size=3800):
    return [text[i:i + size] for i in range(0, len(text), size)] or [""]


def trim(history):
    kept, total = [], 0
    for m in reversed(history):
        total += len(m["content"])
        if total > MAX_CHARS and kept:
            break
        kept.append(m)
    kept.reverse()
    kept = kept[-MAX_MESSAGES:]
    while kept and kept[0]["role"] != "user":
        kept.pop(0)
    return kept


def collect_tokens():
    tokens = []
    for name, val in sorted(os.environ.items()):
        if name.startswith("WA_AGENT_TOKEN"):
            for t in val.split(","):
                t = t.strip()
                if t and t not in tokens:
                    tokens.append(t)
    return tokens[:MAX_AGENTS]


def is_auth_error(err):
    text = str(err).lower()
    return any(s in text for s in ("authorization", "bearer token", "http=401", "http=403", "invalid or missing"))


def run_forever(agent, label):
    """Keep one agent polling forever. Errors are logged as ONE short line (no traceback spam)
    and retried with backoff; a rejected token is retried only every 10 minutes."""
    delay = 5
    while True:
        started = time.time()
        try:
            agent.run()
            err = "polling stopped"
        except Exception as e:  # noqa: BLE001
            err = e
        if time.time() - started > 120:
            delay = 5  # it ran fine for a while, so start the backoff over
        if is_auth_error(err):
            wait = 600
            print(f"[{label}] WhatsApp token rejected ({str(err)[:90]}). "
                  f"Check WA_AGENT_TOKEN in Render. Retrying in {wait // 60} min.", flush=True)
        else:
            wait = delay
            delay = min(delay * 2, 300)
            print(f"[{label}] error: {str(err)[:150]}. Retrying in {wait}s.", flush=True)
        time.sleep(wait)


def run_agent(token, label):
    """One WhatsApp agent = one process = one long-poll loop (Meta allows one poller per key)."""
    history = []
    agent = Agent(token)

    @agent.on_text
    def handle(ctx):
        try:
            _handle(ctx)
        except Exception as e:  # noqa: BLE001  # one bad message must never stop the bot
            print(f"[{label}] message error: {str(e)[:150]}", flush=True)

    def _handle(ctx):
        nonlocal history
        msg = (ctx.text or "").strip()
        if not msg:
            return
        if msg.lower() in ("/new", "/reset"):
            history = []
            ctx.reply("Fresh chat started.")
            return

        history.append({"role": "user", "content": msg})
        history = trim(history)
        try:
            answer = to_whatsapp(ask_llm([{"role": "system", "content": SYSTEM}] + history))
        except Exception:  # noqa: BLE001
            history.pop()
            ctx.reply("The AI providers are busy right now. Please try again in a minute.")
            return

        history.append({"role": "assistant", "content": answer})
        for part in chunks(answer):
            ctx.reply(part)

    print(f"[{label}] started", flush=True)
    run_forever(agent, label)


def supervise(tokens):
    mp = multiprocessing.get_context("spawn")
    procs = {}

    def start(i):
        p = mp.Process(target=run_agent, args=(tokens[i], f"agent{i + 1}"), daemon=True)
        p.start()
        procs[i] = p

    for i in range(len(tokens)):
        start(i)
    while True:
        time.sleep(30)
        for i, p in list(procs.items()):
            try:
                if not p.is_alive():
                    print(f"[agent{i + 1}] stopped (exit {p.exitcode}); restarting", flush=True)
                    start(i)
            except Exception as e:  # noqa: BLE001
                print(f"[agent{i + 1}] supervisor error: {str(e)[:150]}", flush=True)


# ---------- Tiny web endpoint so Render sees a web service, and UptimeRobot has something to ping ----------
class Ping(BaseHTTPRequestHandler):
    def _ok(self):
        self.send_response(200)
        self.end_headers()

    def do_GET(self):
        self._ok()
        self.wfile.write(b"ok")

    def do_HEAD(self):
        self._ok()

    def log_message(self, *args):
        pass


def serve_health():
    HTTPServer(("0.0.0.0", int(os.environ.get("PORT", 10000))), Ping).serve_forever()


if __name__ == "__main__":
    tokens = collect_tokens()
    while not tokens:
        # Never exit: the website must keep running. Re-check for a token every 5 minutes.
        print("[bot] No WA_AGENT_TOKEN set. Add one in Render (Environment). Waiting...", flush=True)
        time.sleep(300)
        tokens = collect_tokens()
    print(f"Starting {len(tokens)} agent(s); providers: {[p[2] for p in PROVIDERS]}", flush=True)
    if os.environ.get("EMBEDDED_BOT") == "1":
        # Running inside the website's container: the site already answers on PORT,
        # so don't open a second HTTP server. Just supervise the agents.
        supervise(tokens)
    else:
        threading.Thread(target=supervise, args=(tokens,), daemon=True).start()
        serve_health()
