import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { requireUser, restrictedEmail, isUuid } from '@/lib/api-auth';

/**
 * GET /api/construction-logs?casa=&status=
 * Lista bitácoras de construcción, más recientes primero. Requiere sesión
 * (cookie web o Bearer de la app móvil).
 *
 * Autorización por rol — mismo patrón que /api/visits:
 *   - admin/operativo: ve todas.
 *   - user (contratista): solo las que él mismo abrió (opened_by = su email).
 */
export async function GET(request: Request) {
  const auth = await requireUser(request);
  if ('response' in auth) return auth.response;
  const restrictToEmail = restrictedEmail(auth.user);

  const url = new URL(request.url);
  const casa = url.searchParams.get('casa');
  const status = url.searchParams.get('status');

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
 * Body: { casa, contratista?, house_id?, id? }
 *
 * Si ya existe una bitácora "abierta" para esa casa, la reutiliza en vez de
 * crear una duplicada (una casa no debería tener 2 bitácoras abiertas a la
 * vez). Si la única que existe está "cerrada", crea una nueva.
 *
 * Para un contratista (rol 'user') esa reutilización solo mira las
 * bitácoras que él mismo abrió: nunca se le devuelve una ajena, a la que
 * después no podría entrar (ver checkLogAccess).
 *
 * `id` opcional (UUID generado por la app móvil): creación idempotente —
 * si ya existe una bitácora con ese id se devuelve esa (`existing: true`).
 */
export async function POST(request: Request) {
  try {
    const auth = await requireUser(request);
    if ('response' in auth) return auth.response;
    const { user } = auth;
    const mine = restrictedEmail(user);

    const body = await request.json();
    const casa = String(body.casa ?? '').trim();
    if (!casa) return NextResponse.json({ error: 'casa es requerida' }, { status: 400 });

    if (body.id !== undefined) {
      if (!isUuid(body.id)) return NextResponse.json({ error: 'id inválido' }, { status: 400 });
      const { data: byId } = await supabaseAdmin.from('construction_logs').select('*').eq('id', body.id).maybeSingle();
      if (byId) {
        if (mine && (byId.opened_by ?? '').toLowerCase() !== mine) {
          return NextResponse.json({ error: 'no autorizado' }, { status: 403 });
        }
        return NextResponse.json({ log: byId, reused: false, existing: true });
      }
    }

    // opened_by sale de la sesión; solo sin sesión (dev con DISABLE_AUTH) se acepta el body.
    const createdBy: string | null = user?.email ?? body.opened_by ?? null;

    let openQ = supabaseAdmin
      .from('construction_logs')
      .select('*')
      .eq('casa', casa)
      .eq('status', 'abierta');
    if (mine) openQ = openQ.eq('opened_by', mine);
    const { data: existing, error: findErr } = await openQ.order('opened_at', { ascending: false }).limit(1).maybeSingle();
    if (findErr) throw findErr;
    if (existing) return NextResponse.json({ log: existing, reused: true });

    const { data: created, error } = await supabaseAdmin
      .from('construction_logs')
      .insert({
        ...(isUuid(body.id) ? { id: body.id } : {}),
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
