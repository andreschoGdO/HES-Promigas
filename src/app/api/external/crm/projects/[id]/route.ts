import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

interface Ctx { params: Promise<{ id: string }>; }

function authorize(request: Request): { ok: true } | { ok: false; status: number; error: string } {
  const expected = process.env.CRM_API_KEY;
  if (!expected) return { ok: false, status: 401, error: 'CRM_API_KEY no configurada' };
  const provided = request.headers.get('x-api-key') ?? (request.headers.get('authorization')?.startsWith('Bearer ') ? request.headers.get('authorization')!.slice(7).trim() : '');
  if (!provided || provided !== expected) return { ok: false, status: 401, error: 'API key inválida' };
  return { ok: true };
}

/**
 * GET /api/external/crm/projects/[id]
 *   ?include_events=1
 *
 * Devuelve un proyecto completo (todas las columnas, incluido custom_data
 * con external_id/source). Si include_events=1, anexa los eventos de
 * historial del audit log + la visita previa, visita de instalación y la
 * reserva de inventario relacionadas (si existen).
 *
 * Útil para que la app externa de Operaciones consulte un proyecto
 * específico y sepa qué pasó con él.
 */
export async function GET(request: Request, context: Ctx) {
  const auth = authorize(request);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });

  const { id } = await context.params;
  const url = new URL(request.url);
  const includeEvents = url.searchParams.get('include_events') === '1';

  const { data: project, error } = await supabaseAdmin
    .from('crm_projects')
    .select(`
      *,
      visita_previa:field_visits!visita_previa_id(id, visit_type, casa, visit_date, status, completed_at),
      visita_instalacion:field_visits!visita_instalacion_id(id, visit_type, casa, visit_date, status, completed_at),
      reserva:inventory_reservations!reservation_id(id, title, status, confirmed_at, fulfilled_at, inventory_reservation_items(item_id, picked_at, inventory_items(id, serial_number, brand, model, status)))
    `)
    .eq('id', id)
    .single();
  if (error || !project) return NextResponse.json({ ok: false, error: 'proyecto no encontrado' }, { status: 404 });

  let events = null;
  if (includeEvents) {
    const { data } = await supabaseAdmin
      .from('crm_project_events')
      .select('event_type, from_module, to_module, from_stage, to_stage, actor_email, notes, data, created_at')
      .eq('project_id', id)
      .order('created_at', { ascending: false })
      .limit(100);
    events = data ?? [];
  }

  return NextResponse.json({ ok: true, project, ...(events !== null && { events }) });
}
