import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { isExecutedStage, computeOcPricing, computeAssignmentCost, resolvePrecioKwp } from '@/lib/purchase-orders';

/**
 * GET /api/purchase-orders/by-house
 * Desglose por casa: qué OC(s) y adicionales la financian, y el costo
 * total (mismo cálculo de precio por kWp de construcción que
 * /api/purchase-orders, más monto_fijo de las líneas de "otro tema").
 * Usado por el drill-down de Dash Constructivo.
 */
export async function GET() {
  const [{ data: assignments, error: aErr }, { data: ocs, error: ocErr }, { data: items, error: itErr }, { data: solutionPrices, error: spErr }, { data: addendaAssignments, error: adaErr }, { data: addenda, error: adErr }] = await Promise.all([
    supabaseAdmin
      .from('purchase_order_house_assignments')
      .select('oc_id, project_id, kwp_asignado, monto_fijo, solucion, project:crm_projects(id, title, conjunto, casa_numero, operations_stage)'),
    supabaseAdmin.from('purchase_orders').select('id, numero_oc, kwp_total, valor_total'),
    supabaseAdmin.from('purchase_order_items').select('oc_id, categoria, valor_total'),
    supabaseAdmin.from('purchase_order_solution_prices').select('oc_id, solucion, precio_kwp'),
    supabaseAdmin.from('purchase_order_addendum_house_assignments').select('addendum_id, project_id, porcentaje'),
    supabaseAdmin.from('purchase_order_addenda').select('id, numero_adicional, valor_total'),
  ]);
  if (aErr) return NextResponse.json({ error: aErr.message }, { status: 500 });
  if (ocErr) return NextResponse.json({ error: ocErr.message }, { status: 500 });
  if (itErr) return NextResponse.json({ error: itErr.message }, { status: 500 });
  if (spErr) return NextResponse.json({ error: spErr.message }, { status: 500 });
  if (adaErr) return NextResponse.json({ error: adaErr.message }, { status: 500 });
  if (adErr) return NextResponse.json({ error: adErr.message }, { status: 500 });

  const ocById = new Map((ocs ?? []).map((o) => [o.id, o]));
  const addendumById = new Map((addenda ?? []).map((a) => [a.id, a]));
  const precioKwpByOc = new Map<string, number>();
  for (const oc of ocs ?? []) {
    const ocItems = (items ?? []).filter((i) => i.oc_id === oc.id);
    precioKwpByOc.set(oc.id, computeOcPricing(ocItems, oc.kwp_total).precioKwpConstruccion);
  }

  type Row = { project: { id: string; title: string; conjunto: string | null; casa_numero: string | null; operations_stage: string | null } | { id: string; title: string; conjunto: string | null; casa_numero: string | null; operations_stage: string | null }[] | null; oc_id: string; kwp_asignado: number | null; monto_fijo: number | null; solucion: number | null };

  const byHouse = new Map<string, { casa: string; ocs: string[]; adicionales: string[]; costoTotal: number; ejecutado: boolean }>();

  for (const row of (assignments ?? []) as Row[]) {
    const project = Array.isArray(row.project) ? row.project[0] : row.project;
    if (!project) continue;
    const oc = ocById.get(row.oc_id);
    if (!oc) continue;
    const casaLabel = project.conjunto ? `${project.title} — ${project.conjunto} #${project.casa_numero ?? ''}` : project.title;
    const precioKwpConstruccion = precioKwpByOc.get(row.oc_id) ?? 0;
    const ocSolutionPrices = (solutionPrices ?? []).filter((sp) => sp.oc_id === row.oc_id);
    const precio = resolvePrecioKwp(row.solucion, ocSolutionPrices, precioKwpConstruccion);
    const entry = byHouse.get(project.id) ?? { casa: casaLabel, ocs: [], adicionales: [], costoTotal: 0, ejecutado: false };
    entry.ocs.push(oc.numero_oc);
    entry.costoTotal += computeAssignmentCost(row.kwp_asignado, row.monto_fijo, precio);
    entry.ejecutado = entry.ejecutado || isExecutedStage(project.operations_stage);
    byHouse.set(project.id, entry);
  }

  for (const row of addendaAssignments ?? []) {
    const addendum = addendumById.get(row.addendum_id);
    if (!addendum) continue;
    const entry = byHouse.get(row.project_id);
    if (!entry) continue; // adicional de una casa no asignada a la OC principal — no debería pasar, se ignora
    entry.adicionales.push(addendum.numero_adicional);
    entry.costoTotal += Number(addendum.valor_total) * (Number(row.porcentaje) / 100);
  }

  return NextResponse.json({
    houses: Array.from(byHouse.values()).map((h) => ({
      casa: h.casa,
      ocs: Array.from(new Set(h.ocs)),
      adicionales: Array.from(new Set(h.adicionales)),
      costoTotal: h.costoTotal,
      ejecutado: h.ejecutado,
    })),
  });
}
