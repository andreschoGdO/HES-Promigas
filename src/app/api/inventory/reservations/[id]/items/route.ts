import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

interface Ctx { params: Promise<{ id: string }>; }

/**
 * POST /api/inventory/reservations/[id]/items
 * Body: { item_ids: string[] }
 * Agrega items a la reserva. Solo permitido si está en draft.
 */
export async function POST(request: Request, context: Ctx) {
  try {
    const { id } = await context.params;
    const body = await request.json();
    if (!Array.isArray(body.item_ids) || body.item_ids.length === 0) {
      return NextResponse.json({ error: 'item_ids requerido' }, { status: 400 });
    }
    const { data: resv } = await supabaseAdmin.from('inventory_reservations').select('status').eq('id', id).single();
    if (!resv) return NextResponse.json({ error: 'Reserva no encontrada' }, { status: 404 });
    if (resv.status !== 'draft') {
      return NextResponse.json({ error: 'Solo se pueden modificar reservas en draft' }, { status: 400 });
    }

    const rows = body.item_ids.map((itemId: string) => ({ reservation_id: id, item_id: itemId }));
    // Upsert para tolerar duplicados (unique constraint)
    const { data, error } = await supabaseAdmin
      .from('inventory_reservation_items')
      .upsert(rows, { onConflict: 'reservation_id,item_id', ignoreDuplicates: true })
      .select('*');
    if (error) throw error;
    return NextResponse.json({ added: data?.length ?? 0 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}

/**
 * DELETE /api/inventory/reservations/[id]/items?item_id=...
 * Quita un item de la reserva. Solo permitido si está en draft.
 */
export async function DELETE(request: Request, context: Ctx) {
  try {
    const { id } = await context.params;
    const url = new URL(request.url);
    const itemId = url.searchParams.get('item_id');
    if (!itemId) return NextResponse.json({ error: 'item_id requerido' }, { status: 400 });

    const { data: resv } = await supabaseAdmin.from('inventory_reservations').select('status').eq('id', id).single();
    if (!resv) return NextResponse.json({ error: 'Reserva no encontrada' }, { status: 404 });
    if (resv.status !== 'draft') {
      return NextResponse.json({ error: 'Solo se pueden modificar reservas en draft' }, { status: 400 });
    }

    const { error } = await supabaseAdmin
      .from('inventory_reservation_items')
      .delete()
      .eq('reservation_id', id)
      .eq('item_id', itemId);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}
