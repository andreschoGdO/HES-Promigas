import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

interface RouteContext {
  params: Promise<{ id: string }>;
}

interface ItemInput {
  posicion: number;
  categoria: string;
  codigo_servicio?: string | null;
  descripcion: string;
  cantidad?: number | null;
  unidad?: string | null;
  precio_unitario?: number | null;
  valor_total: number;
}

export async function GET(_request: Request, { params }: RouteContext) {
  const { id } = await params;
  const { data, error } = await supabaseAdmin.from('purchase_order_addendum_items').select('*').eq('addendum_id', id).order('posicion');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ items: data ?? [] });
}

/** PUT — reemplaza todas las líneas de detalle del adicional (mismo patrón que items de la OC). */
export async function PUT(request: Request, { params }: RouteContext) {
  try {
    const { id } = await params;
    const body = await request.json();
    const items = body.items as ItemInput[];
    if (!Array.isArray(items)) return NextResponse.json({ error: '"items" debe ser un array' }, { status: 400 });
    for (const [i, item] of items.entries()) {
      if (!item.categoria || !item.descripcion || !(Number(item.valor_total) >= 0)) {
        return NextResponse.json({ error: `Línea ${i + 1}: categoria, descripcion y valor_total son requeridos` }, { status: 400 });
      }
    }

    const { error: delErr } = await supabaseAdmin.from('purchase_order_addendum_items').delete().eq('addendum_id', id);
    if (delErr) throw delErr;
    if (items.length === 0) return NextResponse.json({ items: [] });

    const rows = items.map((item, i) => ({
      addendum_id: id,
      posicion: item.posicion ?? i + 1,
      categoria: item.categoria,
      codigo_servicio: item.codigo_servicio || null,
      descripcion: item.descripcion,
      cantidad: item.cantidad ?? null,
      unidad: item.unidad || null,
      precio_unitario: item.precio_unitario ?? null,
      valor_total: Number(item.valor_total),
    }));
    const { data, error: insErr } = await supabaseAdmin.from('purchase_order_addendum_items').insert(rows).select('*').order('posicion');
    if (insErr) throw insErr;

    return NextResponse.json({ items: data ?? [] });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}
