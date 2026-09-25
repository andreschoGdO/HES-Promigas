import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { createSupabaseServer } from '@/lib/supabase-server';
import { getRoleFromEmail } from '@/lib/user-role';

/**
 * GET /api/construction-logs?casa=&status=
 * Lista bitácoras de construcción, más recientes primero.
 *
 * Autorización por rol — mismo patrón que /api/visits:
 *   - admin/operativo: ve todas.
 *   - user (contratista): solo las que él mismo abrió (opened_by = su email).
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const casa = url.searchParams.get('casa');
  const status = url.searchParams.get('status');

  let restrictToEmail: string | null = null;
  try {
    const supa = await createSupabaseServer();
    const { data } = await supa.auth.getUser();
    const email = data.user?.email ?? null;
    if (email && getRoleFromEmail(email) === 'user') restrictToEmail = email.toLowerCase();
  } catch {
    // Sin sesión disponible: el middleware ya bloqueó el acceso sin login.
  }

  let q = supabaseAdmin
    .from('construction_logs')
    .select('id, house_id, casa, contratista, status, opened_by, opened_at, closed_by, closed_at, created_at')
    .order('opened_at', { ascending: false });
  if (casa) q = q.ilike('casa', `%${casa}%`);
  if (status) q = q.eq('status', status);
  if (restrictToEmail) q = q.eq('opened_by', restrictToEmail);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ logs: data });
}

/**
 * POST /api/construction-logs
 * Body: { casa, contratista?, house_id? }
 *
 * Si ya existe una bitácora "abierta" para esa casa, la reutiliza en vez de
 * crear una duplicada (una casa no debería tener 2 bitácoras abiertas a la
 * vez). Si la única que existe está "cerrada", crea una nueva.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const casa = String(body.casa ?? '').trim();
    if (!casa) return NextResponse.json({ error: 'casa es requerida' }, { status: 400 });

    let createdBy: string | null = null;
    try {
      const supa = await createSupabaseServer();
      const { data } = await supa.auth.getUser();
      createdBy = data.user?.email?.toLowerCase() ?? null;
    } catch { /* sin sesión disponible */ }
    if (!createdBy) createdBy = body.opened_by ?? null;

    const { data: existing, error: findErr } = await supabaseAdmin
      .from('construction_logs')
      .select('*')
      .eq('casa', casa)
      .eq('status', 'abierta')
      .maybeSingle();
    if (findErr) throw findErr;
    if (existing) return NextResponse.json({ log: existing, reused: true });

    const { data: created, error } = await supabaseAdmin
      .from('construction_logs')
      .insert({
        casa,
        house_id: body.house_id ?? null,
        contratista: body.contratista ?? null,
        status: 'abierta',
        opened_by: createdBy,
      })
      .select('*')
      .single();
    if (error) throw error;
    return NextResponse.json({ log: created, reused: false });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}
