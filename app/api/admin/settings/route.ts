import { NextResponse } from 'next/server';
import { isAdmin } from '@/lib/auth';
import { getSettings, getRecipient } from '@/lib/settings';
import { cleanUrl, isEmail, normalizeCv, type Cv } from '@/lib/cv';
import { sendMail, mailConfigured } from '@/lib/mailer';
import { updateSiteSettings, type SiteSettings } from '@/lib/store';

export const runtime = 'nodejs';

export async function GET() {
  if (!(await isAdmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json({ ...(await getSettings()), smtpReady: mailConfigured() });
}

export async function PUT(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  const data: Partial<SiteSettings> = {};

  if ('contactEmail' in b) {
    const email = String(b.contactEmail ?? '').trim();
    if (email && !isEmail(email)) return NextResponse.json({ error: 'That email address does not look valid.' }, { status: 400 });
    data.contactEmail = email || null;
  }
  for (const key of ['etsyUrl', 'teachingUrl'] as const) {
    if (key in b) {
      const url = cleanUrl(b[key]);
      if (url === null) return NextResponse.json({ error: `Invalid link for ${key === 'etsyUrl' ? 'Etsy' : 'teaching app'}.` }, { status: 400 });
      data[key] = url || null;
    }
  }
  if ('cv' in b) data.cv = normalizeCv(b.cv) as Cv;

  await updateSiteSettings(data);
  return NextResponse.json({ ok: true, ...(await getSettings()) });
}

export async function POST() {
  if (!(await isAdmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const to = await getRecipient();
  if (!to) return NextResponse.json({ error: 'Save a contact email first.' }, { status: 400 });
  if (!mailConfigured()) return NextResponse.json({ error: 'SMTP is not set up on the server yet (SMTP_HOST, SMTP_USER, SMTP_PASS).' }, { status: 500 });
  try {
    await sendMail({ to, subject: 'AK Creations test email', text: 'It works! Contact-form messages will arrive at this address.' });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error('test email failed', e);
    return NextResponse.json({ error: `Could not send: ${e?.code || e?.message || 'unknown error'}` }, { status: 502 });
  }
}
