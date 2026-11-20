import { NextResponse } from 'next/server';
import { getRecipient } from '@/lib/settings';
import { sendMail, mailConfigured } from '@/lib/mailer';
import { isEmail } from '@/lib/cv';
import { createInquiry } from '@/lib/store';

export const runtime = 'nodejs'; // nodemailer needs Node APIs

export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}));
  const name = String(b.name ?? '').trim().slice(0, 100);
  const email = String(b.email ?? '').trim().slice(0, 200);
  const message = String(b.message ?? '').trim().slice(0, 3000);
  if (!name || !email || !message) return NextResponse.json({ error: 'Fill all fields' }, { status: 400 });
  if (!isEmail(email)) return NextResponse.json({ error: 'Enter a valid email' }, { status: 400 });

  // Keep the message in the Render instance's temporary data store.
  await createInquiry({ name, email, message });

  try {
    const to = await getRecipient();
    if (to && mailConfigured()) {
      await sendMail({
        to,
        replyTo: email,
        subject: `New message from ${name}`,
        text: `Name: ${name}\nEmail: ${email}\n\n${message}`,
      });
    }
  } catch (e) {
    console.error('contact email failed', e);
  }
  return NextResponse.json({ ok: true });
}
