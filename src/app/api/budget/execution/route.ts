import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { isExecutedStage, computeOcPricing, resolvePrecioKwp, PURCHASE_ORDER_CATEGORIES, CONSTRUCTION_CATEGORIES } from '@/lib/purchase-orders';

const CONSTRUCTION_SET = new Set(CONSTRUCTION_CATEGORIES);

/**
 * GET /api/budget/execution?anio=2026
 *
 * Presupuestado vs ejecutado por categoría, agregado — SIN vínculo línea a
 * línea con las OC (ver plan). Por cada OC del año consultado:
 *   - la porción "construcción" ejecutada (kWp de casas en instalación+
 *     × $/kWp de esa OC) se reparte entre sus líneas de construcción,
 *     proporcional al peso de cada línea;
 *   - la porción "otro tema" ejecutada (monto_fijo de casas en
 *     instalación+) se reparte entre sus líneas de otro tema, igual.
 * Así una OC mixta (ej. mano de obra + medidores, ver Estruccon
 * 4200028778) no infla "Medidores" con el % de avance de la construcción.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const anio = Number(url.searchParams.get('anio') ?? new Date().getFullYear());

  const [{ data: budgetItems, error: bErr }, { data: ocs, error: ocErr }, { data: items, error: itErr }, { data: assignments, error: aErr }, { data: solutionPrices, error: spErr }] = await Promise.all([
    supabaseAdmin.from('budget_items').select('grupo_nombre, precio_total').eq('anio', anio),
    supabaseAdmin.from('purchase_orders').select('id, kwp_total, valor_total, fecha_documento'),
    supabaseAdmin.from('purchase_order_items').select('oc_id, categoria, valor_total'),
    supabaseAdmin.from('purchase_order_house_assignments').select('oc_id, kwp_asignado, monto_fijo, solucion, project:crm_projects(operations_stage)'),
    supabaseAdmin.from('purchase_order_solution_prices').select('oc_id, solucion, precio_kwp'),
  ]);
  if (bErr) return NextResponse.json({ error: bErr.message }, { status: 500 });
  if (ocErr) return NextResponse.json({ error: ocErr.message }, { status: 500 });
  if (itErr) return NextResponse.json({ error: itErr.message }, { status: 500 });
  if (aErr) return NextResponse.json({ error: aErr.message }, { status: 500 });
  if (spErr) return NextResponse.json({ error: spErr.message }, { status: 500 });

  type Assignment = { oc_id: string; kwp_asignado: number | null; monto_fijo: number | null; solucion: number | null; project: { operations_stage: string | null } | { operations_stage: string | null }[] | null };

  const ejecutadoPorCategoria = new Map<string, number>();

  for (const oc of ocs ?? []) {
    const anioOc = oc.fecha_documento ? new Date(oc.fecha_documento).getFullYear() : null;
    if (anioOc !== anio) continue; // solo OC del año consultado

    const ocItems = (items ?? []).filter((i) => i.oc_id === oc.id);
    const { precioKwpConstruccion, construccionSubtotal, flatSubtotal } = computeOcPricing(ocItems, oc.kwp_total);
    const ocSolutionPrices = (solutionPrices ?? []).filter((sp) => sp.oc_id === oc.id);

    const ocAssignments = ((assignments ?? []) as Assignment[]).filter((a) => a.oc_id === oc.id);
    let costoConstruccionEjecutado = 0;
    let costoFlatEjecutado = 0;
    for (const a of ocAssignments) {
      const stage = Array.isArray(a.project) ? a.project[0]?.operations_stage : a.project?.operations_stage;
      if (!isExecutedStage(stage)) continue;
      const precio = resolvePrecioKwp(a.solucion, ocSolutionPrices, precioKwpConstruccion);
      costoConstruccionEjecutado += Number(a.kwp_asignado ?? 0) * precio;
      costoFlatEjecutado += Number(a.monto_fijo ?? 0);
    }

    for (const item of ocItems) {
      const esConstruccion = CONSTRUCTION_SET.has(item.categoria);
      const share = esConstruccion
        ? (construccionSubtotal > 0 ? Number(item.valor_total) / construccionSubtotal : 0)
        : (flatSubtotal > 0 ? Number(item.valor_total) / flatSubtotal : 0);
      const costoEjecutadoOc = esConstruccion ? costoConstruccionEjecutado : costoFlatEjecutado;
      const actual = ejecutadoPorCategoria.get(item.categoria) ?? 0;
      ejecutadoPorCategoria.set(item.categoria, actual + costoEjecutadoOc * share);
    }
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
