import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

/**
 * GET /api/inventory/locations
 *   ?type=warehouse|workshop|vehicle|site|supplier_rma|in_transit|other
 *   ?include_inactive=1
 * Devuelve ubicaciones + conteo de items por cada una.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const type = url.searchParams.get('type');
  const includeInactive = url.searchParams.get('include_inactive') === '1';

  let q = supabaseAdmin
    .from('inventory_locations')
    .select('*')
    .order('type', { ascending: true })
    .order('name', { ascending: true });
  if (!includeInactive) q = q.eq('is_active', true);
  if (type) q = q.eq('type', type);

  const { data: locations, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Conteo de items por ubicación (single query agrupada)
  const { data: itemCounts } = await supabaseAdmin
    .from('inventory_items')
    .select('current_location_id');
  const counts = new Map<string, number>();
  for (const it of itemCounts ?? []) {
    if (it.current_location_id) counts.set(it.current_location_id, (counts.get(it.current_location_id) ?? 0) + 1);
  }
  const enriched = (locations ?? []).map((l) => ({ ...l, item_count: counts.get(l.id) ?? 0 }));

  return NextResponse.json({ locations: enriched });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (!body.code || !body.name || !body.type) {
      return NextResponse.json({ error: 'code, name, type son requeridos' }, { status: 400 });
    }
    const payload = {
      code: String(body.code).trim().toUpperCase().replace(/\s+/g, '_'),
      name: body.name,
      type: body.type,
      parent_id: body.parent_id ?? null,
      address: body.address ?? null,
      contact_email: body.contact_email ?? null,
      notes: body.notes ?? null,
      is_active: body.is_active ?? true,
    };
    const { data, error } = await supabaseAdmin.from('inventory_locations').insert(payload).select('*').single();
    if (error) throw error;
    return NextResponse.json({ location: data });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error';
    const status = msg.toLowerCase().includes('duplicate') ? 409 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    if (!body.id) return NextResponse.json({ error: 'id requerido' }, { status: 400 });
    const updates = { ...body };
    delete updates.id;
    if (updates.code) updates.code = String(updates.code).trim().toUpperCase().replace(/\s+/g, '_');
    const { data, error } = await supabaseAdmin.from('inventory_locations').update(updates).eq('id', body.id).select('*').single();
    if (error) throw error;
    return NextResponse.json({ location: data });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id requerido' }, { status: 400 });
  // En vez de DELETE físico (que rompería FK en items), soft-delete via is_active
  const { error } = await supabaseAdmin.from('inventory_locations').update({ is_active: false }).eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
