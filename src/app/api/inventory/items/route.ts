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
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 500), 2000);

  let query = supabaseAdmin
    .from('inventory_items')
    .select('*, inventory_categories(code, name, family), client_houses(casa)')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (status) query = query.eq('status', status);
  if (category) query = query.eq('category_id', category);
  if (house) query = query.eq('current_house_id', house);
  if (serial) query = query.eq('serial_number', serial);
  if (q) query = query.or(`serial_number.ilike.%${q}%,brand.ilike.%${q}%,model.ilike.%${q}%,supplier.ilike.%${q}%`);

  const { data, error } = await query;
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
