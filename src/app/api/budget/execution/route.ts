import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { isExecutedStage, computeItemExecution, PURCHASE_ORDER_CATEGORIES } from '@/lib/purchase-orders';

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
// Mapea la familia de inventario a la misma categoría/grupo que usan las OC
// y el presupuesto, para poder cruzar "ejecutado" contra equipos realmente
// instalados (no solo contra lo asignado en la OC).
const FAMILY_TO_GRUPO: Record<string, string> = {
  inverter: 'Inversor',
  battery: 'Batería',
  bms: 'BMS',
  meter: 'Medidores',
  gateway: 'Modem',
  panel: 'Paneles',
  other: 'Equipos adicionales',
};

export async function GET(request: Request) {
  const url = new URL(request.url);
  const anio = Number(url.searchParams.get('anio') ?? new Date().getFullYear());

  const [{ data: budgetItems, error: bErr }, { data: ocs, error: ocErr }, { data: items, error: itErr }, { data: assignments, error: aErr }, { data: solutionPrices, error: spErr }, { data: invItems, error: invErr }] = await Promise.all([
    supabaseAdmin.from('budget_items').select('grupo_nombre, precio_total').eq('anio', anio),
    supabaseAdmin.from('purchase_orders').select('id, kwp_total, valor_total, fecha_documento'),
    supabaseAdmin.from('purchase_order_items').select('oc_id, categoria, valor_total'),
    supabaseAdmin.from('purchase_order_house_assignments').select('oc_id, kwp_asignado, monto_fijo, solucion, project:crm_projects(operations_stage)'),
    supabaseAdmin.from('purchase_order_solution_prices').select('oc_id, solucion, precio_kwp'),
    supabaseAdmin.from('inventory_items')
      .select('acquired_cost_cop, acquired_at, category:inventory_categories(family, default_cost_cop)')
      .eq('status', 'installed'),
  ]);
  if (bErr) return NextResponse.json({ error: bErr.message }, { status: 500 });
  if (ocErr) return NextResponse.json({ error: ocErr.message }, { status: 500 });
  if (itErr) return NextResponse.json({ error: itErr.message }, { status: 500 });
  if (aErr) return NextResponse.json({ error: aErr.message }, { status: 500 });
  if (spErr) return NextResponse.json({ error: spErr.message }, { status: 500 });
  if (invErr) return NextResponse.json({ error: invErr.message }, { status: 500 });

  // Ejecutado según inventario real (equipos con status 'installed'),
  // agregado por grupo — sirve para verificar que "lo ejecutado" en las OC
  // cierre contra los equipos que efectivamente salieron a instalar.
  type InvItem = { acquired_cost_cop: number | null; acquired_at: string | null; category: { family: string; default_cost_cop: number | null } | { family: string; default_cost_cop: number | null }[] | null };
  const ejecutadoInventarioPorGrupo = new Map<string, number>();
  for (const it of (invItems ?? []) as InvItem[]) {
    if (it.acquired_at && new Date(it.acquired_at).getFullYear() !== anio) continue;
    const cat = Array.isArray(it.category) ? it.category[0] : it.category;
    if (!cat) continue;
    const grupo = FAMILY_TO_GRUPO[cat.family];
    if (!grupo) continue;
    const costo = Number(it.acquired_cost_cop ?? cat.default_cost_cop ?? 0);
    ejecutadoInventarioPorGrupo.set(grupo, (ejecutadoInventarioPorGrupo.get(grupo) ?? 0) + costo);
  }

  type Assignment = { oc_id: string; kwp_asignado: number | null; monto_fijo: number | null; solucion: number | null; project: { operations_stage: string | null } | { operations_stage: string | null }[] | null };

  const ejecutadoPorCategoria = new Map<string, number>();

  for (const oc of ocs ?? []) {
    const anioOc = oc.fecha_documento ? new Date(oc.fecha_documento).getFullYear() : null;
    if (anioOc !== anio) continue; // solo OC del año consultado

    const ocItems = (items ?? []).filter((i) => i.oc_id === oc.id);
    const ocSolutionPrices = (solutionPrices ?? []).filter((sp) => sp.oc_id === oc.id);
    const ocAssignments = ((assignments ?? []) as Assignment[]).filter((a) => a.oc_id === oc.id);
    const executionAssignments = ocAssignments.map((a) => {
      const stage = Array.isArray(a.project) ? a.project[0]?.operations_stage : a.project?.operations_stage;
      return { kwp_asignado: a.kwp_asignado, monto_fijo: a.monto_fijo, solucion: a.solucion, executed: isExecutedStage(stage) };
    });

    // Misma prorrata por línea que usa /api/purchase-orders — una sola
    // fuente de verdad para que ambas pantallas cuadren entre sí.
    const { items: itemsWithExecution } = computeItemExecution(ocItems, oc.kwp_total, executionAssignments, ocSolutionPrices);
    for (const item of itemsWithExecution) {
      const actual = ejecutadoPorCategoria.get(item.categoria) ?? 0;
      ejecutadoPorCategoria.set(item.categoria, actual + item.costo_ejecutado);
    }
  }

  const presupuestadoPorGrupo = new Map<string, number>();
  for (const bi of budgetItems ?? []) {
    const actual = presupuestadoPorGrupo.get(bi.grupo_nombre) ?? 0;
    presupuestadoPorGrupo.set(bi.grupo_nombre, actual + Number(bi.precio_total ?? 0));
  }

  const grupos = new Set<string>([...PURCHASE_ORDER_CATEGORIES, ...presupuestadoPorGrupo.keys(), ...ejecutadoPorCategoria.keys(), ...ejecutadoInventarioPorGrupo.keys()]);
  const resultado = Array.from(grupos).map((grupo) => {
    const presupuestado = presupuestadoPorGrupo.get(grupo) ?? 0;
    const ejecutado = ejecutadoPorCategoria.get(grupo) ?? 0;
    const pendiente = Math.max(0, presupuestado - ejecutado);
    const ejecutadoInventario = ejecutadoInventarioPorGrupo.get(grupo) ?? 0;
    return {
      grupo,
      presupuestado,
      ejecutado,
      pendiente,
      pctPendiente: presupuestado > 0 ? Math.max(0, 100 - (ejecutado / presupuestado) * 100) : 0,
      pct: presupuestado > 0 ? Math.min(999, (ejecutado / presupuestado) * 100) : ejecutado > 0 ? 100 : 0,
      ejecutadoInventario,
      diferenciaInventario: ejecutado - ejecutadoInventario,
    };
  }).filter((r) => r.presupuestado > 0 || r.ejecutado > 0 || r.ejecutadoInventario > 0);

  return NextResponse.json({
    anio,
    grupos: resultado,
    totalPresupuestado: resultado.reduce((s, r) => s + r.presupuestado, 0),
    totalEjecutado: resultado.reduce((s, r) => s + r.ejecutado, 0),
  });
}
