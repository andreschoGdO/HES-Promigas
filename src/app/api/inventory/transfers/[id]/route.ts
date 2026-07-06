import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

interface Ctx { params: Promise<{ id: string }>; }

/**
 * PATCH /api/inventory/transfers/[id]
 *
 * Body: { action, actor_email?, ... }
 *
 * Actions (nuevo flujo — mig 45):
 *   ship             reserved → in_transit
 *                    Items: reserved → in_transit (siguen con warehouse origen)
 *                    Consumibles: se descuentan del stock origen
 *
 *   receive          in_transit → received  [TERMINAL OK]
 *                    Items: in_transit → in_stock en bodega destino
 *                    Consumibles: se suman al stock destino
 *
 *   cancel           depende del estado actual:
 *                    - reserved      → cancelled (items reserved → in_stock)
 *                    - in_transit    → in_transit_return (items siguen in_transit)
 *                    - otros         → error
 *
 *   return-arrived   in_transit_return → returned  [TERMINAL CANCEL]
 *                    Items: in_transit → in_stock en bodega ORIGEN (volvieron)
 *
 *   edit             solo en reserved: cambia carrier, tracking, notas, destino
 */
export async function PATCH(request: Request, context: Ctx) {
  try {
    const { id } = await context.params;
    const body = await request.json();
    const action = String(body.action ?? '').trim();
    const actor = body.actor_email ?? null;

    if (!['ship', 'receive', 'cancel', 'return-arrived', 'edit'].includes(action)) {
      return NextResponse.json({ error: `action debe ser ship | receive | cancel | return-arrived | edit` }, { status: 400 });
    }

    // Cargar transferencia con líneas
    const { data: transfer } = await supabaseAdmin
      .from('inventory_transfers')
      .select(`
        *,
        inventory_transfer_items(id, item_id),
        inventory_transfer_consumables(id, consumable_id, quantity, received_quantity)
      `)
      .eq('id', id)
      .single();
    if (!transfer) return NextResponse.json({ error: 'Transferencia no encontrada' }, { status: 404 });

    type T = typeof transfer & {
      inventory_transfer_items?: Array<{ id: string; item_id: string }>;
      inventory_transfer_consumables?: Array<{ id: string; consumable_id: string; quantity: number; received_quantity: number | null }>;
    };
    const t = transfer as T;
    const itemLines = t.inventory_transfer_items ?? [];
    const consLines = t.inventory_transfer_consumables ?? [];

    if (action === 'edit') {
      if (t.status !== 'reserved' && t.status !== 'draft') {
        return NextResponse.json({ error: 'Solo se edita mientras está en reserved (o draft legacy)' }, { status: 400 });
      }
      const updates: Record<string, unknown> = {};
      for (const k of ['carrier', 'tracking_number', 'notes', 'to_warehouse_id']) {
        if (k in body) updates[k] = body[k];
      }
      const { data, error } = await supabaseAdmin
        .from('inventory_transfers').update(updates).eq('id', id).select('*').single();
      if (error) throw error;
      return NextResponse.json({ transfer: data });
    }

    if (action === 'ship') {
      // Aceptamos desde reserved (nuevo) o draft (legacy) para transición de datos.
      if (t.status !== 'reserved' && t.status !== 'draft') {
        return NextResponse.json({ error: `No se puede despachar desde ${t.status}` }, { status: 400 });
      }
      if (itemLines.length === 0 && consLines.length === 0) {
        return NextResponse.json({ error: 'La transferencia no tiene líneas' }, { status: 400 });
      }

      const itemIds = itemLines.map((l: { item_id: string }) => l.item_id);
      // Estado esperado de items: reserved (si viene de reserved) o in_stock (si viene de draft legacy)
      const expectedItemStatus = t.status === 'reserved' ? 'reserved' : 'in_stock';
      if (itemIds.length > 0) {
        const { data: items } = await supabaseAdmin
          .from('inventory_items').select('id, serial_number, status, warehouse_id').in('id', itemIds);
        const invalidItems = (items ?? [])
          .filter((it) => it.status !== expectedItemStatus || (t.from_warehouse_id && it.warehouse_id !== t.from_warehouse_id))
          .map((it) => `${it.serial_number}: status=${it.status}${it.warehouse_id !== t.from_warehouse_id ? ', bodega errada' : ''}`);
        if (invalidItems.length > 0) {
          return NextResponse.json({ error: `Items no enviables:\n${invalidItems.join('\n')}` }, { status: 400 });
        }
      }

      // Validar stock de consumibles en bodega origen
      const consShortages: string[] = [];
      for (const line of consLines) {
        const { data: cons } = await supabaseAdmin
          .from('inventory_consumables').select('name, stock_quantity').eq('id', line.consumable_id).single();
        if (!cons) continue;
        if (Number(cons.stock_quantity) < Number(line.quantity)) {
          consShortages.push(`${cons.name}: necesitas ${line.quantity}, hay ${cons.stock_quantity}`);
        }
      }
      if (consShortages.length > 0) {
        return NextResponse.json({ error: `Stock insuficiente:\n${consShortages.join('\n')}` }, { status: 400 });
      }

      // Items: pasan a in_transit (siguen con warehouse origen físicamente)
      if (itemIds.length > 0) {
        await supabaseAdmin
          .from('inventory_items')
          .update({ status: 'in_transit', current_location: 'in_transit' })
          .in('id', itemIds);
        await supabaseAdmin
          .from('inventory_transfer_items')
          .update({ picked: true })
          .eq('transfer_id', id);
        await supabaseAdmin.from('inventory_movements').insert(
          itemLines.map((l: { item_id: string }) => ({
            item_id: l.item_id, type: 'ship',
            from_status: expectedItemStatus, to_status: 'in_transit',
            from_warehouse_id: t.from_warehouse_id, to_warehouse_id: t.to_warehouse_id,
            responsible_email: actor,
            notes: `Despachado en transferencia ${t.code}`,
          })),
        );
      }

      // Descontar consumibles del stock origen
      for (const line of consLines) {
        const { data: cons } = await supabaseAdmin
          .from('inventory_consumables').select('stock_quantity').eq('id', line.consumable_id).single();
        if (!cons) continue;
        await supabaseAdmin
          .from('inventory_consumables')
          .update({ stock_quantity: Number(cons.stock_quantity) - Number(line.quantity) })
          .eq('id', line.consumable_id);
        await supabaseAdmin.from('inventory_movements').insert({
          consumable_id: line.consumable_id, type: 'ship', quantity: line.quantity,
          from_warehouse_id: t.from_warehouse_id, to_warehouse_id: t.to_warehouse_id,
          responsible_email: actor,
          notes: `Despachado en transferencia ${t.code}`,
        });
      }

      const { data: out, error } = await supabaseAdmin
        .from('inventory_transfers')
        .update({ status: 'in_transit', shipped_at: new Date().toISOString(), shipped_by: actor })
        .eq('id', id).select('*').single();
      if (error) throw error;
      return NextResponse.json({ transfer: out });
    }

    if (action === 'receive') {
      if (t.status !== 'in_transit') return NextResponse.json({ error: `No se puede recibir desde ${t.status}` }, { status: 400 });

      const itemIds = itemLines.map((l: { item_id: string }) => l.item_id);
      if (itemIds.length > 0) {
        // Items: in_transit → in_stock en bodega destino
        await supabaseAdmin
          .from('inventory_items')
          .update({
            status: 'in_stock',
            warehouse_id: t.to_warehouse_id,
            current_location: 'warehouse',
          })
          .in('id', itemIds);
        await supabaseAdmin.from('inventory_transfer_items').update({ received: true }).eq('transfer_id', id);
        await supabaseAdmin.from('inventory_movements').insert(
          itemLines.map((l: { item_id: string }) => ({
            item_id: l.item_id, type: 'receive_at_destination',
            from_status: 'in_transit', to_status: 'in_stock',
            from_warehouse_id: t.from_warehouse_id, to_warehouse_id: t.to_warehouse_id,
            responsible_email: actor,
            notes: `Recibido en destino, transferencia ${t.code}`,
          })),
        );
      }

      // Consumibles: usar received_quantity si está, sino quantity
      // received_quantities viene como array opcional en el body: [{ line_id, qty }]
      const receivedMap = new Map<string, number>();
      if (Array.isArray(body.received_quantities)) {
        for (const r of body.received_quantities as Array<{ line_id: string; qty: number }>) {
          receivedMap.set(r.line_id, Number(r.qty));
        }
      }
      for (const line of consLines) {
        const qty = receivedMap.get(line.id) ?? Number(line.quantity);
        if (qty <= 0) continue;
        const { data: cons } = await supabaseAdmin
          .from('inventory_consumables').select('stock_quantity, warehouse_id').eq('id', line.consumable_id).single();
        if (!cons) continue;
        // Sumar al stock del consumible. Si el consumible está vinculado a otra
        // bodega, también actualizamos warehouse_id al destino.
        await supabaseAdmin
          .from('inventory_consumables')
          .update({
            stock_quantity: Number(cons.stock_quantity) + qty,
            warehouse_id: t.to_warehouse_id,
          })
          .eq('id', line.consumable_id);
        await supabaseAdmin
          .from('inventory_transfer_consumables').update({ received_quantity: qty }).eq('id', line.id);
        await supabaseAdmin.from('inventory_movements').insert({
          consumable_id: line.consumable_id, type: 'receive_at_destination', quantity: qty,
          from_warehouse_id: t.from_warehouse_id, to_warehouse_id: t.to_warehouse_id,
          responsible_email: actor,
          notes: `Recibido en destino, transferencia ${t.code}${qty !== Number(line.quantity) ? ` (esperado ${line.quantity}, recibido ${qty})` : ''}`,
        });
      }

      const { data: out, error } = await supabaseAdmin
        .from('inventory_transfers')
        .update({ status: 'received', received_at: new Date().toISOString(), received_by: actor })
        .eq('id', id).select('*').single();
      if (error) throw error;
      return NextResponse.json({ transfer: out });
    }

    if (action === 'cancel') {
      // Terminales — no se pueden cancelar más
      if (['received', 'cancelled', 'returned'].includes(t.status)) {
        return NextResponse.json({ error: `No se puede cancelar desde ${t.status}` }, { status: 400 });
      }

      const itemIds = itemLines.map((l: { item_id: string }) => l.item_id);

      // CASO A: cancelar desde reserved (o draft legacy) → cancelled
      // Items siguen físicamente en origen: reserved → in_stock, warehouse origen.
      if (t.status === 'reserved' || t.status === 'draft') {
        if (itemIds.length > 0) {
          await supabaseAdmin
            .from('inventory_items')
            .update({ status: 'in_stock' })
            .in('id', itemIds);
          await supabaseAdmin.from('inventory_movements').insert(
            itemLines.map((l: { item_id: string }) => ({
              item_id: l.item_id, type: 'unreserve',
              from_status: 'reserved', to_status: 'in_stock',
              from_warehouse_id: t.from_warehouse_id, to_warehouse_id: t.from_warehouse_id,
              responsible_email: actor,
              notes: `Transferencia ${t.code} cancelada antes de despachar`,
            })),
          );
        }
        const { data: out, error } = await supabaseAdmin
          .from('inventory_transfers')
          .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
          .eq('id', id).select('*').single();
        if (error) throw error;
        return NextResponse.json({ transfer: out });
      }

      // CASO B: cancelar desde in_transit → in_transit_return
      // Los items físicos ya salieron pero están volviendo al origen.
      // Los items en BD siguen 'in_transit'. La transferencia se marca
      // in_transit_return con return_shipped_at.
      if (t.status === 'in_transit') {
        // Restituir consumibles al origen (los consumibles ya se descontaron al ship)
        for (const line of consLines) {
          const { data: cons } = await supabaseAdmin
            .from('inventory_consumables').select('stock_quantity').eq('id', line.consumable_id).single();
          if (!cons) continue;
          await supabaseAdmin
            .from('inventory_consumables')
            .update({ stock_quantity: Number(cons.stock_quantity) + Number(line.quantity) })
            .eq('id', line.consumable_id);
          await supabaseAdmin.from('inventory_movements').insert({
            consumable_id: line.consumable_id, type: 'return_ship', quantity: line.quantity,
            from_warehouse_id: t.to_warehouse_id, to_warehouse_id: t.from_warehouse_id,
            responsible_email: actor,
            notes: `Transferencia ${t.code} cancelada en tránsito — consumibles restituidos a origen`,
          });
        }
        // Items: registrar movimiento, siguen in_transit hasta que "returned"
        if (itemIds.length > 0) {
          await supabaseAdmin.from('inventory_movements').insert(
            itemLines.map((l: { item_id: string }) => ({
              item_id: l.item_id, type: 'return_ship',
              from_status: 'in_transit', to_status: 'in_transit',
              from_warehouse_id: t.to_warehouse_id, to_warehouse_id: t.from_warehouse_id,
              responsible_email: actor,
              notes: `Transferencia ${t.code} cancelada — items volviendo al origen`,
            })),
          );
        }
        const { data: out, error } = await supabaseAdmin
          .from('inventory_transfers')
          .update({
            status: 'in_transit_return',
            return_shipped_at: new Date().toISOString(),
            return_shipped_by: actor,
          })
          .eq('id', id).select('*').single();
        if (error) throw error;
        return NextResponse.json({ transfer: out });
      }

      // CASO C: cancelar desde in_transit_return → cancelled directo
      // El vehículo se perdió o la devolución también fracasó — items marcados
      // como perdidos (status lost) para no dejar rastro colgando.
      if (t.status === 'in_transit_return') {
        if (itemIds.length > 0) {
          await supabaseAdmin
            .from('inventory_items')
            .update({ status: 'lost' })
            .in('id', itemIds);
          await supabaseAdmin.from('inventory_movements').insert(
            itemLines.map((l: { item_id: string }) => ({
              item_id: l.item_id, type: 'unreserve',
              from_status: 'in_transit', to_status: 'lost',
              responsible_email: actor,
              notes: `Transferencia ${t.code} — cancelación final en retorno (items perdidos)`,
            })),
          );
        }
        const { data: out, error } = await supabaseAdmin
          .from('inventory_transfers')
          .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
          .eq('id', id).select('*').single();
        if (error) throw error;
        return NextResponse.json({ transfer: out });
      }

      return NextResponse.json({ error: `No se puede cancelar desde ${t.status}` }, { status: 400 });
    }

    // ─── return-arrived: items volvieron al origen ───
    if (action === 'return-arrived') {
      if (t.status !== 'in_transit_return') {
        return NextResponse.json({ error: `No se puede marcar 'volvió al origen' desde ${t.status}` }, { status: 400 });
      }
      const itemIds = itemLines.map((l: { item_id: string }) => l.item_id);
      if (itemIds.length > 0) {
        await supabaseAdmin
          .from('inventory_items')
          .update({
            status: 'in_stock',
            warehouse_id: t.from_warehouse_id,
            current_location: 'warehouse',
          })
          .in('id', itemIds);
        await supabaseAdmin.from('inventory_movements').insert(
          itemLines.map((l: { item_id: string }) => ({
            item_id: l.item_id, type: 'return_arrived',
            from_status: 'in_transit', to_status: 'in_stock',
            from_warehouse_id: t.to_warehouse_id, to_warehouse_id: t.from_warehouse_id,
            responsible_email: actor,
            notes: `Transferencia ${t.code} — items volvieron al origen`,
          })),
        );
      }
      const { data: out, error } = await supabaseAdmin
        .from('inventory_transfers')
        .update({
          status: 'returned',
          returned_at: new Date().toISOString(),
          returned_by: actor,
        })
        .eq('id', id).select('*').single();
      if (error) throw error;
      return NextResponse.json({ transfer: out });
    }

    return NextResponse.json({ error: 'Acción no manejada' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}

/** DELETE — solo permitido en cancelled (para limpiar registros terminados) */
export async function DELETE(_request: Request, context: Ctx) {
  const { id } = await context.params;
  const { data: t } = await supabaseAdmin.from('inventory_transfers').select('status').eq('id', id).maybeSingle();
  if (!t) return NextResponse.json({ error: 'No encontrada' }, { status: 404 });
  if (t.status !== 'cancelled' && t.status !== 'returned' && t.status !== 'draft') {
    return NextResponse.json({
      error: `Solo se borran transferencias en cancelled, returned o draft (actual: ${t.status}). Cancelala primero.`,
    }, { status: 400 });
  }
  const { error } = await supabaseAdmin.from('inventory_transfers').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
