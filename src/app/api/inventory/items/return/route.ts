import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

/**
 * POST /api/inventory/items/return
 *
 * Retira un equipo instalado de una casa SIN reemplazo y lo devuelve a bodega
 * o a otro estado (in_repair, rma). Usado para: cancelaciones, downsizing,
 * errores de instalación.
 *
 * Body:
 *   {
 *     item_id: string;
 *     destination_status: 'in_stock' | 'in_repair' | 'rma';
 *     reason: string;             // texto libre o etiqueta corta
 *     related_visit_id?: string;
 *     actor_email?: string;
 *   }
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const itemId = String(body.item_id ?? '').trim();
    if (!itemId) return NextResponse.json({ error: 'item_id requerido' }, { status: 400 });

    const destStatus = (body.destination_status ?? 'in_stock') as string;
    const validDest = ['in_stock', 'in_repair', 'rma'];
    if (!validDest.includes(destStatus)) {
      return NextResponse.json({ error: `destination_status debe ser uno de: ${validDest.join(', ')}` }, { status: 400 });
    }

    const reason = String(body.reason ?? '').trim();
    const visitId = body.related_visit_id ?? null;
    const actor = body.actor_email ?? null;

    const { data: item } = await supabaseAdmin
      .from('inventory_items')
      .select('id, serial_number, status, current_house_id, brand, model')
      .eq('id', itemId)
      .maybeSingle();
    if (!item) return NextResponse.json({ error: 'item no encontrado' }, { status: 404 });
    if (item.status !== 'installed') {
      return NextResponse.json({ error: `El equipo debe estar 'installed' — actual: ${item.status}` }, { status: 400 });
    }

    const houseId = item.current_house_id;
    const newLocation = destStatus === 'in_stock' ? 'warehouse'
      : destStatus === 'in_repair' ? 'workshop'
      : 'supplier_rma';

    const { data: upd, error: updErr } = await supabaseAdmin
      .from('inventory_items')
      .update({
        status: destStatus,
        current_house_id: null,
        current_location: newLocation,
      })
      .eq('id', itemId)
      .eq('status', 'installed')                    // guard contra race
      .select('id');
    if (updErr) throw updErr;
    if (!upd || upd.length === 0) {
      return NextResponse.json({ error: 'El equipo cambió de estado mientras se procesaba.' }, { status: 409 });
    }

    await supabaseAdmin.from('inventory_movements').insert({
      item_id: itemId,
      type: 'uninstall',
      from_status: 'installed',
      to_status: destStatus,
      from_location: 'house',
      to_location: newLocation,
      from_house_id: houseId,
      related_visit_id: visitId,
      responsible_email: actor,
      notes: `Retirado de campo: ${reason || 'sin motivo especificado'}`,
    });

    // Si está vinculado a un proyecto, registrar upgrade tipo 'cancel' o similar
    if (houseId) {
      const { data: project } = await supabaseAdmin
        .from('crm_projects').select('id').eq('house_id', houseId).maybeSingle();
      if (project) {
        const { data: factRec } = await supabaseAdmin
          .from('facturacion_records').select('id').eq('project_id', project.id).maybeSingle();
        await supabaseAdmin.from('facturacion_upgrades').insert({
          project_id: project.id,
          facturacion_record_id: factRec?.id ?? null,
          motivo: 'cancel',
          costo_neto: null,
          notas: `Retiro sin reemplazo: ${item.serial_number} (${item.brand ?? ''} ${item.model ?? ''}). ${reason}`,
          item_removed_id: itemId,
          created_by: actor,
        });
        await supabaseAdmin.from('crm_project_events').insert({
          project_id: project.id,
          event_type: 'field_update',
          actor_email: actor,
          notes: `Equipo retirado sin reemplazo: ${item.serial_number}. Motivo: ${reason}`,
          data: { return: { item_id: itemId, destination: destStatus, reason } },
        });
      }
    }

    return NextResponse.json({ success: true, item_id: itemId, new_status: destStatus });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}
