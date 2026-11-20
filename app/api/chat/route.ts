import { NextResponse } from 'next/server';
import { listItems } from '@/lib/store';

const ENDPOINT = 'https://gen.pollinations.ai/v1/chat/completions';

const RULES: [RegExp, string][] = [
  [/quran|lesson|class|teach/i, 'Quran lessons are audio-only. See the Quran section for schedule and price, or leave a message below to book.'],
  [/cloth|dress|design|stitch|embroider/i, 'We take custom clothing commissions. Send the details through the contact form.'],
  [/clay|art|handmade/i, 'Our clay pieces are handmade. Browse the gallery or request a custom piece via the contact form.'],
  [/price|cost|pay/i, 'Prices are listed on each item. Custom work is quoted after you send a request.'],
  [/ship|deliver/i, 'Physical items are shipped after payment. Delivery time depends on your location.'],
];
const fallback = (text: string) => RULES.find(([rule]) => rule.test(text))?.[1] ?? 'Thanks! Please use the contact form and we will reply by email.';

const hits = new Map<string, number[]>();
function limited(ip: string) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((time) => now - time < 60_000);
  list.push(now);
  hits.set(ip, list);
  return list.length > 15;
}

async function catalog() {
  const items = await listItems();
  if (!items.length) return 'No items are published yet.';
  return items.slice(0, 30).map((item) => `- [${item.category}] ${item.title}${item.price != null ? ` (Rs ${item.price})` : ''}: ${item.description.slice(0, 160)}`).join('\n');
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  let msgs: { role: 'user' | 'assistant'; content: string }[] = Array.isArray(body.messages)
    ? body.messages
        .filter((message: any) => (message?.role === 'user' || message?.role === 'assistant') && typeof message.content === 'string' && message.content.trim())
        .map((message: any) => ({ role: message.role, content: message.content.slice(0, 1000) }))
    : [];
  if (!msgs.length && body.text) msgs = [{ role: 'user', content: String(body.text).slice(0, 1000) }];
  msgs = msgs.slice(-10);
  const last = msgs[msgs.length - 1];
  if (!last || last.role !== 'user') return NextResponse.json({ reply: 'Please type a question.' }, { status: 400 });

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'unknown';
  if (limited(ip)) return NextResponse.json({ reply: 'You are sending messages too fast. Please wait a moment.' }, { status: 429 });

  const key = process.env.POLLINATIONS_API_KEY;
  if (!key) return NextResponse.json({ reply: fallback(last.content) });

  const system = `You are the friendly assistant on the website of AK Creations, a small business offering Quran teaching (audio-only lessons), clothing design, and handmade clay art. Customers order or book by sending a message through the contact form; custom work is quoted after a request. Prices are in Pakistani Rupees (Rs). Answer briefly and politely in the customer's language. Only talk about AK Creations; when you don't know an exact detail, say so and point the visitor to the contact form.\n\nCurrently published items:\n${await catalog()}`;
  try {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: process.env.POLLINATIONS_MODEL || 'deepseek', messages: [{ role: 'system', content: system }, ...msgs], max_tokens: 400 }),
      signal: AbortSignal.timeout(25_000),
    });
    if (!response.ok) throw new Error(`Pollinations ${response.status}`);
    const data = await response.json();
    let reply: string = data?.choices?.[0]?.message?.content || '';
    reply = reply.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    if (!reply) throw new Error('Empty reply');
    return NextResponse.json({ reply });
  } catch (error) {
    console.error('chat error', error);
    return NextResponse.json({ reply: fallback(last.content) });
  }
}
