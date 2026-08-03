import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { isExecutedStage, computeItemExecution } from '@/lib/purchase-orders';

/**
 * GET /api/purchase-orders
 * Lista todas las OC con agregados calculados al vuelo (nunca guardados):
 * kwp_asignado, pct_kwp_asignado, costo_ejecutado, costo_no_ejecutado (a
 * nivel OC, para las cards/resumen), casas_count, tiene_adicionales.
 *
 * Además, cada línea (`items[]`) trae SU PROPIO costo_ejecutado/
 * costo_no_ejecutado/pct_pendiente/tiene_adicionales — prorrateado según
 * el peso de esa línea dentro de la OC (ver computeItemExecution). La
 * tabla de la UI está a nivel línea, así que debe usar estos campos por
 * ítem, NUNCA repetir el total de la OC en cada fila — si no, sumar la
 * columna en la UI/CSV da un número inflado (total × cantidad de líneas).
 */
export async function GET() {
  const [{ data: ocs, error: ocErr }, { data: items, error: itErr }, { data: assignments, error: aErr }, { data: addenda, error: adErr }, { data: addendumItems, error: aiErr }, { data: solutionPrices, error: spErr }] = await Promise.all([
    supabaseAdmin.from('purchase_orders').select('*').order('fecha_documento', { ascending: false }),
    supabaseAdmin.from('purchase_order_items').select('*').order('posicion'),
    supabaseAdmin
      .from('purchase_order_house_assignments')
      .select('oc_id, project_id, kwp_asignado, monto_fijo, solucion, project:crm_projects(operations_stage)'),
    supabaseAdmin.from('purchase_order_addenda').select('id, oc_id'),
    supabaseAdmin.from('purchase_order_addendum_items').select('addendum_id, categoria, valor_total'),
    supabaseAdmin.from('purchase_order_solution_prices').select('oc_id, solucion, precio_kwp'),
  ]);
  if (ocErr) return NextResponse.json({ error: ocErr.message }, { status: 500 });
  if (itErr) return NextResponse.json({ error: itErr.message }, { status: 500 });
  if (aErr) return NextResponse.json({ error: aErr.message }, { status: 500 });
  if (adErr) return NextResponse.json({ error: adErr.message }, { status: 500 });
  if (aiErr) return NextResponse.json({ error: aiErr.message }, { status: 500 });
  if (spErr) return NextResponse.json({ error: spErr.message }, { status: 500 });

  type AssignmentRow = { oc_id: string; project_id: string; kwp_asignado: number | null; monto_fijo: number | null; solucion: number | null; project: { operations_stage: string | null } | { operations_stage: string | null }[] | null };

  const addendaCountByOc = new Map<string, number>();
  for (const row of addenda ?? []) {
    addendaCountByOc.set(row.oc_id, (addendaCountByOc.get(row.oc_id) ?? 0) + 1);
  }
  // Adicionales por categoría dentro de una OC — así "Tiene adicionales" se
  // puede mostrar por línea (solo la categoría que realmente tiene un
  // adicional cargado), no la OC completa repetida en todas sus líneas.
  const addendaByOcAndCategoria = new Map<string, Map<string, { count: number; valor: number }>>();
  for (const ai of addendumItems ?? []) {
    const ocId = (addenda ?? []).find((a) => a.id === ai.addendum_id)?.oc_id;
    if (!ocId) continue;
    const byCat = addendaByOcAndCategoria.get(ocId) ?? new Map();
    const cur = byCat.get(ai.categoria) ?? { count: 0, valor: 0 };
    byCat.set(ai.categoria, { count: cur.count + 1, valor: cur.valor + Number(ai.valor_total) });
    addendaByOcAndCategoria.set(ocId, byCat);
  }

  const enriched = (ocs ?? []).map((oc) => {
    const ocItems = (items ?? []).filter((i) => i.oc_id === oc.id);
    const ocSolutionPrices = (solutionPrices ?? []).filter((sp) => sp.oc_id === oc.id);
    const ocAssignments = ((assignments ?? []) as AssignmentRow[]).filter((a) => a.oc_id === oc.id);
    const kwpAsignado = ocAssignments.reduce((sum, a) => sum + Number(a.kwp_asignado ?? 0), 0);

    const executionAssignments = ocAssignments.map((a) => {
      const stage = Array.isArray(a.project) ? a.project[0]?.operations_stage : a.project?.operations_stage;
      return { kwp_asignado: a.kwp_asignado, monto_fijo: a.monto_fijo, solucion: a.solucion, executed: isExecutedStage(stage) };
    });
    const { items: itemsWithExecution, costoConstruccionEjecutado, costoFlatEjecutado } = computeItemExecution(ocItems, oc.kwp_total, executionAssignments, ocSolutionPrices);
    const costoEjecutado = costoConstruccionEjecutado + costoFlatEjecutado;

    const catAddenda = addendaByOcAndCategoria.get(oc.id);
    const itemsFinal = itemsWithExecution.map((item) => {
      const catInfo = catAddenda?.get(item.categoria);
      return {
        ...item,
        pct_pendiente: Number(item.valor_total) > 0 ? (item.costo_no_ejecutado / Number(item.valor_total)) * 100 : 0,
        tiene_adicionales: !!catInfo,
        adicionales_count: catInfo?.count ?? 0,
        adicionales_valor: catInfo?.valor ?? 0,
      };
    });

    return {
      ...oc,
      items: itemsFinal,
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
