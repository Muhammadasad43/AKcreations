import { NextResponse } from 'next/server';
import { isAdmin } from '@/lib/auth';
import { createItem, deleteItem } from '@/lib/store';

export async function POST(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  if (!['quran', 'clothing', 'clay'].includes(b.category) || !String(b.title ?? '').trim()) {
    return NextResponse.json({ error: 'Invalid' }, { status: 400 });
  }
  const price = b.price === '' || b.price == null ? null : Number(b.price);
  if (price !== null && (!Number.isFinite(price) || price < 0)) {
    return NextResponse.json({ error: 'Invalid price' }, { status: 400 });
  }
  const item = await createItem({
    category: b.category,
    title: String(b.title).trim().slice(0, 200),
    description: String(b.description ?? '').slice(0, 3000),
    price,
    imageUrl: b.imageUrl ? String(b.imageUrl).slice(0, 2000) : null,
  });
  return NextResponse.json(item);
}

export async function DELETE(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const id = Number(new URL(req.url).searchParams.get('id'));
  if (!Number.isInteger(id) || id < 1) return NextResponse.json({ error: 'Invalid item id' }, { status: 400 });
  const deleted = await deleteItem(id);
  if (!deleted) return NextResponse.json({ error: 'Item not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
