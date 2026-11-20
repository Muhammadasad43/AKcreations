import { PrismaClient } from '@prisma/client';

// Neon's pooled host needs pgbouncer mode, and a longer connect timeout so a
// sleeping (auto-suspended) database has time to wake up instead of failing.
function dbUrl() {
  const raw = process.env.DATABASE_URL;
  if (!raw) return undefined;
  try {
    const u = new URL(raw);
    const q = u.searchParams;
    if (!q.has('sslmode')) q.set('sslmode', 'require');
    if (!q.has('connect_timeout')) q.set('connect_timeout', '30');
    if (u.hostname.includes('-pooler') && !q.has('pgbouncer')) q.set('pgbouncer', 'true');
    if (!q.has('connection_limit')) q.set('connection_limit', '5');
    return u.toString();
  } catch {
    return raw;
  }
}

const g = globalThis as any;
export const prisma: PrismaClient =
  g.prisma || new PrismaClient({ datasources: { db: { url: dbUrl() } } });
if (process.env.NODE_ENV !== 'production') g.prisma = prisma;

/** Run a DB query; retry once (cold start), and fall back instead of crashing the page. */
export async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (attempt === 1) console.error('DB query failed:', (e as Error).message);
      else await new Promise((r) => setTimeout(r, 2000));
    }
  }
  return fallback;
}
