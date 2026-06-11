import { NextResponse } from 'next/server';
import { createSupabaseServer } from '@/lib/supabase-server';
import { getRoleFromEmail } from '@/lib/user-role';
import { listAllowlist, setEnabled, addToAllowlist, removeFromAllowlist } from '@/lib/user-allowlist';

/**
 * CRUD de user_allowlist. Solo admins (gdo/promigas) pueden tocar esto.
 *
 *   GET   /api/users/allowlist            → listar
 *   POST  /api/users/allowlist            → { email, enabled?, note? }  agregar / habilitar
 *   PATCH /api/users/allowlist            → { email, enabled }          actualizar enabled
 *   DELETE /api/users/allowlist?email=... → quitar
 */

async function requireAdmin(): Promise<{ email: string } | NextResponse> {
  try {
    const supa = await createSupabaseServer();
    const { data } = await supa.auth.getUser();
    const email = data.user?.email ?? null;
    if (!email) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    if (getRoleFromEmail(email) !== 'admin') {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }
    return { email };
  } catch {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
}

export async function GET() {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;
  const rows = await listAllowlist();
  return NextResponse.json({ items: rows });
}

export async function POST(request: Request) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;
  try {
    const body = await request.json();
    if (!body.email || typeof body.email !== 'string') {
      return NextResponse.json({ error: 'email requerido' }, { status: 400 });
    }
    const row = await addToAllowlist(body.email, body.enabled ?? true, auth.email, body.note ?? null);
    return NextResponse.json({ item: row });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;
  try {
    const body = await request.json();
    if (!body.email || typeof body.enabled !== 'boolean') {
      return NextResponse.json({ error: 'email y enabled requeridos' }, { status: 400 });
    }
    const row = await setEnabled(body.email, body.enabled, auth.email);
    if (!row) return NextResponse.json({ error: 'no encontrado' }, { status: 404 });
    return NextResponse.json({ item: row });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;
  const url = new URL(request.url);
  const email = url.searchParams.get('email');
  if (!email) return NextResponse.json({ error: 'email requerido' }, { status: 400 });
  await removeFromAllowlist(email);
  return NextResponse.json({ success: true });
}
