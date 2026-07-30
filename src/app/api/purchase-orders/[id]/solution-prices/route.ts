import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

interface RouteContext {
  params: Promise<{ id: string }>;
}

interface SolutionPriceInput {
  solucion: number | null;
  precio_kwp: number;
}

export async function GET(_request: Request, { params }: RouteContext) {
  const { id } = await params;
  const { data, error } = await supabaseAdmin.from('purchase_order_solution_prices').select('*').eq('oc_id', id).order('solucion');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ solutionPrices: data ?? [] });
}

/**
 * PUT /api/purchase-orders/[id]/solution-prices
 * Reemplaza toda la tabla de precios por solución de la OC. Mandar
 * `solucion: null` para un precio único (sin diferenciar por tier).
 */
export async function PUT(request: Request, { params }: RouteContext) {
  try {
    const { id } = await params;
    const body = await request.json();
    const prices = body.solutionPrices as SolutionPriceInput[];
    if (!Array.isArray(prices)) {
      return NextResponse.json({ error: '"solutionPrices" debe ser un array' }, { status: 400 });
    }
    for (const [i, p] of prices.entries()) {
      if (p.solucion != null && (p.solucion < 1 || p.solucion > 4)) {
        return NextResponse.json({ error: `Fila ${i + 1}: solucion debe ser 1-4 o null` }, { status: 400 });
      }
      if (!(Number(p.precio_kwp) >= 0)) {
        return NextResponse.json({ error: `Fila ${i + 1}: precio_kwp inválido` }, { status: 400 });
      }
    }

    const { error: delErr } = await supabaseAdmin.from('purchase_order_solution_prices').delete().eq('oc_id', id);
    if (delErr) throw delErr;

    if (prices.length === 0) return NextResponse.json({ solutionPrices: [] });

    const rows = prices.map((p) => ({ oc_id: id, solucion: p.solucion, precio_kwp: Number(p.precio_kwp) }));
    const { data, error: insErr } = await supabaseAdmin.from('purchase_order_solution_prices').insert(rows).select('*').order('solucion');
    if (insErr) throw insErr;

    return NextResponse.json({ solutionPrices: data ?? [] });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}
