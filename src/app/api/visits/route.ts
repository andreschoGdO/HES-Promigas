import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { linkVisitToInventory } from '@/lib/inventory-visit-link';
import { requireUser, restrictedEmail, isUuid } from '@/lib/api-auth';

/**
 * GET /api/visits?type=&casa=&status=&from=&to=
 * Lista visitas con filtros opcionales. Requiere sesión (cookie web o
 * Bearer de la app móvil).
 *
 * Autorización por rol:
 *   - admin (gdo/promigas): ve todas las visitas, todos los filtros funcionan.
 *   - user  (contratista):  ve SOLO las visitas creadas por su propio email
 *                           (created_by = email del usuario logueado).
 *                           Los demás filtros se aplican sobre ese subconjunto.
 */
export async function GET(request: Request) {
  const auth = await requireUser(request);
  if ('response' in auth) return auth.response;
  const restrictToEmail = restrictedEmail(auth.user);

  const url = new URL(request.url);
  const type = url.searchParams.get('type');
  const casa = url.searchParams.get('casa');
  const status = url.searchParams.get('status');
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  const technician = url.searchParams.get('technician');
  const contratista = url.searchParams.get('contratista');
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 100), 500);

  let q = supabaseAdmin
    .from('field_visits')
    .select('id, visit_type, casa, house_id, technician_name, technician_email, contratista, visit_date, visit_time, status, notes, created_at, updated_at, completed_at, created_by')
    .order('visit_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit);
  if (type) q = q.eq('visit_type', type);
  if (casa) q = q.ilike('casa', `%${casa}%`);
  if (status) q = q.eq('status', status);
  if (from) q = q.gte('visit_date', from);
  if (to) q = q.lte('visit_date', to);
  if (technician) q = q.ilike('technician_name', `%${technician}%`);
  if (contratista) q = q.ilike('contratista', `%${contratista}%`);
  if (restrictToEmail) q = q.eq('created_by', restrictToEmail);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ visits: data });
}

/**
 * POST /api/visits
 * Crea una nueva visita (draft o completed).
 *
 * `id` opcional (UUID generado por la app móvil): hace la creación
 * idempotente — si ya existe una visita con ese id se devuelve esa misma
 * (`existing: true`) en vez de duplicarla, para que un reintento tras perder
 * la conexión sea seguro.
 */
export async function POST(request: Request) {
  try {
    const auth = await requireUser(request);
    if ('response' in auth) return auth.response;
    const { user } = auth;

    const body = await request.json();
    if (!body.visit_type || !['previa', 'instalacion', 'emergencia', 'normalizacion', 'om', 'abastecimiento', 'comisionamiento'].includes(body.visit_type)) {
      return NextResponse.json({ error: 'visit_type inválido' }, { status: 400 });
    }

    if (body.id !== undefined) {
      if (!isUuid(body.id)) return NextResponse.json({ error: 'id inválido' }, { status: 400 });
      const { data: existing } = await supabaseAdmin.from('field_visits').select('*').eq('id', body.id).maybeSingle();
      if (existing) {
        const mine = restrictedEmail(user);
        if (mine && (existing.created_by ?? '').toLowerCase() !== mine) {
          return NextResponse.json({ error: 'no autorizado' }, { status: 403 });
        }
        return NextResponse.json({ visit: existing, inventoryLink: null, existing: true });
      }
    }

    // created_by sale de la sesión para que un cliente no pueda manipularlo.
    // Solo sin sesión (entorno dev con DISABLE_AUTH) se acepta lo del body.
    const createdBy: string | null = user?.email ?? body.created_by ?? body.technician_email ?? null;

    const payload: Record<string, unknown> = {
      visit_type: body.visit_type,
      house_id: body.house_id ?? null,
      casa: body.casa ?? null,
      technician_name: body.technician_name ?? null,
      technician_email: body.technician_email ?? null,
      visit_date: body.visit_date ?? new Date().toISOString().slice(0, 10),
      visit_time: body.visit_time ?? null,
      status: body.status === 'completed' ? 'completed' : 'draft',
      form_data: body.form_data ?? {},
      lat: body.lat ?? null,
      lng: body.lng ?? null,
      notes: body.notes ?? null,
      created_by: createdBy,
      completed_at: body.status === 'completed' ? new Date().toISOString() : null,
    };
    if (isUuid(body.id)) payload.id = body.id;
    // contratista solo si fue enviado — la columna existe a partir de migración 34.
    // Si la migración no se aplicó todavía, omitir el campo evita romper el INSERT.
    if (body.contratista !== undefined) payload.contratista = body.contratista;

    let { data, error } = await supabaseAdmin.from('field_visits').insert(payload).select('*').single();
    // Fallback: si el error es por columna contratista inexistente, reintentar sin ella.
    if (error && /contratista/i.test(error.message ?? '')) {
      delete payload.contratista;
      ({ data, error } = await supabaseAdmin.from('field_visits').insert(payload).select('*').single());
    }
    if (error) throw error;

    let inventoryLink: { linked: string[]; skipped: string[] } | null = null;
    if (data.status === 'completed') {
      try {
        inventoryLink = await linkVisitToInventory({
          visitId: data.id,
          visitType: data.visit_type,
          formData: data.form_data,
          houseId: data.house_id,
          technicianEmail: data.technician_email,
        });
      } catch (e) {
        console.error('linkVisitToInventory failed:', e);
      }
    }

    return NextResponse.json({ visit: data, inventoryLink });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}
