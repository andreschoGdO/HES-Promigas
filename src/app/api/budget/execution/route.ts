import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { isExecutedStage, PURCHASE_ORDER_CATEGORIES } from '@/lib/purchase-orders';

/**
 * GET /api/budget/execution?anio=2026
 *
 * Presupuestado vs ejecutado por categoría, agregado — SIN vínculo línea a
 * línea con las OC (decisión tomada: ver plan). "Ejecutado" de una línea de
 * OC/adicional se prorratea con el mismo % ejecutado de su OC (el kWp de
 * las casas ya en instalación+ sobre el kWp total de esa OC), y solo se
 * cuenta si `fecha_documento` de la OC cae en el año consultado.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const anio = Number(url.searchParams.get('anio') ?? new Date().getFullYear());

  const [{ data: budgetItems, error: bErr }, { data: ocs, error: ocErr }, { data: items, error: itErr }, { data: assignments, error: aErr }] = await Promise.all([
    supabaseAdmin.from('budget_items').select('grupo_nombre, precio_total').eq('anio', anio),
    supabaseAdmin.from('purchase_orders').select('id, kwp_total, valor_total, fecha_documento'),
    supabaseAdmin.from('purchase_order_items').select('oc_id, categoria, valor_total'),
    supabaseAdmin.from('purchase_order_house_assignments').select('oc_id, kwp_asignado, project:crm_projects(operations_stage)'),
  ]);
  if (bErr) return NextResponse.json({ error: bErr.message }, { status: 500 });
  if (ocErr) return NextResponse.json({ error: ocErr.message }, { status: 500 });
  if (itErr) return NextResponse.json({ error: itErr.message }, { status: 500 });
  if (aErr) return NextResponse.json({ error: aErr.message }, { status: 500 });

  type Assignment = { oc_id: string; kwp_asignado: number; project: { operations_stage: string | null } | { operations_stage: string | null }[] | null };

  // % ejecutado por OC (mismo cálculo que /api/purchase-orders)
  const pctEjecutadoPorOc = new Map<string, number>();
  for (const oc of ocs ?? []) {
    const anioOc = oc.fecha_documento ? new Date(oc.fecha_documento).getFullYear() : null;
    if (anioOc !== anio) continue; // solo OC del año consultado
    const ocAssignments = ((assignments ?? []) as Assignment[]).filter((a) => a.oc_id === oc.id);
    const kwpEjecutado = ocAssignments.reduce((sum, a) => {
      const stage = Array.isArray(a.project) ? a.project[0]?.operations_stage : a.project?.operations_stage;
      return isExecutedStage(stage) ? sum + Number(a.kwp_asignado) : sum;
    }, 0);
    pctEjecutadoPorOc.set(oc.id, oc.kwp_total > 0 ? kwpEjecutado / oc.kwp_total : 0);
  }

  const ejecutadoPorCategoria = new Map<string, number>();
  for (const item of items ?? []) {
    const pct = pctEjecutadoPorOc.get(item.oc_id);
    if (pct == null) continue; // OC no es del año consultado
    const actual = ejecutadoPorCategoria.get(item.categoria) ?? 0;
    ejecutadoPorCategoria.set(item.categoria, actual + Number(item.valor_total) * pct);
  }

  const presupuestadoPorGrupo = new Map<string, number>();
  for (const bi of budgetItems ?? []) {
    const actual = presupuestadoPorGrupo.get(bi.grupo_nombre) ?? 0;
    presupuestadoPorGrupo.set(bi.grupo_nombre, actual + Number(bi.precio_total ?? 0));
  }

  const grupos = new Set<string>([...PURCHASE_ORDER_CATEGORIES, ...presupuestadoPorGrupo.keys(), ...ejecutadoPorCategoria.keys()]);
  const resultado = Array.from(grupos).map((grupo) => {
    const presupuestado = presupuestadoPorGrupo.get(grupo) ?? 0;
    const ejecutado = ejecutadoPorCategoria.get(grupo) ?? 0;
    return {
      grupo,
      presupuestado,
      ejecutado,
      pct: presupuestado > 0 ? Math.min(999, (ejecutado / presupuestado) * 100) : ejecutado > 0 ? 100 : 0,
    };
  }).filter((r) => r.presupuestado > 0 || r.ejecutado > 0);

  return NextResponse.json({
    anio,
    grupos: resultado,
    totalPresupuestado: resultado.reduce((s, r) => s + r.presupuestado, 0),
    totalEjecutado: resultado.reduce((s, r) => s + r.ejecutado, 0),
  });
}
