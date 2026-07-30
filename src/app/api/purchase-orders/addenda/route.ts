import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

/**
 * GET /api/purchase-orders/addenda?oc_id=...
 * Lista todos los adicionales, o solo los de una OC si se pasa oc_id.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const ocId = url.searchParams.get('oc_id');

  let query = supabaseAdmin
    .from('purchase_order_addenda')
    .select('*, purchaseOrder:purchase_orders(id, numero_oc, valor_total)')
    .order('fecha', { ascending: false });
  if (ocId) query = query.eq('oc_id', ocId);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ addenda: data ?? [] });
}

/**
 * POST /api/purchase-orders/addenda
 * Crea un adicional ("otrosí") vinculado 1:1 a una OC. Valida que la suma
 * de TODOS los adicionales de esa OC (incluyendo este nuevo) no supere el
 * 10% del valor_total de la OC principal.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { oc_id, numero_adicional, fecha, motivo, solicitado_por, aprobado_por, valor_total, created_by } = body;

    if (!oc_id) return NextResponse.json({ error: 'oc_id es requerido' }, { status: 400 });
    if (!numero_adicional) return NextResponse.json({ error: 'numero_adicional es requerido' }, { status: 400 });
    if (!(Number(valor_total) >= 0)) return NextResponse.json({ error: 'valor_total inválido' }, { status: 400 });

    const { data: oc, error: ocErr } = await supabaseAdmin.from('purchase_orders').select('valor_total').eq('id', oc_id).single();
    if (ocErr || !oc) return NextResponse.json({ error: 'Orden de compra no encontrada' }, { status: 404 });

    const { data: existentes, error: exErr } = await supabaseAdmin
      .from('purchase_order_addenda')
      .select('valor_total')
      .eq('oc_id', oc_id);
    if (exErr) throw exErr;

    const yaSumado = (existentes ?? []).reduce((sum, a) => sum + Number(a.valor_total), 0);
    const tope = Number(oc.valor_total) * 0.1;
    if (yaSumado + Number(valor_total) > tope + 1e-6) {
      return NextResponse.json(
        {
          error: `Los adicionales de esta OC sumarían $${(yaSumado + Number(valor_total)).toLocaleString('es-CO')}, que supera el 10% admisible ($${tope.toLocaleString('es-CO')}).`,
        },
        { status: 400 },
      );
    }

    const { data, error } = await supabaseAdmin
      .from('purchase_order_addenda')
      .insert({
        oc_id,
        numero_adicional,
        fecha: fecha || null,
        motivo: motivo || null,
        solicitado_por: solicitado_por || null,
        aprobado_por: aprobado_por || null,
        valor_total: Number(valor_total),
        created_by: created_by || null,
      })
      .select('*')
      .single();

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json({ error: `Ya existe el adicional "${numero_adicional}" para esta OC` }, { status: 409 });
      }
      throw error;
    }

    return NextResponse.json({ addendum: data }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}
