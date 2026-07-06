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
 *
 * Crea la transferencia en status='reserved' y aparta los items (in_stock → reserved).
 * Antes creaba en 'draft' sin tocar items; ahora la reserva es inmediata para evitar
 * doble picking del mismo equipo.
 *
 * Si algún item ya está reserved/installed/etc., se rechaza la operación completa
 * (todo o nada).
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

    const itemIds: string[] = Array.isArray(body.item_ids) ? body.item_ids : [];
    const consumables: Array<{ id: string; quantity: number }> = Array.isArray(body.consumables) ? body.consumables : [];

    // ─── Validación previa: todos los items deben estar in_stock en la bodega origen ───
    if (itemIds.length > 0) {
      const { data: itemsCheck } = await supabaseAdmin
        .from('inventory_items')
        .select('id, serial_number, status, warehouse_id')
        .in('id', itemIds);
      const conflicts: string[] = [];
      for (const it of itemsCheck ?? []) {
        if (it.status !== 'in_stock') conflicts.push(`${it.serial_number}: status ${it.status}`);
        else if (it.warehouse_id !== body.from_warehouse_id) conflicts.push(`${it.serial_number}: no está en la bodega origen`);
      }
      if (conflicts.length > 0) {
        return NextResponse.json({
          error: 'No se puede crear la transferencia — items no disponibles',
          conflicts,
        }, { status: 409 });
      }
    }

    // ─── Crear la transferencia en reserved ───
    const now = new Date().toISOString();
    const { data: transfer, error } = await supabaseAdmin
      .from('inventory_transfers')
      .insert({
        from_warehouse_id: body.from_warehouse_id,
        to_warehouse_id: body.to_warehouse_id,
        status: 'reserved',
        reserved_at: now,
        reserved_by: body.created_by ?? null,
        carrier: body.carrier ?? null,
        tracking_number: body.tracking_number ?? null,
        notes: body.notes ?? null,
        created_by: body.created_by ?? null,
      })
      .select('*')
      .single();
    if (error) throw error;

    // ─── Insertar líneas de items + consumibles ───
    if (itemIds.length > 0) {
      await supabaseAdmin
        .from('inventory_transfer_items')
        .insert(itemIds.map((item_id: string) => ({ transfer_id: transfer.id, item_id })));

      // Cambiar items a reserved
      await supabaseAdmin
        .from('inventory_items')
        .update({ status: 'reserved' })
        .in('id', itemIds);

      // Registrar movimientos (uno por item)
      await supabaseAdmin.from('inventory_movements').insert(
        itemIds.map((itemId) => ({
          item_id: itemId,
          type: 'reserve',
          from_status: 'in_stock',
          to_status: 'reserved',
          responsible_email: body.created_by ?? null,
          notes: `Transferencia ${transfer.code ?? transfer.id.slice(0, 8)}: apartado en origen`,
        })),
      );
    }
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
