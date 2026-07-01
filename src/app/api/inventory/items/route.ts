import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

/**
 * GET /api/inventory/items?status=&category=&house=&serial=&q=
 * Lista equipos serializados con filtros.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const status = url.searchParams.get('status');
  const category = url.searchParams.get('category');
  const house = url.searchParams.get('house');
  const serial = url.searchParams.get('serial');
  const q = url.searchParams.get('q');
  const warehouse = url.searchParams.get('warehouse');
  const warranty = url.searchParams.get('warranty'); // 'active' | 'expiring' | 'expired'
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 500), 2000);

  // Intentar con warehouses join (requiere migration 27). Si falla, fallback.
  const SELECT_WITH_WH = '*, inventory_categories(code, name, family), client_houses(casa), inventory_reservation_items(inventory_reservations(id, title, status)), warehouses(id, code, name)';
  const SELECT_LEGACY  = '*, inventory_categories(code, name, family), client_houses(casa), inventory_reservation_items(inventory_reservations(id, title, status))';

  const today = new Date().toISOString().slice(0, 10);
  const in30d = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);

  const buildQuery = (selectStr: string) => {
    let q2 = supabaseAdmin
      .from('inventory_items').select(selectStr)
      .order('created_at', { ascending: false }).limit(limit);
    if (status) q2 = q2.eq('status', status);
    if (category) q2 = q2.eq('category_id', category);
    if (house) q2 = q2.eq('current_house_id', house);
    if (warehouse) q2 = q2.eq('warehouse_id', warehouse);
    if (serial) q2 = q2.eq('serial_number', serial);
    if (warranty === 'expired')  q2 = q2.lt('warranty_expires_at', today);
    if (warranty === 'expiring') q2 = q2.gte('warranty_expires_at', today).lte('warranty_expires_at', in30d);
    if (warranty === 'active')   q2 = q2.gt('warranty_expires_at', in30d);
    if (q) q2 = q2.or(`serial_number.ilike.%${q}%,brand.ilike.%${q}%,model.ilike.%${q}%,supplier.ilike.%${q}%`);
    return q2;
  };

  let { data, error } = await buildQuery(SELECT_WITH_WH);
  if (error && /warehouses|schema cache/i.test(error.message)) {
    const fb = await buildQuery(SELECT_LEGACY);
    data = fb.data; error = fb.error;
  }
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ items: data });
}

/**
 * POST /api/inventory/items
 * Crea un nuevo equipo (recepción individual).
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (!body.serial_number) return NextResponse.json({ error: 'serial_number requerido' }, { status: 400 });

    // Si la categoría se da por code, resolverla
    let categoryId = body.category_id ?? null;
    if (!categoryId && body.category_code) {
      const { data: cat } = await supabaseAdmin.from('inventory_categories').select('*').eq('code', body.category_code).single();
      if (cat) categoryId = cat.id;
    }

    // Calcular warranty_expires_at si tenemos acquired_at + warranty_months
    let warrantyExpires = body.warranty_expires_at ?? null;
    if (!warrantyExpires && body.acquired_at && body.warranty_months) {
      const d = new Date(body.acquired_at);
      d.setMonth(d.getMonth() + Number(body.warranty_months));
      warrantyExpires = d.toISOString().slice(0, 10);
    }

    const payload = {
      category_id: categoryId,
      serial_number: String(body.serial_number).trim(),
      brand: body.brand ?? null,
      model: body.model ?? null,
      capacity_value: body.capacity_value ?? null,
      capacity_unit: body.capacity_unit ?? null,
      status: body.status ?? 'in_stock',
      current_location: body.current_location ?? 'warehouse',
      acquired_at: body.acquired_at ?? null,
      acquired_cost_cop: body.acquired_cost_cop ?? null,
      supplier: body.supplier ?? null,
      invoice_number: body.invoice_number ?? null,
      warranty_months: body.warranty_months ?? null,
      warranty_expires_at: warrantyExpires,
      qr_payload: body.qr_payload ?? null,
      notes: body.notes ?? null,
      created_by: body.created_by ?? null,
    };

    const { data, error } = await supabaseAdmin.from('inventory_items').insert(payload).select('*').single();
    if (error) throw error;

    // Registrar movimiento de recepción
    await supabaseAdmin.from('inventory_movements').insert({
      item_id: data.id,
      type: 'receive',
      to_status: data.status,
      to_location: data.current_location,
      responsible_email: body.created_by ?? null,
      notes: 'Recepción inicial',
    });

    return NextResponse.json({ item: data });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error';
    const status = msg.toLowerCase().includes('duplicate') || msg.toLowerCase().includes('unique') ? 409 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
