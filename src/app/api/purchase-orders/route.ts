import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { isExecutedStage, computeOcPricing, computeAssignmentCost, resolvePrecioKwp } from '@/lib/purchase-orders';

/**
 * GET /api/purchase-orders
 * Lista todas las OC con agregados calculados al vuelo (nunca guardados):
 * kwp_asignado, pct_kwp_asignado, costo_ejecutado, costo_no_ejecutado,
 * casas_count, tiene_adicionales.
 *
 * El $/kWp de cada OC se deriva SOLO de sus líneas de "construcción" (ver
 * computeOcPricing) — una OC puede mezclar líneas de construcción con
 * líneas de otro tema (ej. medidores), y esas no se prorratean por kWp.
 */
export async function GET() {
  const [{ data: ocs, error: ocErr }, { data: items, error: itErr }, { data: assignments, error: aErr }, { data: addenda, error: adErr }, { data: solutionPrices, error: spErr }] = await Promise.all([
    supabaseAdmin.from('purchase_orders').select('*').order('fecha_documento', { ascending: false }),
    supabaseAdmin.from('purchase_order_items').select('*').order('posicion'),
    supabaseAdmin
      .from('purchase_order_house_assignments')
      .select('oc_id, project_id, kwp_asignado, monto_fijo, solucion, project:crm_projects(operations_stage)'),
    supabaseAdmin.from('purchase_order_addenda').select('id, oc_id'),
    supabaseAdmin.from('purchase_order_solution_prices').select('oc_id, solucion, precio_kwp'),
  ]);
  if (ocErr) return NextResponse.json({ error: ocErr.message }, { status: 500 });
  if (itErr) return NextResponse.json({ error: itErr.message }, { status: 500 });
  if (aErr) return NextResponse.json({ error: aErr.message }, { status: 500 });
  if (adErr) return NextResponse.json({ error: adErr.message }, { status: 500 });
  if (spErr) return NextResponse.json({ error: spErr.message }, { status: 500 });

  type AssignmentRow = { oc_id: string; project_id: string; kwp_asignado: number | null; monto_fijo: number | null; solucion: number | null; project: { operations_stage: string | null } | { operations_stage: string | null }[] | null };

  const addendaCountByOc = new Map<string, number>();
  for (const row of addenda ?? []) {
    addendaCountByOc.set(row.oc_id, (addendaCountByOc.get(row.oc_id) ?? 0) + 1);
  }

  const enriched = (ocs ?? []).map((oc) => {
    const ocItems = (items ?? []).filter((i) => i.oc_id === oc.id);
    const { precioKwpConstruccion } = computeOcPricing(ocItems, oc.kwp_total);
    const ocSolutionPrices = (solutionPrices ?? []).filter((sp) => sp.oc_id === oc.id);
    const ocAssignments = ((assignments ?? []) as AssignmentRow[]).filter((a) => a.oc_id === oc.id);
    const kwpAsignado = ocAssignments.reduce((sum, a) => sum + Number(a.kwp_asignado ?? 0), 0);

    let costoEjecutado = 0;
    for (const a of ocAssignments) {
      const stage = Array.isArray(a.project) ? a.project[0]?.operations_stage : a.project?.operations_stage;
      if (isExecutedStage(stage)) {
        const precio = resolvePrecioKwp(a.solucion, ocSolutionPrices, precioKwpConstruccion);
        costoEjecutado += computeAssignmentCost(a.kwp_asignado, a.monto_fijo, precio);
      }
    }

    return {
      ...oc,
      items: ocItems,
      kwp_asignado: kwpAsignado,
      pct_kwp_asignado: oc.kwp_total && oc.kwp_total > 0 ? Math.min(100, (kwpAsignado / oc.kwp_total) * 100) : null,
      costo_ejecutado: costoEjecutado,
      costo_no_ejecutado: Math.max(0, Number(oc.valor_total) - costoEjecutado),
      casas_count: ocAssignments.length,
      tiene_adicionales: (addendaCountByOc.get(oc.id) ?? 0) > 0,
      adicionales_count: addendaCountByOc.get(oc.id) ?? 0,
    };
  });

  return NextResponse.json({ purchaseOrders: enriched });
}

/**
 * POST /api/purchase-orders
 * Crea la cabecera de una OC (las líneas de detalle, precios por solución
 * y PDF se agregan después contra el detalle — ver /[id]/items, etc.).
 * kwp_total es OPCIONAL: una OC puede ser 100% de "otro tema" (ej. un
 * pedido de solo medidores) y no tener ninguna línea proporcional a kWp.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { numero_oc, proveedor, fecha_documento, fecha_entrega, condiciones_pago, moneda, kwp_total, valor_total, observaciones, created_by } = body;

    if (!numero_oc || typeof numero_oc !== 'string') {
      return NextResponse.json({ error: 'numero_oc es requerido' }, { status: 400 });
    }
    if (!proveedor || typeof proveedor !== 'string') {
      return NextResponse.json({ error: 'proveedor es requerido' }, { status: 400 });
    }
    if (kwp_total != null && kwp_total !== '' && !(Number(kwp_total) > 0)) {
      return NextResponse.json({ error: 'kwp_total, si se especifica, debe ser mayor a 0' }, { status: 400 });
    }
    if (!(Number(valor_total) >= 0)) {
      return NextResponse.json({ error: 'valor_total inválido' }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from('purchase_orders')
      .insert({
        numero_oc,
        proveedor,
        fecha_documento: fecha_documento || null,
        fecha_entrega: fecha_entrega || null,
        condiciones_pago: condiciones_pago || null,
        moneda: moneda || 'COP',
        kwp_total: kwp_total != null && kwp_total !== '' ? Number(kwp_total) : null,
        valor_total: Number(valor_total),
        observaciones: observaciones || null,
        created_by: created_by || null,
      })
      .select('*')
      .single();

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json({ error: `Ya existe una OC con el número "${numero_oc}"` }, { status: 409 });
      }
      throw error;
    }

    return NextResponse.json({ purchaseOrder: data }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}
