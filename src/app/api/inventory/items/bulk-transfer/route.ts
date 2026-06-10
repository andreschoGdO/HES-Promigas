import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

/**
 * POST /api/inventory/items/bulk-transfer
 *
 * Mueve N items serializados + M consumibles entre bodegas en una sola
 * operación. Genera movimientos transfer_out (en la origen) y transfer_in
 * (en la destino) por cada línea para mantener trazabilidad.
 *
 * Reglas:
 *   - Solo se permiten items en status='in_stock' (no se transfieren reservados
 *     ni instalados sin pasar por uninstall primero).
 *   - Para consumibles: debe haber stock_quantity >= quantity en la bodega
 *     origen (de hecho la bodega origen comparte el stock; cuando un
 *     consumible está vinculado a una bodega específica, el stock pertenece
 *     a esa instancia del consumible).
 *
 * Body:
 *   {
 *     to_warehouse_id: string;
 *     item_ids?: string[];                         // serializados
 *     consumables?: Array<{ id: string; quantity: number }>;
 *     reason?: string;                              // queda en movements.notes
 *     actor_email?: string;
 *   }
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const toId = String(body.to_warehouse_id ?? '').trim();
    if (!toId) return NextResponse.json({ error: 'to_warehouse_id requerido' }, { status: 400 });

    const itemIds: string[] = Array.isArray(body.item_ids) ? body.item_ids.filter((x: unknown) => typeof x === 'string') : [];
    const consumables: Array<{ id: string; quantity: number }> = Array.isArray(body.consumables)
      ? body.consumables.filter((c: { id?: string; quantity?: number }) => c.id && typeof c.quantity === 'number' && c.quantity > 0)
      : [];

    if (itemIds.length === 0 && consumables.length === 0) {
      return NextResponse.json({ error: 'Selecciona al menos un item o consumible para transferir' }, { status: 400 });
    }

    const reason = String(body.reason ?? '').trim();
    const actor = body.actor_email ?? null;

    // Validar bodega destino
    const { data: toWh } = await supabaseAdmin
      .from('warehouses').select('id, code, name, is_active').eq('id', toId).maybeSingle();
    if (!toWh) return NextResponse.json({ error: 'Bodega destino no encontrada' }, { status: 404 });
    if (!toWh.is_active) return NextResponse.json({ error: 'Bodega destino está inactiva' }, { status: 400 });

    const result = { items_moved: 0, items_skipped: [] as string[], consumables_moved: 0, consumables_errors: [] as string[] };

    // ─── Items serializados ───
    if (itemIds.length > 0) {
      const { data: items } = await supabaseAdmin
        .from('inventory_items')
        .select('id, serial_number, status, warehouse_id')
        .in('id', itemIds);
      const list = items ?? [];

      // Validar que todos estén in_stock
      for (const it of list) {
        if (it.status !== 'in_stock') {
          result.items_skipped.push(`${it.serial_number}: en estado ${it.status} (solo se transfieren in_stock)`);
        }
      }
      const validIds = list.filter((it) => it.status === 'in_stock').map((it) => it.id);

      if (validIds.length > 0) {
        const { data: updated, error: updErr } = await supabaseAdmin
          .from('inventory_items')
          .update({ warehouse_id: toId, current_location: 'warehouse' })
          .in('id', validIds)
          .eq('status', 'in_stock')
          .select('id, warehouse_id');
        if (updErr) throw updErr;
        result.items_moved = updated?.length ?? 0;

        // Movimientos: transfer_out + transfer_in usando el warehouse_id previo de cada item
        const movRows: Array<Record<string, unknown>> = [];
        for (const it of list.filter((x) => validIds.includes(x.id))) {
          movRows.push({
            item_id: it.id, type: 'transfer_out',
            from_status: 'in_stock', to_status: 'in_stock',
            from_warehouse_id: it.warehouse_id, to_warehouse_id: toId,
            responsible_email: actor,
            notes: `Transferencia masiva → ${toWh.name}. ${reason}`,
          });
          movRows.push({
            item_id: it.id, type: 'transfer_in',
            from_status: 'in_stock', to_status: 'in_stock',
            from_warehouse_id: it.warehouse_id, to_warehouse_id: toId,
            responsible_email: actor,
            notes: `Recibido de transferencia. ${reason}`,
          });
        }
        if (movRows.length > 0) await supabaseAdmin.from('inventory_movements').insert(movRows);
      }
    }

    // ─── Consumibles ───
    if (consumables.length > 0) {
      for (const c of consumables) {
        const { data: existing } = await supabaseAdmin
          .from('inventory_consumables')
          .select('id, name, stock_quantity, warehouse_id')
          .eq('id', c.id)
          .maybeSingle();
        if (!existing) {
          result.consumables_errors.push(`Consumible ${c.id}: no encontrado`);
          continue;
        }
        if (Number(existing.stock_quantity) < c.quantity) {
          result.consumables_errors.push(`${existing.name}: necesitas ${c.quantity}, hay ${existing.stock_quantity}`);
          continue;
        }
        // Aquí asumimos que el consumible ENTERO se mueve, o que sólo hay un
        // registro de consumible por SKU global. La operación: descontar de
        // este registro la cantidad transferida; el resto queda en la bodega
        // origen. La cantidad transferida queda registrada en movements; el
        // stock destino se gestiona como ajustes futuros (modelo simple sin
        // duplicar registros por bodega).
        const newQty = Number(existing.stock_quantity) - c.quantity;
        await supabaseAdmin.from('inventory_consumables').update({ stock_quantity: newQty }).eq('id', c.id);

        await supabaseAdmin.from('inventory_movements').insert([
          {
            consumable_id: c.id, type: 'transfer_out', quantity: c.quantity,
            from_warehouse_id: existing.warehouse_id, to_warehouse_id: toId,
            responsible_email: actor,
            notes: `Transferencia masiva → ${toWh.name}. ${reason}`,
          },
          {
            consumable_id: c.id, type: 'transfer_in', quantity: c.quantity,
            from_warehouse_id: existing.warehouse_id, to_warehouse_id: toId,
            responsible_email: actor,
            notes: `Recibido de transferencia. ${reason}`,
          },
        ]);
        result.consumables_moved += c.quantity;
      }
    }

    return NextResponse.json({ success: true, ...result, to_warehouse: { id: toWh.id, name: toWh.name } });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}
