import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

/**
 * GET /api/inventory/transfers[?status=draft|in_transit|received|cancelled]
 *
 * Lista transferencias formales con sus líneas (items + consumibles).
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const status = url.searchParams.get('status');

  let q = supabaseAdmin
    .from('inventory_transfers')
    .select(`
      *,
      from_warehouse:warehouses!from_warehouse_id(id, code, name),
      to_warehouse:warehouses!to_warehouse_id(id, code, name),
      inventory_transfer_items(id, picked, received, notes, inventory_items(id, serial_number, brand, model, status, inventory_categories(name, family))),
      inventory_transfer_consumables(id, quantity, received_quantity, notes, inventory_consumables(id, name, sku, unit, stock_quantity))
    `)
    .order('created_at', { ascending: false })
    .limit(200);
  if (status) q = q.eq('status', status);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ transfers: data });
}

/**
 * POST /api/inventory/transfers
 * Body: {
 *   from_warehouse_id: string;
 *   to_warehouse_id: string;
 *   item_ids?: string[];
 *   consumables?: Array<{ id: string; quantity: number }>;
 *   carrier?: string;
 *   tracking_number?: string;
 *   notes?: string;
 *   created_by?: string;
 * }
 * Crea la transferencia en status='draft'. Los items NO cambian de estado.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (!body.from_warehouse_id || !body.to_warehouse_id) {
      return NextResponse.json({ error: 'from_warehouse_id y to_warehouse_id requeridos' }, { status: 400 });
    }
    if (body.from_warehouse_id === body.to_warehouse_id) {
      return NextResponse.json({ error: 'Las bodegas origen y destino deben ser diferentes' }, { status: 400 });
    }

    const { data: transfer, error } = await supabaseAdmin
      .from('inventory_transfers')
      .insert({
        from_warehouse_id: body.from_warehouse_id,
        to_warehouse_id: body.to_warehouse_id,
        status: 'draft',
        carrier: body.carrier ?? null,
        tracking_number: body.tracking_number ?? null,
        notes: body.notes ?? null,
        created_by: body.created_by ?? null,
      })
      .select('*')
      .single();
    if (error) throw error;

    // Líneas
    const itemIds: string[] = Array.isArray(body.item_ids) ? body.item_ids : [];
    if (itemIds.length > 0) {
      await supabaseAdmin
        .from('inventory_transfer_items')
        .insert(itemIds.map((item_id: string) => ({ transfer_id: transfer.id, item_id })));
    }
    const consumables: Array<{ id: string; quantity: number }> = Array.isArray(body.consumables) ? body.consumables : [];
    if (consumables.length > 0) {
      await supabaseAdmin
        .from('inventory_transfer_consumables')
        .insert(consumables.map((c) => ({ transfer_id: transfer.id, consumable_id: c.id, quantity: c.quantity })));
    }

    return NextResponse.json({ transfer });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}
