import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

interface Ctx { params: Promise<{ id: string }>; }

/**
 * POST /api/crm/projects/[id]/cancel
 *
 * Cancela un proyecto y recupera TODOS los equipos instalados en su casa,
 * devolviéndolos a bodega (in_stock). El proyecto NO se borra — queda con
 * cancelled_at y cancellation_reason para histórico.
 *
 * Body:
 *   {
 *     reason: string;
 *     destination_status?: 'in_stock' | 'in_repair' | 'rma';  // default in_stock
 *     actor_email?: string;
 *   }
 *
 * Comportamiento:
 *   - Todos los items con current_house_id = casa pasan al destination_status
 *   - Se generan movimientos uninstall por cada uno
 *   - Si había reserva activa, también se cancela (items reservados → in_stock)
 *   - Se registra un upgrade tipo 'cancel' en facturacion_upgrades por cada equipo
 *   - Se marca crm_projects.cancelled_at y cancellation_reason
 *   - Si el proyecto estaba en current_module='operations', pasa a 'closed' con
 *     operations_stage='completado' (pero con cancelled_at para distinguirlo)
 */
export async function POST(request: Request, context: Ctx) {
  try {
    const { id } = await context.params;
    const body = await request.json();
    const reason = String(body.reason ?? '').trim();
    if (!reason) return NextResponse.json({ error: 'reason requerido' }, { status: 400 });

    const destStatus = (body.destination_status ?? 'in_stock') as string;
    const validDest = ['in_stock', 'in_repair', 'rma'];
    if (!validDest.includes(destStatus)) {
      return NextResponse.json({ error: `destination_status debe ser uno de: ${validDest.join(', ')}` }, { status: 400 });
    }
    const actor = body.actor_email ?? null;

    const { data: project } = await supabaseAdmin
      .from('crm_projects')
      .select('id, code, title, house_id, current_module, reservation_id, cancelled_at')
      .eq('id', id)
      .single();
    if (!project) return NextResponse.json({ error: 'proyecto no encontrado' }, { status: 404 });
    if (project.cancelled_at) {
      return NextResponse.json({ error: 'El proyecto ya estaba cancelado' }, { status: 400 });
    }

    const houseId = project.house_id;
    const newLocation = destStatus === 'in_stock' ? 'warehouse' : destStatus === 'in_repair' ? 'workshop' : 'supplier_rma';

    // 1. Cancelar reserva activa si existe (libera items reserved → in_stock)
    if (project.reservation_id) {
      const { data: resv } = await supabaseAdmin
        .from('inventory_reservations').select('status').eq('id', project.reservation_id).single();
      if (resv && resv.status === 'confirmed') {
        const { data: lines } = await supabaseAdmin
          .from('inventory_reservation_items').select('item_id').eq('reservation_id', project.reservation_id);
        const itemIds = (lines ?? []).map((l) => l.item_id);
        if (itemIds.length > 0) {
          await supabaseAdmin
            .from('inventory_items').update({ status: 'in_stock' })
            .in('id', itemIds).eq('status', 'reserved');
          await supabaseAdmin.from('inventory_movements').insert(
            itemIds.map((itemId) => ({
              item_id: itemId, type: 'unreserve',
              from_status: 'reserved', to_status: 'in_stock',
              responsible_email: actor,
              notes: `Reserva cancelada por cancelación de proyecto ${project.code}`,
            })),
          );
        }
        await supabaseAdmin.from('inventory_reservations')
          .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
          .eq('id', project.reservation_id);
      }
    }

    // 2. Recuperar equipos instalados en la casa
    let recoveredCount = 0;
    if (houseId) {
      const { data: installed } = await supabaseAdmin
        .from('inventory_items')
        .select('id, serial_number, brand, model')
        .eq('current_house_id', houseId)
        .eq('status', 'installed');
      const installedItems = installed ?? [];

      if (installedItems.length > 0) {
        const itemIds = installedItems.map((i) => i.id);
        await supabaseAdmin
          .from('inventory_items')
          .update({ status: destStatus, current_house_id: null, current_location: newLocation })
          .in('id', itemIds).eq('status', 'installed');

        await supabaseAdmin.from('inventory_movements').insert(
          installedItems.map((it) => ({
            item_id: it.id, type: 'uninstall',
            from_status: 'installed', to_status: destStatus,
            from_location: 'house', to_location: newLocation,
            from_house_id: houseId,
            responsible_email: actor,
            notes: `Recuperado por cancelación de proyecto ${project.code}: ${reason}`,
          })),
        );

        // Upgrade record por cada item retirado
        const { data: factRec } = await supabaseAdmin
          .from('facturacion_records').select('id').eq('project_id', id).maybeSingle();
        if (installedItems.length > 0) {
          await supabaseAdmin.from('facturacion_upgrades').insert(
            installedItems.map((it) => ({
              project_id: id,
              facturacion_record_id: factRec?.id ?? null,
              motivo: 'cancel',
              costo_neto: null,
              notas: `Recuperado por cancelación: ${it.serial_number} (${it.brand ?? ''} ${it.model ?? ''})`,
              item_removed_id: it.id,
              created_by: actor,
            })),
          );
        }
        recoveredCount = installedItems.length;
      }
    }

    // 3. Marcar proyecto como cancelado
    const cancelledAt = new Date().toISOString();
    await supabaseAdmin
      .from('crm_projects')
      .update({
        cancelled_at: cancelledAt,
        cancellation_reason: reason,
        current_module: 'closed',
        operations_stage: 'completado',
        closed_at: cancelledAt,
      })
      .eq('id', id);

    await supabaseAdmin.from('crm_project_events').insert({
      project_id: id,
      event_type: 'handoff',
      from_module: project.current_module,
      to_module: 'closed',
      actor_email: actor,
      notes: `Proyecto cancelado. Motivo: ${reason}. ${recoveredCount} equipo(s) recuperado(s) a ${destStatus}.`,
      data: { cancellation: { reason, recovered_count: recoveredCount, destination: destStatus } },
    });

    return NextResponse.json({ success: true, recovered_count: recoveredCount, cancelled_at: cancelledAt });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}
