import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const lowStock = url.searchParams.get('low_stock') === '1';
  const { data, error } = await supabaseAdmin
    .from('inventory_consumables')
    .select('*, inventory_categories(family, name)')
    .order('name', { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  // Filtro low_stock se aplica en JS: PostgREST.lte solo admite valores literales, no nombres de columna
  const out = lowStock ? (data ?? []).filter((c) => Number(c.stock_quantity ?? 0) <= Number(c.min_threshold ?? 0)) : data;
  return NextResponse.json({ consumables: out });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (!body.name) return NextResponse.json({ error: 'name requerido' }, { status: 400 });
    const payload = {
      category_id: body.category_id ?? null,
      name: body.name,
      sku: body.sku ?? null,
      description: body.description ?? null,
      unit: body.unit ?? 'ud',
      stock_quantity: body.stock_quantity ?? 0,
      min_threshold: body.min_threshold ?? 0,
      supplier: body.supplier ?? null,
      cost_per_unit_cop: body.cost_per_unit_cop ?? null,
      location: body.location ?? null,
      notes: body.notes ?? null,
    };
    const { data, error } = await supabaseAdmin.from('inventory_consumables').insert(payload).select('*').single();
    if (error) throw error;
    return NextResponse.json({ consumable: data });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}

/**
 * PATCH /api/inventory/consumables
 * Body: { id, ... } o { id, adjust_quantity: number, notes, responsible_email }
 */
export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    if (!body.id) return NextResponse.json({ error: 'id requerido' }, { status: 400 });

    const { data: current } = await supabaseAdmin.from('inventory_consumables').select('*').eq('id', body.id).single();
    if (!current) return NextResponse.json({ error: 'No encontrado' }, { status: 404 });

    // Ajuste de cantidad (entrada/salida)
    if (typeof body.adjust_quantity === 'number' && body.adjust_quantity !== 0) {
      const newQty = (current.stock_quantity ?? 0) + body.adjust_quantity;
      if (newQty < 0) return NextResponse.json({ error: 'Stock no puede ser negativo' }, { status: 400 });
      const { data, error } = await supabaseAdmin.from('inventory_consumables').update({ stock_quantity: newQty }).eq('id', body.id).select('*').single();
      if (error) throw error;
      await supabaseAdmin.from('inventory_movements').insert({
        consumable_id: body.id,
        type: 'adjust_quantity',
        quantity: body.adjust_quantity,
        responsible_email: body.responsible_email ?? null,
        notes: body.notes ?? `Ajuste ${body.adjust_quantity > 0 ? '+' : ''}${body.adjust_quantity}`,
      });
      return NextResponse.json({ consumable: data });
    }

    // Update de campos genéricos
    const updates = { ...body };
    delete updates.id;
    delete updates.adjust_quantity;
    delete updates.responsible_email;
    delete updates.notes;
    const { data, error } = await supabaseAdmin.from('inventory_consumables').update(updates).eq('id', body.id).select('*').single();
    if (error) throw error;
    return NextResponse.json({ consumable: data });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id requerido' }, { status: 400 });
  const { error } = await supabaseAdmin.from('inventory_consumables').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
