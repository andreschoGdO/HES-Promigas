import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

/**
 * GET /api/inventory/reservations
 *   ?status=draft|confirmed|fulfilled|cancelled
 *   ?visit_id=...
 * Devuelve reservas + sus líneas (items asignados).
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const status = url.searchParams.get('status');
  const visitId = url.searchParams.get('visit_id');

  let q = supabaseAdmin
    .from('inventory_reservations')
    .select('*, field_visits(visit_type, casa, visit_date), inventory_reservation_items(id, picked_at, inventory_items(id, serial_number, brand, model, status, inventory_categories(name, family))), inventory_reservation_consumables(id, quantity, fulfilled_at, inventory_consumables(id, name, sku, unit, stock_quantity))')
    .order('created_at', { ascending: false });
  if (status) q = q.eq('status', status);
  if (visitId) q = q.eq('visit_id', visitId);

  const { data, error } = await q.limit(200);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ reservations: data });
}

/**
 * POST /api/inventory/reservations
 * Body: { title, visit_id?, requested_by?, notes?, item_ids?: string[] }
 * Crea una reserva draft. Si trae item_ids, los asigna directo (sin cambiar status aún).
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (!body.title) return NextResponse.json({ error: 'title requerido' }, { status: 400 });

    const { data: resv, error } = await supabaseAdmin
      .from('inventory_reservations')
      .insert({
        visit_id: body.visit_id ?? null,
        title: body.title,
        requested_by: body.requested_by ?? null,
        notes: body.notes ?? null,
        status: 'draft',
      })
      .select('*')
      .single();
    if (error) throw error;

    if (Array.isArray(body.item_ids) && body.item_ids.length > 0) {
      const rows = body.item_ids.map((id: string) => ({ reservation_id: resv.id, item_id: id }));
      const { error: linkErr } = await supabaseAdmin.from('inventory_reservation_items').insert(rows);
      if (linkErr) throw linkErr;
    }

    return NextResponse.json({ reservation: resv });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}

/**
 * PATCH /api/inventory/reservations
 * Body: { id, action?: 'confirm'|'fulfill'|'cancel'|'reopen', ... }
 *
 *   confirm  → marca items en inventory_items.status='reserved', resv.status='confirmed'
 *   fulfill  → marca items en 'installed' (los enlaza con casa de la visita), resv.status='fulfilled'
 *   cancel   → devuelve items a 'in_stock', resv.status='cancelled'
 *   reopen   → vuelve a draft
 *
 * Si no se pasa action, simplemente actualiza campos editables (title/notes/visit_id).
 */
export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    if (!body.id) return NextResponse.json({ error: 'id requerido' }, { status: 400 });

    const { data: resv, error: getErr } = await supabaseAdmin
      .from('inventory_reservations')
      .select('*, field_visits(house_id, technician_email)')
      .eq('id', body.id)
      .single();
    if (getErr || !resv) return NextResponse.json({ error: 'No encontrada' }, { status: 404 });

    const { data: lines } = await supabaseAdmin
      .from('inventory_reservation_items')
      .select('item_id')
      .eq('reservation_id', body.id);
    const itemIds = (lines ?? []).map((l) => l.item_id);

    // Cargar líneas de consumibles para confirm/cancel/fulfill
    const { data: consLines } = await supabaseAdmin
      .from('inventory_reservation_consumables')
      .select('id, consumable_id, quantity, fulfilled_at, inventory_consumables(stock_quantity, name)')
      .eq('reservation_id', body.id);
    type ConsLine = { id: string; consumable_id: string; quantity: number; fulfilled_at: string | null; inventory_consumables?: { stock_quantity: number; name: string } | { stock_quantity: number; name: string }[] | null };
    const cons: ConsLine[] = (consLines ?? []) as ConsLine[];

    if (body.action === 'confirm') {
      if (resv.status !== 'draft') return NextResponse.json({ error: `No se puede confirmar desde ${resv.status}` }, { status: 400 });
      if (itemIds.length === 0 && cons.length === 0) {
        return NextResponse.json({ error: 'La reserva no tiene items ni consumibles' }, { status: 400 });
      }
      // Reservar items serializados (solo los que están en stock)
      const { data: updated } = await supabaseAdmin
        .from('inventory_items')
        .update({ status: 'reserved' })
        .in('id', itemIds)
        .eq('status', 'in_stock')
        .select('id');
      const updatedIds = (updated ?? []).map((u) => u.id);
      if (updatedIds.length > 0) {
        await supabaseAdmin.from('inventory_movements').insert(
          updatedIds.map((id) => ({
            item_id: id,
            type: 'reserve',
            from_status: 'in_stock',
            to_status: 'reserved',
            related_visit_id: resv.visit_id,
            responsible_email: body.responsible_email ?? null,
            notes: `Reservado para "${resv.title}"`,
          })),
        );
      }

      // Descontar consumibles del stock (con guard contra stock insuficiente)
      const consShortages: string[] = [];
      for (const line of cons) {
        const stock = Array.isArray(line.inventory_consumables) ? line.inventory_consumables[0] : line.inventory_consumables;
        if (!stock) continue;
        if (Number(stock.stock_quantity) < Number(line.quantity)) {
          consShortages.push(`${stock.name}: necesario ${line.quantity}, disponible ${stock.stock_quantity}`);
          continue;
        }
        const newQty = Number(stock.stock_quantity) - Number(line.quantity);
        await supabaseAdmin
          .from('inventory_consumables')
          .update({ stock_quantity: newQty })
          .eq('id', line.consumable_id)
          .gte('stock_quantity', line.quantity);  // guard contra race
        await supabaseAdmin.from('inventory_movements').insert({
          consumable_id: line.consumable_id,
          type: 'reserve',
          quantity: line.quantity,
          related_visit_id: resv.visit_id,
          responsible_email: body.responsible_email ?? null,
          notes: `Reservado para "${resv.title}"`,
        });
      }

      const { data: out } = await supabaseAdmin
        .from('inventory_reservations')
        .update({ status: 'confirmed', confirmed_at: new Date().toISOString() })
        .eq('id', body.id)
        .select('*')
        .single();
      return NextResponse.json({
        reservation: out,
        reserved_count: updatedIds.length,
        not_available: itemIds.length - updatedIds.length,
        consumables_reserved: cons.length - consShortages.length,
        consumable_shortages: consShortages,
      });
    }

    if (body.action === 'fulfill') {
      if (resv.status !== 'confirmed') return NextResponse.json({ error: `No se puede cumplir desde ${resv.status}` }, { status: 400 });
      const houseId = (resv as { field_visits?: { house_id?: string | null } | null }).field_visits?.house_id ?? null;
      const tech = (resv as { field_visits?: { technician_email?: string | null } | null }).field_visits?.technician_email ?? null;
      if (itemIds.length > 0) {
        await supabaseAdmin
          .from('inventory_items')
          .update({
            status: 'installed',
            current_location: 'house',
            current_house_id: houseId,
          })
          .in('id', itemIds)
          .eq('status', 'reserved');
        await supabaseAdmin.from('inventory_movements').insert(
          itemIds.map((id) => ({
            item_id: id,
            type: 'install',
            from_status: 'reserved',
            to_status: 'installed',
            to_location: 'house',
            to_house_id: houseId,
            related_visit_id: resv.visit_id,
            responsible_email: tech ?? body.responsible_email ?? null,
            notes: `Instalado desde reserva "${resv.title}"`,
          })),
        );
      }

      // Marcar consumibles como entregados (stock ya se descontó al confirmar).
      // Generamos un movimiento 'install' por consumible para auditoría del consumo.
      const now = new Date().toISOString();
      if (cons.length > 0) {
        await supabaseAdmin
          .from('inventory_reservation_consumables')
          .update({ fulfilled_at: now })
          .eq('reservation_id', body.id);
        await supabaseAdmin.from('inventory_movements').insert(
          cons.map((line) => ({
            consumable_id: line.consumable_id,
            type: 'install',
            quantity: line.quantity,
            to_location: 'house',
            to_house_id: houseId,
            related_visit_id: resv.visit_id,
            responsible_email: tech ?? body.responsible_email ?? null,
            notes: `Consumido en instalación desde reserva "${resv.title}"`,
          })),
        );
      }

      const { data: out } = await supabaseAdmin
        .from('inventory_reservations')
        .update({ status: 'fulfilled', fulfilled_at: now })
        .eq('id', body.id)
        .select('*')
        .single();
      return NextResponse.json({ reservation: out, installed_count: itemIds.length, consumables_count: cons.length });
    }

    if (body.action === 'cancel') {
      // Devolver items a in_stock si estaban reserved
      if (resv.status === 'confirmed' && itemIds.length > 0) {
        await supabaseAdmin
          .from('inventory_items')
          .update({ status: 'in_stock' })
          .in('id', itemIds)
          .eq('status', 'reserved');
        await supabaseAdmin.from('inventory_movements').insert(
          itemIds.map((id) => ({
            item_id: id,
            type: 'unreserve',
            from_status: 'reserved',
            to_status: 'in_stock',
            related_visit_id: resv.visit_id,
            responsible_email: body.responsible_email ?? null,
            notes: `Reserva cancelada: "${resv.title}"`,
          })),
        );
      }
      // Restituir stock de consumibles si la reserva había sido confirmada
      // (en draft o cancelled previa, el stock no se había descontado).
      if (resv.status === 'confirmed' && cons.length > 0) {
        for (const line of cons) {
          const stock = Array.isArray(line.inventory_consumables) ? line.inventory_consumables[0] : line.inventory_consumables;
          if (!stock) continue;
          const newQty = Number(stock.stock_quantity) + Number(line.quantity);
          await supabaseAdmin
            .from('inventory_consumables')
            .update({ stock_quantity: newQty })
            .eq('id', line.consumable_id);
          await supabaseAdmin.from('inventory_movements').insert({
            consumable_id: line.consumable_id,
            type: 'unreserve',
            quantity: line.quantity,
            related_visit_id: resv.visit_id,
            responsible_email: body.responsible_email ?? null,
            notes: `Reserva cancelada: "${resv.title}"`,
          });
        }
      }
      const { data: out } = await supabaseAdmin
        .from('inventory_reservations')
        .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
        .eq('id', body.id)
        .select('*')
        .single();
      return NextResponse.json({ reservation: out });
    }

    if (body.action === 'reopen') {
      const { data: out } = await supabaseAdmin
        .from('inventory_reservations')
        .update({ status: 'draft', confirmed_at: null, fulfilled_at: null, cancelled_at: null })
        .eq('id', body.id)
        .select('*')
        .single();
      return NextResponse.json({ reservation: out });
    }

    // Sin action: solo updates editables
    const updates: Record<string, unknown> = {};
    if (body.title !== undefined) updates.title = body.title;
    if (body.notes !== undefined) updates.notes = body.notes;
    if (body.visit_id !== undefined) updates.visit_id = body.visit_id;
    if (Object.keys(updates).length === 0) return NextResponse.json({ reservation: resv });
    const { data: out, error } = await supabaseAdmin
      .from('inventory_reservations')
      .update(updates)
      .eq('id', body.id)
      .select('*')
      .single();
    if (error) throw error;
    return NextResponse.json({ reservation: out });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}

/**
 * DELETE /api/inventory/reservations?id=...
 * Solo permitido si está en draft o cancelled (no destruir histórico de fulfilled).
 */
export async function DELETE(request: Request) {
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id requerido' }, { status: 400 });

  const { data: resv } = await supabaseAdmin.from('inventory_reservations').select('status').eq('id', id).single();
  if (!resv) return NextResponse.json({ error: 'No encontrada' }, { status: 404 });
  if (resv.status === 'confirmed' || resv.status === 'fulfilled') {
    return NextResponse.json({ error: 'Cancela antes de eliminar (los items en estado reserved deben liberarse)' }, { status: 400 });
  }

  const { error } = await supabaseAdmin.from('inventory_reservations').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
