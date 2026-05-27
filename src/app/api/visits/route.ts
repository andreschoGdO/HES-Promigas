import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { linkVisitToInventory } from '@/lib/inventory-visit-link';

/**
 * GET /api/visits?type=&casa=&status=&from=&to=
 * Lista visitas con filtros opcionales.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const type = url.searchParams.get('type');
  const casa = url.searchParams.get('casa');
  const status = url.searchParams.get('status');
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 100), 500);

  let q = supabaseAdmin
    .from('field_visits')
    .select('id, visit_type, casa, house_id, technician_name, technician_email, visit_date, visit_time, status, notes, created_at, updated_at, completed_at')
    .order('visit_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit);
  if (type) q = q.eq('visit_type', type);
  if (casa) q = q.eq('casa', casa);
  if (status) q = q.eq('status', status);
  if (from) q = q.gte('visit_date', from);
  if (to) q = q.lte('visit_date', to);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ visits: data });
}

/**
 * POST /api/visits
 * Crea una nueva visita (draft o completed).
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (!body.visit_type || !['previa', 'instalacion', 'emergencia', 'normalizacion'].includes(body.visit_type)) {
      return NextResponse.json({ error: 'visit_type inválido' }, { status: 400 });
    }
    const payload = {
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
      created_by: body.created_by ?? body.technician_email ?? null,
      completed_at: body.status === 'completed' ? new Date().toISOString() : null,
    };
    const { data, error } = await supabaseAdmin.from('field_visits').insert(payload).select('*').single();
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
