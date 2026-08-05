import { supabaseAdmin } from '@/lib/supabase-admin';

/**
 * Recupera a bodega los equipos de una casa (reserva activa + items
 * instalados) — misma lógica que usaba SOLO el botón "Cancelar" del
 * detalle del proyecto (`/api/crm/projects/[id]/cancel`). Se extrajo acá
 * para que las transiciones normales a 'desistido'/'sin_renovacion'
 * también la disparen — antes esas transiciones dejaban los equipos
 * marcados 'installed'/'reserved' para siempre, aunque el texto de la
 * etapa ("Equipos se recuperan a bodega") decía lo contrario.
 */
export async function recoverProjectEquipment(
  project: { id: string; code?: string | null; house_id: string | null; reservation_id?: string | null },
  actorEmail: string | null,
  reasonNote: string,
): Promise<{ recovered_count: number } | null> {
  const houseId = project.house_id;
  if (!houseId && !project.reservation_id) return null;

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
            responsible_email: actorEmail,
            notes: reasonNote,
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
        .update({ status: 'in_stock', current_house_id: null, current_location: 'warehouse' })
        .in('id', itemIds).eq('status', 'installed');

      await supabaseAdmin.from('inventory_movements').insert(
        installedItems.map((it) => ({
          item_id: it.id, type: 'uninstall',
          from_status: 'installed', to_status: 'in_stock',
          from_location: 'house', to_location: 'warehouse',
          from_house_id: houseId,
          responsible_email: actorEmail,
          notes: `${reasonNote}: ${it.serial_number} (${it.brand ?? ''} ${it.model ?? ''})`,
        })),
      );

      const { data: factRec } = await supabaseAdmin
        .from('facturacion_records').select('id').eq('project_id', project.id).maybeSingle();
      await supabaseAdmin.from('facturacion_upgrades').insert(
        installedItems.map((it) => ({
          project_id: project.id,
          facturacion_record_id: factRec?.id ?? null,
          motivo: 'cancel',
          costo_neto: null,
          notas: `${reasonNote}: ${it.serial_number} (${it.brand ?? ''} ${it.model ?? ''})`,
          item_removed_id: it.id,
          created_by: actorEmail,
        })),
      );
      recoveredCount = installedItems.length;
    }
  }

  return { recovered_count: recoveredCount };
}
