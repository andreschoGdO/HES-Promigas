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

  const [
    { data: budgetItems, error: bErr }, { data: ocs, error: ocErr }, { data: items, error: itErr },
    { data: assignments, error: aErr }, { data: solutionPrices, error: spErr }, { data: invItems, error: invErr },
    { data: addenda, error: adErr }, { data: addendumItems, error: aiErr }, { data: addendumAssignments, error: aaErr },
  ] = await Promise.all([
    supabaseAdmin.from('budget_items').select('grupo_nombre, precio_total').eq('anio', anio),
    supabaseAdmin.from('purchase_orders').select('id, kwp_total, valor_total, fecha_documento'),
    supabaseAdmin.from('purchase_order_items').select('oc_id, categoria, valor_total'),
    supabaseAdmin.from('purchase_order_house_assignments').select('oc_id, kwp_asignado, monto_fijo, solucion, project:crm_projects(operations_stage)'),
    supabaseAdmin.from('purchase_order_solution_prices').select('oc_id, solucion, precio_kwp'),
    supabaseAdmin.from('inventory_items')
      .select('acquired_cost_cop, acquired_at, category:inventory_categories(family, default_cost_cop)')
      .eq('status', 'installed'),
    supabaseAdmin.from('purchase_order_addenda').select('id, fecha, valor_total'),
    supabaseAdmin.from('purchase_order_addendum_items').select('addendum_id, categoria, valor_total'),
    supabaseAdmin.from('purchase_order_addendum_house_assignments').select('addendum_id, valor, porcentaje, project:crm_projects(operations_stage)'),
  ]);
  if (bErr) return NextResponse.json({ error: bErr.message }, { status: 500 });
  if (ocErr) return NextResponse.json({ error: ocErr.message }, { status: 500 });
  if (itErr) return NextResponse.json({ error: itErr.message }, { status: 500 });
  if (aErr) return NextResponse.json({ error: aErr.message }, { status: 500 });
  if (spErr) return NextResponse.json({ error: spErr.message }, { status: 500 });
  if (invErr) return NextResponse.json({ error: invErr.message }, { status: 500 });
  if (adErr) return NextResponse.json({ error: adErr.message }, { status: 500 });
  if (aiErr) return NextResponse.json({ error: aiErr.message }, { status: 500 });
  if (aaErr) return NextResponse.json({ error: aaErr.message }, { status: 500 });

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

  // Adicionales (otrosí) ejecutados — antes NO se sumaban acá, así que
  // "ejecutado" quedaba corto respecto a lo que sí se ve en /ordenes-compra
  // (columna "Adicionales"). Un adicional puede tener líneas de varias
  // categorías (igual que una OC); el $ asignado a una casa se reparte
  // entre esas categorías proporcional al peso de cada línea, y solo cuenta
  // como ejecutado si la casa ya está en instalación+ (mismo criterio).
  type AddendumAssignment = { addendum_id: string; valor: number | null; porcentaje: number | null; project: { operations_stage: string | null } | { operations_stage: string | null }[] | null };
  const addendaById = new Map((addenda ?? []).map((a) => [a.id, a]));
  const shareByAddendum = new Map<string, Array<{ categoria: string; share: number }>>();
  for (const addendumId of new Set((addendumItems ?? []).map((i) => i.addendum_id))) {
    const its = (addendumItems ?? []).filter((i) => i.addendum_id === addendumId);
    const total = its.reduce((s, i) => s + Number(i.valor_total), 0);
    shareByAddendum.set(addendumId, its.map((i) => ({ categoria: i.categoria, share: total > 0 ? Number(i.valor_total) / total : 0 })));
  }

  for (const asg of ((addendumAssignments ?? []) as AddendumAssignment[])) {
    const stage = Array.isArray(asg.project) ? asg.project[0]?.operations_stage : asg.project?.operations_stage;
    if (!isExecutedStage(stage)) continue;
    const addendum = addendaById.get(asg.addendum_id);
    if (!addendum) continue;
    const anioAdd = addendum.fecha ? new Date(addendum.fecha).getFullYear() : null;
    if (anioAdd !== anio) continue;

    const valor = asg.valor != null ? Number(asg.valor) : asg.porcentaje != null ? Number(addendum.valor_total) * (Number(asg.porcentaje) / 100) : 0;
    if (valor <= 0) continue;

    const shares = shareByAddendum.get(asg.addendum_id) ?? [];
    if (shares.length === 0) continue; // adicional sin líneas de detalle — no sabemos a qué categoría atribuirlo
    for (const s of shares) {
      const actual = ejecutadoPorCategoria.get(s.categoria) ?? 0;
      ejecutadoPorCategoria.set(s.categoria, actual + valor * s.share);
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
