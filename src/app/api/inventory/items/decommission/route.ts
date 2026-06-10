import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

/**
 * POST /api/inventory/items/decommission
 *
 * Da de baja DEFINITIVA un equipo (fin de vida útil, pérdida total, daño
 * irrecuperable). El item queda con status='decommissioned' y ya no aparece
 * disponible. NO se borra — queda para histórico.
 *
 * Body:
 *   {
 *     item_id: string;
 *     reason: string;
 *     actor_email?: string;
 *   }
 *
 * Acepta items en cualquier estado activo y los pasa a decommissioned.
 * Si estaba 'installed' y vinculado a un proyecto, registra el upgrade y evento.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const itemId = String(body.item_id ?? '').trim();
    if (!itemId) return NextResponse.json({ error: 'item_id requerido' }, { status: 400 });
    const reason = String(body.reason ?? '').trim();
    const actor = body.actor_email ?? null;

    const { data: item } = await supabaseAdmin
      .from('inventory_items')
      .select('id, serial_number, status, current_house_id, brand, model')
      .eq('id', itemId)
      .maybeSingle();
    if (!item) return NextResponse.json({ error: 'item no encontrado' }, { status: 404 });
    if (item.status === 'decommissioned') {
      return NextResponse.json({ error: 'El equipo ya está decomisado' }, { status: 400 });
    }

    const wasInstalled = item.status === 'installed';
    const houseId = item.current_house_id;

    const { error: updErr } = await supabaseAdmin
      .from('inventory_items')
      .update({
        status: 'decommissioned',
        current_house_id: null,
        current_location: 'decommissioned',
      })
      .eq('id', itemId);
    if (updErr) throw updErr;

    await supabaseAdmin.from('inventory_movements').insert({
      item_id: itemId,
      type: 'decommission',
      from_status: item.status,
      to_status: 'decommissioned',
      from_house_id: wasInstalled ? houseId : null,
      responsible_email: actor,
      notes: `Decomisado: ${reason || 'fin de vida útil'}`,
    });

    if (wasInstalled && houseId) {
      const { data: project } = await supabaseAdmin
        .from('crm_projects').select('id').eq('house_id', houseId).maybeSingle();
      if (project) {
        const { data: factRec } = await supabaseAdmin
          .from('facturacion_records').select('id').eq('project_id', project.id).maybeSingle();
        await supabaseAdmin.from('facturacion_upgrades').insert({
          project_id: project.id,
          facturacion_record_id: factRec?.id ?? null,
          motivo: 'other',
          costo_neto: null,
          notas: `Decomisión: ${item.serial_number} (${item.brand ?? ''} ${item.model ?? ''}). ${reason}`,
          item_removed_id: itemId,
          created_by: actor,
        });
        await supabaseAdmin.from('crm_project_events').insert({
          project_id: project.id,
          event_type: 'field_update',
          actor_email: actor,
          notes: `Equipo decomisado: ${item.serial_number}. Motivo: ${reason}`,
        });
      }
    }

    return NextResponse.json({ success: true, item_id: itemId });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}
