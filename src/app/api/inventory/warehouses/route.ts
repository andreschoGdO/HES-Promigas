import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

/**
 * GET /api/inventory/warehouses[?active=true]
 * Lista todas las bodegas con conteo de items y consumibles en cada una.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const activeOnly = url.searchParams.get('active') === 'true';

  let q = supabaseAdmin
    .from('warehouses')
    .select('*')
    .order('name', { ascending: true });
  if (activeOnly) q = q.eq('is_active', true);

  const { data: warehouses, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Conteo por bodega (en paralelo)
  const ids = (warehouses ?? []).map((w) => w.id);
  if (ids.length === 0) return NextResponse.json({ warehouses: [] });

  const [itemsRes, consRes] = await Promise.all([
    supabaseAdmin.from('inventory_items').select('warehouse_id, status').in('warehouse_id', ids),
    supabaseAdmin.from('inventory_consumables').select('warehouse_id, stock_quantity').in('warehouse_id', ids),
  ]);

  type ItemCount = { in_stock: number; reserved: number; installed: number; in_repair: number; decommissioned: number; total: number };
  const counts: Record<string, ItemCount> = {};
  for (const it of itemsRes.data ?? []) {
    if (!it.warehouse_id) continue;
    const c = counts[it.warehouse_id] ?? { in_stock: 0, reserved: 0, installed: 0, in_repair: 0, decommissioned: 0, total: 0 };
    c.total++;
    if (it.status in c) (c as Record<string, number>)[it.status]++;
    counts[it.warehouse_id] = c;
  }
  const consTotals: Record<string, number> = {};
  for (const c of consRes.data ?? []) {
    if (!c.warehouse_id) continue;
    consTotals[c.warehouse_id] = (consTotals[c.warehouse_id] ?? 0) + Number(c.stock_quantity ?? 0);
  }

  const enriched = (warehouses ?? []).map((w) => ({
    ...w,
    counts: counts[w.id] ?? { in_stock: 0, reserved: 0, installed: 0, in_repair: 0, decommissioned: 0, total: 0 },
    consumables_total: consTotals[w.id] ?? 0,
  }));
  return NextResponse.json({ warehouses: enriched });
}

/** POST — crear bodega. Body: { code, name, type, address?, city?, manager_email?, notes? } */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (!body.code || !body.name) return NextResponse.json({ error: 'code y name son requeridos' }, { status: 400 });
    const code = String(body.code).toUpperCase().replace(/[^A-Z0-9_]/g, '_');
    const { data, error } = await supabaseAdmin
      .from('warehouses')
      .insert({
        code,
        name: String(body.name).trim(),
        type: body.type ?? 'central',
        address: body.address ?? null,
        city: body.city ?? null,
        manager_email: body.manager_email ?? null,
        notes: body.notes ?? null,
        is_active: body.is_active ?? true,
      })
      .select('*')
      .single();
    if (error) throw error;
    return NextResponse.json({ warehouse: data });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error';
    const status = msg.toLowerCase().includes('duplicate') ? 409 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

/** PATCH — actualizar bodega. Body: { id, ...campos } */
export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    if (!body.id) return NextResponse.json({ error: 'id requerido' }, { status: 400 });
    const updates = { ...body };
    delete updates.id;
    delete updates.code; // code es inmutable (clave de negocio)
    const { data, error } = await supabaseAdmin
      .from('warehouses').update(updates).eq('id', body.id).select('*').single();
    if (error) throw error;
    return NextResponse.json({ warehouse: data });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}

/** DELETE — solo permitido si la bodega no tiene items vinculados */
export async function DELETE(request: Request) {
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id requerido' }, { status: 400 });

  const [{ count: itemCount }, { count: consCount }] = await Promise.all([
    supabaseAdmin.from('inventory_items').select('id', { count: 'exact', head: true }).eq('warehouse_id', id),
    supabaseAdmin.from('inventory_consumables').select('id', { count: 'exact', head: true }).eq('warehouse_id', id),
  ]);
  if ((itemCount ?? 0) > 0 || (consCount ?? 0) > 0) {
    return NextResponse.json({ error: `Bodega tiene ${itemCount ?? 0} items y ${consCount ?? 0} consumibles vinculados. Transfiérelos primero.` }, { status: 400 });
  }
  const { error } = await supabaseAdmin.from('warehouses').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
