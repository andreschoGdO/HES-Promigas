import { supabaseAdmin } from './supabase-admin';

/**
 * Enlaza inventario con una visita recién completada.
 *
 * - Instalación: busca seriales en form_data → marca items como `installed`
 *   en la casa de la visita y genera movimientos `install`.
 * - Emergencia: si `requiere_repuesto = "Sí"`, intenta marcar como `in_repair`
 *   el equipo del tipo `equipo_afectado` instalado en la casa y genera
 *   movimiento `repair_start`.
 *
 * No es destructivo: seriales no encontrados se ignoran silenciosamente.
 * Solo dispara cuando la visita pasa a `completed`.
 */

const INSTALL_SERIAL_KEYS: Array<{ key: string; label: string }> = [
  { key: 'inv_serial', label: 'Inversor' },
  { key: 'batt_serial', label: 'Batería' },
  { key: 'gateway_serial', label: 'Gateway Pulsar' },
  { key: 'meter_solar_serial', label: 'Medidor solar' },
  { key: 'meter_red_serial', label: 'Medidor red' },
];

// Mapeo de la opción `equipo_afectado` (emergencia) → familia de categoría
const EQUIPO_AFECTADO_TO_FAMILY: Record<string, string> = {
  'Inversor': 'inverter',
  'Paneles': 'panel',
  'Medidor solar': 'meter',
  'Medidor red': 'meter',
  'Gateway Pulsar': 'gateway',
  'Batería': 'battery',
};

export async function linkVisitToInventory(opts: {
  visitId: string;
  visitType: string;
  formData: Record<string, unknown> | null;
  houseId: string | null;
  technicianEmail: string | null;
}): Promise<{ linked: string[]; skipped: string[] }> {
  const linked: string[] = [];
  const skipped: string[] = [];
  const form = opts.formData ?? {};

  if (opts.visitType === 'instalacion') {
    // Camino preferido: si hay una reserva CONFIRMADA vinculada a esta visita,
    // los items ya están como 'reserved'; los pasamos a 'installed' en bloque.
    const { data: confirmedResv } = await supabaseAdmin
      .from('inventory_reservations')
      .select('id, title, inventory_reservation_items(item_id, inventory_items(serial_number, status))')
      .eq('visit_id', opts.visitId)
      .eq('status', 'confirmed')
      .maybeSingle();
    if (confirmedResv) {
      type RawItem = { serial_number: string; status: string };
      type RawLine = { item_id: string; inventory_items?: RawItem | RawItem[] | null };
      const rawLines = (confirmedResv as unknown as { inventory_reservation_items?: RawLine[] }).inventory_reservation_items ?? [];
      const lines = rawLines.map((l) => {
        const itm = Array.isArray(l.inventory_items) ? l.inventory_items[0] : l.inventory_items;
        return { item_id: l.item_id, inventory_items: itm ?? null };
      });
      const reservedItemIds = lines
        .filter((l) => l.inventory_items?.status === 'reserved')
        .map((l) => l.item_id);

      if (reservedItemIds.length > 0) {
        await supabaseAdmin
          .from('inventory_items')
          .update({ status: 'installed', current_location: 'house', current_house_id: opts.houseId })
          .in('id', reservedItemIds)
          .eq('status', 'reserved');
        await supabaseAdmin.from('inventory_movements').insert(
          reservedItemIds.map((id) => ({
            item_id: id,
            type: 'install',
            from_status: 'reserved',
            to_status: 'installed',
            to_location: 'house',
            to_house_id: opts.houseId,
            related_visit_id: opts.visitId,
            responsible_email: opts.technicianEmail,
            notes: `Instalado vía reserva "${confirmedResv.title}"`,
          })),
        );
        for (const line of lines) {
          if (line.inventory_items?.status === 'reserved') {
            linked.push(`${line.inventory_items.serial_number} (desde reserva)`);
          }
        }
      }
      // Marcar la reserva como fulfilled
      await supabaseAdmin
        .from('inventory_reservations')
        .update({ status: 'fulfilled', fulfilled_at: new Date().toISOString() })
        .eq('id', confirmedResv.id);
    }

    // parseSerials: acepta un campo (string crudo del formulario) y devuelve
    // los seriales individuales. Soporta separación por saltos de línea,
    // comas, punto-y-comas o espacios. Quita duplicados.
    const parseSerials = (raw: unknown): string[] => {
      if (!raw || typeof raw !== 'string') return [];
      const parts = raw.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean);
      return Array.from(new Set(parts));
    };

    for (const { key, label } of INSTALL_SERIAL_KEYS) {
      const serials = parseSerials(form[key]);
      for (const serial of serials) {
        const { data: item } = await supabaseAdmin
          .from('inventory_items')
          .select('id, status, current_house_id')
          .eq('serial_number', serial)
          .maybeSingle();

        if (!item) {
          skipped.push(`${label}: ${serial} (no está en inventario)`);
          continue;
        }
        // Si ya estaba instalado en esta misma casa, no duplicar movimiento.
        if (item.status === 'installed' && item.current_house_id === opts.houseId) {
          skipped.push(`${label}: ${serial} (ya estaba instalado aquí)`);
          continue;
        }

        // UPDATE condicional sobre el status leído: si otra request concurrente ya cambió el estado,
        // este update afectará 0 filas y NO insertamos un movimiento duplicado.
        const { data: updated } = await supabaseAdmin
          .from('inventory_items')
          .update({
            status: 'installed',
            current_location: 'house',
            current_house_id: opts.houseId,
          })
          .eq('id', item.id)
          .eq('status', item.status)
          .select('id');

        if (!updated || updated.length === 0) {
          skipped.push(`${label}: ${serial} (modificado por otra operación, omitido)`);
          continue;
        }

        await supabaseAdmin.from('inventory_movements').insert({
          item_id: item.id,
          type: 'install',
          from_status: item.status,
          to_status: 'installed',
          to_location: 'house',
          to_house_id: opts.houseId,
          related_visit_id: opts.visitId,
          responsible_email: opts.technicianEmail,
          notes: `Instalado en visita ${opts.visitId.slice(0, 8)} (${label})`,
        });
        linked.push(`${label}: ${serial}`);
      }
    }
    return { linked, skipped };
  }

  if (opts.visitType === 'emergencia') {
    const requiere = String(form['requiere_repuesto'] ?? '');
    const equipoAfectado = String(form['equipo_afectado'] ?? '');
    if (requiere !== 'Sí' || !equipoAfectado || !opts.houseId) {
      return { linked, skipped };
    }
    const family = EQUIPO_AFECTADO_TO_FAMILY[equipoAfectado];
    if (!family) return { linked, skipped };

    // Buscar equipo instalado en esa casa de esa familia
    const { data: candidates } = await supabaseAdmin
      .from('inventory_items')
      .select('id, serial_number, status, inventory_categories!inner(family)')
      .eq('current_house_id', opts.houseId)
      .eq('status', 'installed')
      .eq('inventory_categories.family', family);

    if (!candidates || candidates.length === 0) {
      skipped.push(`${equipoAfectado}: no se encontró equipo instalado en la casa`);
      return { linked, skipped };
    }

    // Si hay varios candidatos (ej. 2 medidores), marcar todos como in_repair (con guard de concurrencia)
    for (const it of candidates) {
      const { data: updated } = await supabaseAdmin
        .from('inventory_items')
        .update({ status: 'in_repair' })
        .eq('id', it.id)
        .eq('status', 'installed')
        .select('id');

      if (!updated || updated.length === 0) {
        skipped.push(`${equipoAfectado}: ${it.serial_number} (cambió de estado, omitido)`);
        continue;
      }

      await supabaseAdmin.from('inventory_movements').insert({
        item_id: it.id,
        type: 'repair_start',
        from_status: 'installed',
        to_status: 'in_repair',
        related_visit_id: opts.visitId,
        responsible_email: opts.technicianEmail,
        notes: `Reemplazo por emergencia (${equipoAfectado})`,
      });
      linked.push(`${equipoAfectado}: ${it.serial_number} → en garantía`);
    }
    return { linked, skipped };
  }

  return { linked, skipped };
}
