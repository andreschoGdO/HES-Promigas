import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

interface Ctx { params: Promise<{ id: string }>; }

/**
 * POST /api/inventory/reservations/[id]/consumables
 * Body: { lines: Array<{ consumable_id: string; quantity: number }> }
 *
 * Setea las líneas de consumibles para una reserva en draft. Reemplaza la
 * lista completa (delete-then-insert) para que el frontend pueda hacer un
 * único POST con el estado final, sin tener que llevar diffs.
 *
 * NO toca stock_quantity — el descuento se hace al CONFIRMAR la reserva
 * (en /api/inventory/reservations PATCH action=confirm).
 */
export async function POST(request: Request, context: Ctx) {
  try {
    const { id } = await context.params;
    const body = await request.json();
    if (!Array.isArray(body.lines)) {
      return NextResponse.json({ error: 'lines requerido' }, { status: 400 });
    }

    const { data: resv } = await supabaseAdmin
      .from('inventory_reservations')
      .select('status')
      .eq('id', id)
      .single();
    if (!resv) return NextResponse.json({ error: 'Reserva no encontrada' }, { status: 404 });
    if (resv.status !== 'draft') {
      return NextResponse.json({ error: 'Solo se pueden modificar reservas en draft' }, { status: 400 });
    }

    // Validar y normalizar líneas
    type Line = { consumable_id: string; quantity: number };
    const lines: Line[] = [];
    for (const raw of body.lines as Array<{ consumable_id?: string; quantity?: number | string }>) {
      const cid = String(raw.consumable_id ?? '').trim();
      const qty = Number(raw.quantity);
      if (!cid || !Number.isFinite(qty) || qty <= 0) continue;
      lines.push({ consumable_id: cid, quantity: qty });
    }

    // Replace: borrar las existentes e insertar las nuevas
    await supabaseAdmin.from('inventory_reservation_consumables').delete().eq('reservation_id', id);

    if (lines.length === 0) return NextResponse.json({ added: 0 });

    const { data, error } = await supabaseAdmin
      .from('inventory_reservation_consumables')
      .insert(lines.map((l) => ({ reservation_id: id, ...l })))
      .select('*');
    if (error) throw error;
    return NextResponse.json({ added: data?.length ?? 0 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}

/**
 * GET /api/inventory/reservations/[id]/consumables
 * Devuelve las líneas de consumibles con el detalle del consumible.
 */
export async function GET(_request: Request, context: Ctx) {
  const { id } = await context.params;
  const { data, error } = await supabaseAdmin
    .from('inventory_reservation_consumables')
    .select('id, quantity, fulfilled_at, consumable_id, inventory_consumables(id, name, sku, unit, stock_quantity, cost_per_unit_cop)')
    .eq('reservation_id', id);
  if (error) {
    // Si la tabla no existe todavía (migration 23 pendiente), devolvemos vacío.
    if (/inventory_reservation_consumables|schema cache|does not exist/i.test(error.message)) {
      return NextResponse.json({ lines: [] });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ lines: data ?? [] });
}
