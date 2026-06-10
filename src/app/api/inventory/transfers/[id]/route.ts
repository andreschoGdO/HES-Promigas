import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

interface Ctx { params: Promise<{ id: string }>; }

/**
 * PATCH /api/inventory/transfers/[id]
 *
 * Body: { action: 'ship' | 'receive' | 'cancel', ... }
 *
 *   ship:     status draft → in_transit
 *             Items: warehouse_id queda como from + se marcan picked=true.
 *             Consumibles: stock_quantity en origen se descuenta.
 *             (Los items mantienen status='in_stock' físicamente — no hay
 *              estado 'in_transit' en inventory_items. La trazabilidad
 *              vive en la transferencia misma.)
 *
 *   receive:  status in_transit → received
 *             Items: warehouse_id = to_warehouse_id, received=true.
 *             Consumibles: stock_quantity en destino se incrementa
 *                          (received_quantity por línea, puede diferir
 *                          de quantity inicial si hubo pérdida).
 *
 *   cancel:   revierte
 *             Si está draft: solo cambia status.
 *             Si está in_transit: restituye stock de consumibles.
 *             Items se mantienen siempre vinculados a from_warehouse_id
 *             hasta confirmar receive, por eso no hay nada que revertir
 *             en items.
 */
export async function PATCH(request: Request, context: Ctx) {
  try {
    const { id } = await context.params;
    const body = await request.json();
    const action = String(body.action ?? '').trim();
    const actor = body.actor_email ?? null;

    if (!['ship', 'receive', 'cancel', 'edit'].includes(action)) {
      return NextResponse.json({ error: `action debe ser ship | receive | cancel | edit` }, { status: 400 });
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
      if (t.status !== 'draft') return NextResponse.json({ error: 'Solo se edita en estado draft' }, { status: 400 });
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
      if (t.status !== 'draft') return NextResponse.json({ error: `No se puede enviar desde ${t.status}` }, { status: 400 });
      if (itemLines.length === 0 && consLines.length === 0) {
        return NextResponse.json({ error: 'La transferencia no tiene líneas' }, { status: 400 });
      }

      // Validar que todos los items estén in_stock y en la bodega origen
      const itemIds = itemLines.map((l: { item_id: string }) => l.item_id);
      let invalidItems: string[] = [];
      if (itemIds.length > 0) {
        const { data: items } = await supabaseAdmin
          .from('inventory_items').select('id, serial_number, status, warehouse_id').in('id', itemIds);
        invalidItems = (items ?? [])
          .filter((it) => it.status !== 'in_stock' || (t.from_warehouse_id && it.warehouse_id !== t.from_warehouse_id))
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

      // Marcar líneas de items como picked
      if (itemLines.length > 0) {
        await supabaseAdmin
          .from('inventory_transfer_items')
          .update({ picked: true })
          .eq('transfer_id', id);
        // Movimientos transfer_out
        await supabaseAdmin.from('inventory_movements').insert(
          itemLines.map((l: { item_id: string }) => ({
            item_id: l.item_id, type: 'transfer_out',
            from_status: 'in_stock', to_status: 'in_stock',
            from_warehouse_id: t.from_warehouse_id, to_warehouse_id: t.to_warehouse_id,
            responsible_email: actor,
            notes: `Enviado en transferencia ${t.code}`,
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
          consumable_id: line.consumable_id, type: 'transfer_out', quantity: line.quantity,
          from_warehouse_id: t.from_warehouse_id, to_warehouse_id: t.to_warehouse_id,
          responsible_email: actor,
          notes: `Enviado en transferencia ${t.code}`,
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
        // Mover items a la bodega destino
        await supabaseAdmin
          .from('inventory_items')
          .update({ warehouse_id: t.to_warehouse_id })
          .in('id', itemIds);
        // Marcar líneas received
        await supabaseAdmin.from('inventory_transfer_items').update({ received: true }).eq('transfer_id', id);
        // Movimientos transfer_in
        await supabaseAdmin.from('inventory_movements').insert(
          itemLines.map((l: { item_id: string }) => ({
            item_id: l.item_id, type: 'transfer_in',
            from_status: 'in_stock', to_status: 'in_stock',
            from_warehouse_id: t.from_warehouse_id, to_warehouse_id: t.to_warehouse_id,
            responsible_email: actor,
            notes: `Recibido en transferencia ${t.code}`,
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
          consumable_id: line.consumable_id, type: 'transfer_in', quantity: qty,
          from_warehouse_id: t.from_warehouse_id, to_warehouse_id: t.to_warehouse_id,
          responsible_email: actor,
          notes: `Recibido en transferencia ${t.code}${qty !== Number(line.quantity) ? ` (esperado ${line.quantity}, recibido ${qty})` : ''}`,
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
      if (t.status === 'received' || t.status === 'cancelled') {
        return NextResponse.json({ error: `No se puede cancelar desde ${t.status}` }, { status: 400 });
      }

      // Si estaba in_transit: restituir stock de consumibles + revertir movimientos
      if (t.status === 'in_transit') {
        for (const line of consLines) {
          const { data: cons } = await supabaseAdmin
            .from('inventory_consumables').select('stock_quantity').eq('id', line.consumable_id).single();
          if (!cons) continue;
          await supabaseAdmin
            .from('inventory_consumables')
            .update({ stock_quantity: Number(cons.stock_quantity) + Number(line.quantity) })
            .eq('id', line.consumable_id);
          await supabaseAdmin.from('inventory_movements').insert({
            consumable_id: line.consumable_id, type: 'transfer_in', quantity: line.quantity,
            from_warehouse_id: t.to_warehouse_id, to_warehouse_id: t.from_warehouse_id,
            responsible_email: actor,
            notes: `Cancelado en transferencia ${t.code} — restituido a origen`,
          });
        }
        // Items: solo registrar movimiento; warehouse_id no cambió porque
        // los items no se movieron físicamente todavía hasta receive.
      }

      const { data: out, error } = await supabaseAdmin
        .from('inventory_transfers')
        .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
        .eq('id', id).select('*').single();
      if (error) throw error;
      return NextResponse.json({ transfer: out });
    }

    return NextResponse.json({ error: 'Acción no manejada' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}

/** DELETE — solo permitido en draft */
export async function DELETE(_request: Request, context: Ctx) {
  const { id } = await context.params;
  const { data: t } = await supabaseAdmin.from('inventory_transfers').select('status').eq('id', id).maybeSingle();
  if (!t) return NextResponse.json({ error: 'No encontrada' }, { status: 404 });
  if (t.status !== 'draft' && t.status !== 'cancelled') {
    return NextResponse.json({ error: 'Solo se borran transferencias en draft o cancelled' }, { status: 400 });
  }
  const { error } = await supabaseAdmin.from('inventory_transfers').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
