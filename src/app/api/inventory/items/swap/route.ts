import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

/**
 * POST /api/inventory/items/swap
 *
 * Swap atómico: sacar un equipo instalado y poner otro de bodega en su
 * misma casa. Sirve para upgrades de tecnología (ej. Livoltek → DEYE),
 * reemplazos por garantía y daños.
 *
 * Body:
 *   {
 *     old_item_id: string;          // item con status='installed'
 *     new_item_id: string;          // item con status='in_stock'
 *     motivo: 'upgrade' | 'warranty' | 'damage' | 'replacement' | 'other';
 *     destination_status?:          // a dónde va el equipo retirado
 *       'in_stock' | 'in_repair' | 'rma' | 'decommissioned';
 *     related_visit_id?: string;
 *     notes?: string;
 *     actor_email?: string;
 *   }
 *
 * Si el proyecto vinculado a la casa está en o pasó por Operativo (tiene
 * facturacion_records), se registra el swap en `facturacion_upgrades` para
 * preservar la integridad contable del snapshot original.
 */
type Item = {
  id: string;
  serial_number: string;
  status: string;
  current_house_id: string | null;
  current_location: string | null;
  category_id: string | null;
  acquired_cost_cop: number | null;
  brand: string | null;
  model: string | null;
};

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const oldId = String(body.old_item_id ?? '').trim();
    const newId = String(body.new_item_id ?? '').trim();
    if (!oldId || !newId) return NextResponse.json({ error: 'old_item_id y new_item_id requeridos' }, { status: 400 });
    if (oldId === newId) return NextResponse.json({ error: 'old_item_id y new_item_id no pueden ser el mismo' }, { status: 400 });

    const motivo = String(body.motivo ?? '').trim();
    const validMotivos = ['upgrade', 'warranty', 'damage', 'replacement', 'other'];
    if (!validMotivos.includes(motivo)) {
      return NextResponse.json({ error: `motivo debe ser uno de: ${validMotivos.join(', ')}` }, { status: 400 });
    }

    const destStatus = (body.destination_status ?? 'in_stock') as string;
    const validDest = ['in_stock', 'in_repair', 'rma', 'decommissioned'];
    if (!validDest.includes(destStatus)) {
      return NextResponse.json({ error: `destination_status debe ser uno de: ${validDest.join(', ')}` }, { status: 400 });
    }

    const actor = body.actor_email ?? null;
    const visitId = body.related_visit_id ?? null;
    const notes = body.notes ?? null;

    // Cargar ambos items
    const { data: items } = await supabaseAdmin
      .from('inventory_items')
      .select('id, serial_number, status, current_house_id, current_location, category_id, acquired_cost_cop, brand, model')
      .in('id', [oldId, newId]);
    const oldItem = (items ?? []).find((i) => i.id === oldId) as Item | undefined;
    const newItem = (items ?? []).find((i) => i.id === newId) as Item | undefined;

    if (!oldItem) return NextResponse.json({ error: 'old_item_id no encontrado' }, { status: 404 });
    if (!newItem) return NextResponse.json({ error: 'new_item_id no encontrado' }, { status: 404 });
    if (oldItem.status !== 'installed') {
      return NextResponse.json({ error: `El equipo a retirar debe estar 'installed' — actual: ${oldItem.status}` }, { status: 400 });
    }
    if (newItem.status !== 'in_stock') {
      return NextResponse.json({ error: `El equipo de reemplazo debe estar 'in_stock' — actual: ${newItem.status}` }, { status: 400 });
    }

    const houseId = oldItem.current_house_id;
    if (!houseId) return NextResponse.json({ error: 'El equipo a retirar no tiene casa asignada' }, { status: 400 });

    // ─── Operaciones atómicas (mejor esfuerzo: no hay transacciones en supabase-js)
    // Si algo falla a mitad, intentamos compensar.

    // 1. Retirar el viejo
    const { data: oldUpd, error: oldErr } = await supabaseAdmin
      .from('inventory_items')
      .update({
        status: destStatus,
        current_house_id: null,
        current_location: destStatus === 'in_stock' ? 'warehouse'
          : destStatus === 'in_repair' ? 'workshop'
          : destStatus === 'rma' ? 'supplier_rma'
          : null,
      })
      .eq('id', oldId)
      .eq('status', 'installed')                    // guard contra race
      .select('id');
    if (oldErr) throw oldErr;
    if (!oldUpd || oldUpd.length === 0) {
      return NextResponse.json({ error: 'El equipo viejo cambió de estado mientras se procesaba. Recarga y reintenta.' }, { status: 409 });
    }

    // 2. Instalar el nuevo
    const { data: newUpd, error: newErr } = await supabaseAdmin
      .from('inventory_items')
      .update({
        status: 'installed',
        current_house_id: houseId,
        current_location: 'house',
      })
      .eq('id', newId)
      .eq('status', 'in_stock')                     // guard contra race
      .select('id');
    if (newErr) {
      // Compensar: revertir el viejo
      await supabaseAdmin.from('inventory_items')
        .update({ status: 'installed', current_house_id: houseId, current_location: 'house' })
        .eq('id', oldId);
      throw newErr;
    }
    if (!newUpd || newUpd.length === 0) {
      // Otro proceso ya lo reservó/instaló — revertir el viejo
      await supabaseAdmin.from('inventory_items')
        .update({ status: 'installed', current_house_id: houseId, current_location: 'house' })
        .eq('id', oldId);
      return NextResponse.json({ error: 'El equipo nuevo cambió de estado mientras se procesaba. Recarga y reintenta.' }, { status: 409 });
    }

    // 3. Movimientos de auditoría (uninstall + install) compartiendo notes
    const swapNote = `Swap ${motivo}: ${oldItem.serial_number} → ${newItem.serial_number}${notes ? ` · ${notes}` : ''}`;
    await supabaseAdmin.from('inventory_movements').insert([
      {
        item_id: oldId,
        type: 'uninstall',
        from_status: 'installed',
        to_status: destStatus,
        from_location: 'house',
        to_location: destStatus === 'in_stock' ? 'warehouse'
          : destStatus === 'in_repair' ? 'workshop'
          : destStatus === 'rma' ? 'supplier_rma' : null,
        from_house_id: houseId,
        related_visit_id: visitId,
        responsible_email: actor,
        notes: swapNote,
      },
      {
        item_id: newId,
        type: 'install',
        from_status: 'in_stock',
        to_status: 'installed',
        from_location: 'warehouse',
        to_location: 'house',
        to_house_id: houseId,
        related_visit_id: visitId,
        responsible_email: actor,
        notes: swapNote,
      },
    ]);

    // 4. ¿Está vinculado a un proyecto CRM? Si sí, registrar el upgrade y un evento
    const { data: project } = await supabaseAdmin
      .from('crm_projects')
      .select('id')
      .eq('house_id', houseId)
      .maybeSingle();

    let upgradeRecord = null;
    if (project) {
      // Costo neto del upgrade: costo del nuevo - costo del viejo (si ambos tienen precio).
      // Si no, queda null y el usuario lo registra manualmente.
      const newCost = newItem.acquired_cost_cop != null ? Number(newItem.acquired_cost_cop) : null;
      const oldCost = oldItem.acquired_cost_cop != null ? Number(oldItem.acquired_cost_cop) : null;
      const costoNeto = (newCost != null && oldCost != null) ? (newCost - oldCost) : (newCost ?? null);

      const { data: factRec } = await supabaseAdmin
        .from('facturacion_records')
        .select('id')
        .eq('project_id', project.id)
        .maybeSingle();

      const { data: upgrade } = await supabaseAdmin
        .from('facturacion_upgrades')
        .insert({
          project_id: project.id,
          facturacion_record_id: factRec?.id ?? null,
          motivo,
          costo_neto: costoNeto,
          notas: swapNote,
          item_removed_id: oldId,
          item_installed_id: newId,
          created_by: actor,
        })
        .select('*')
        .single();
      upgradeRecord = upgrade;

      await supabaseAdmin.from('crm_project_events').insert({
        project_id: project.id,
        event_type: 'field_update',
        actor_email: actor,
        notes: `Swap ${motivo}: ${oldItem.serial_number} (${oldItem.brand ?? ''} ${oldItem.model ?? ''}) → ${newItem.serial_number} (${newItem.brand ?? ''} ${newItem.model ?? ''})`,
        data: { swap: { motivo, old_item_id: oldId, new_item_id: newId, costo_neto: costoNeto } },
      });
    }

    return NextResponse.json({
      success: true,
      old_item_id: oldId,
      new_item_id: newId,
      house_id: houseId,
      upgrade: upgradeRecord,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}
