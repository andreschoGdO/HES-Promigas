import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

interface Ctx { params: Promise<{ id: string }>; }

export async function GET(_request: Request, context: Ctx) {
  const { id } = await context.params;
  const { data, error } = await supabaseAdmin
    .from('inventory_items')
    .select('*, inventory_categories(*), client_houses(casa), devices(name, casa)')
    .eq('id', id)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 404 });

  const { data: movements } = await supabaseAdmin
    .from('inventory_movements')
    .select('*, client_houses!from_house_id(casa), client_houses_to:client_houses!to_house_id(casa), field_visits(visit_type, casa)')
    .eq('item_id', id)
    .order('created_at', { ascending: false });

  return NextResponse.json({ item: data, movements });
}

/**
 * PATCH /api/inventory/items/[id]
 * Cualquier cambio de estado/locación queda en inventory_movements.
 */
export async function PATCH(request: Request, context: Ctx) {
  try {
    const { id } = await context.params;
    const body = await request.json();

    // Obtener estado actual para el log
    const { data: current } = await supabaseAdmin.from('inventory_items').select('*').eq('id', id).single();
    if (!current) return NextResponse.json({ error: 'No encontrado' }, { status: 404 });

    const updates = { ...body };
    delete updates.id;
    delete updates.serial_number;  // no permitimos cambiar serial
    // Campos que solo viven en inventory_movements, no en inventory_items:
    delete updates.responsible_email;
    delete updates.movement_notes;
    delete updates.related_visit_id;

    const { data, error } = await supabaseAdmin.from('inventory_items').update(updates).eq('id', id).select('*').single();
    if (error) throw error;

    // Si hubo cambio de estado o ubicación, registrar movimiento
    const statusChanged = updates.status && updates.status !== current.status;
    const locationChanged = (updates.current_location && updates.current_location !== current.current_location) ||
                            (updates.current_house_id !== undefined && updates.current_house_id !== current.current_house_id);
    if (statusChanged || locationChanged) {
      const movementType = updates.status === 'installed' ? 'install'
        : updates.status === 'in_repair' ? 'repair_start'
        : updates.status === 'rma' ? 'rma_send'
        : updates.status === 'decommissioned' ? 'decommission'
        : updates.status === 'in_stock' && current.status === 'in_repair' ? 'repair_end'
        : updates.status === 'in_stock' && current.status === 'rma' ? 'rma_return'
        : locationChanged ? 'transfer'
        : 'adjust_quantity';
      await supabaseAdmin.from('inventory_movements').insert({
        item_id: id,
        type: movementType,
        from_status: current.status,
        to_status: data.status,
        from_location: current.current_location,
        to_location: data.current_location,
        from_house_id: current.current_house_id,
        to_house_id: data.current_house_id,
        related_visit_id: body.related_visit_id ?? null,
        responsible_email: body.responsible_email ?? null,
        notes: body.movement_notes ?? null,
      });
    }

    return NextResponse.json({ item: data });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}

export async function DELETE(_request: Request, context: Ctx) {
  const { id } = await context.params;
  const { error } = await supabaseAdmin.from('inventory_items').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
