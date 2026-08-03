import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, { params }: RouteContext) {
  const { id } = await params;
  const { data, error } = await supabaseAdmin
    .from('purchase_order_addendum_house_assignments')
    .select('*, project:crm_projects(id, title, conjunto, casa_numero)')
    .eq('addendum_id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ assignments: data ?? [] });
}

/**
 * POST — asigna a una casa qué % de este adicional le corresponde, con su
 * propio detalle en texto libre. Valida que la suma de % no pase de 100.
 */
/**
 * Asigna a una casa Detalle + Valor de este adicional (monto directo en $).
 * Se valida que la suma de `valor` asignado no supere el `valor_total` del
 * adicional. Se mantiene `porcentaje` como columna derivada (valor/total×100)
 * por compatibilidad con reportes existentes que ya la leían.
 */
export async function POST(request: Request, { params }: RouteContext) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { project_id, valor, detalle, created_by } = body;

    if (!project_id) return NextResponse.json({ error: 'project_id es requerido' }, { status: 400 });
    const monto = Number(valor);
    if (!(monto > 0)) return NextResponse.json({ error: 'valor debe ser mayor a 0' }, { status: 400 });

    const { data: addendum, error: addErr } = await supabaseAdmin
      .from('purchase_order_addenda')
      .select('valor_total')
      .eq('id', id)
      .single();
    if (addErr) throw addErr;

    const { data: existing, error: exErr } = await supabaseAdmin
      .from('purchase_order_addendum_house_assignments')
      .select('project_id, valor')
      .eq('addendum_id', id);
    if (exErr) throw exErr;

    const otros = (existing ?? []).filter((a) => a.project_id !== project_id);
    const sumaOtros = otros.reduce((sum, a) => sum + Number(a.valor ?? 0), 0);
    if (sumaOtros + monto > Number(addendum.valor_total) + 1e-6) {
      return NextResponse.json({ error: `La suma de valores asignados sería $${(sumaOtros + monto).toLocaleString('es-CO')}, supera el valor del adicional ($${Number(addendum.valor_total).toLocaleString('es-CO')}).` }, { status: 400 });
    }

    const pct = Number(addendum.valor_total) > 0 ? (monto / Number(addendum.valor_total)) * 100 : null;

    const { data, error } = await supabaseAdmin
      .from('purchase_order_addendum_house_assignments')
      .upsert(
        { addendum_id: id, project_id, valor: monto, porcentaje: pct, detalle: detalle || null, created_by: created_by || null },
        { onConflict: 'addendum_id,project_id' },
      )
      .select('*, project:crm_projects(id, title, conjunto, casa_numero)')
      .single();
    if (error) throw error;

    return NextResponse.json({ assignment: data }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}

/** DELETE ?project_id=... */
export async function DELETE(request: Request, { params }: RouteContext) {
  const { id } = await params;
  const url = new URL(request.url);
  const projectId = url.searchParams.get('project_id');
  if (!projectId) return NextResponse.json({ error: 'project_id requerido' }, { status: 400 });

  const { error } = await supabaseAdmin
    .from('purchase_order_addendum_house_assignments')
    .delete()
    .eq('addendum_id', id)
    .eq('project_id', projectId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
