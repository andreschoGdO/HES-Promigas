import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { isExecutedStage, computeOcPricing, computeAssignmentCost, resolvePrecioKwp } from '@/lib/purchase-orders';

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/purchase-orders/[id]
 * Detalle completo: cabecera + líneas + precios por solución + casas
 * asignadas (con su estado CRM) + resumen de adicionales.
 */
export async function GET(_request: Request, { params }: RouteContext) {
  const { id } = await params;

  const [{ data: oc, error: ocErr }, { data: items }, { data: solutionPrices }, { data: assignments }, { data: addenda }] = await Promise.all([
    supabaseAdmin.from('purchase_orders').select('*').eq('id', id).single(),
    supabaseAdmin.from('purchase_order_items').select('*').eq('oc_id', id).order('posicion'),
    supabaseAdmin.from('purchase_order_solution_prices').select('*').eq('oc_id', id).order('solucion'),
    supabaseAdmin
      .from('purchase_order_house_assignments')
      .select('*, project:crm_projects(id, title, conjunto, casa_numero, diseno_kwp, operations_stage)')
      .eq('oc_id', id),
    supabaseAdmin.from('purchase_order_addenda').select('id, numero_adicional, valor_total, fecha').eq('oc_id', id).order('fecha', { ascending: false }),
  ]);

  if (ocErr || !oc) return NextResponse.json({ error: 'Orden de compra no encontrada' }, { status: 404 });

  type Assignment = { kwp_asignado: number | null; monto_fijo: number | null; solucion: number | null; project: { operations_stage: string | null } | { operations_stage: string | null }[] | null };
  const { precioKwpConstruccion, construccionSubtotal, flatSubtotal } = computeOcPricing(items ?? [], oc.kwp_total);
  const kwpAsignado = (assignments ?? []).reduce((sum, a) => sum + Number(a.kwp_asignado ?? 0), 0);
  const costoEjecutado = (assignments ?? []).reduce((sum, a: Assignment) => {
    const stage = Array.isArray(a.project) ? a.project[0]?.operations_stage : a.project?.operations_stage;
    if (!isExecutedStage(stage)) return sum;
    const precio = resolvePrecioKwp(a.solucion, solutionPrices ?? [], precioKwpConstruccion);
    return sum + computeAssignmentCost(a.kwp_asignado, a.monto_fijo, precio);
  }, 0);

  // Contra suma de líneas (neto), no oc.valor_total (Gran Total con IVA en
  // las OC reales) — ver misma nota en /api/purchase-orders.
  const ocLineasTotal = (items ?? []).reduce((sum, i) => sum + Number(i.valor_total), 0);

  return NextResponse.json({
    purchaseOrder: {
      ...oc,
      kwp_asignado: kwpAsignado,
      pct_kwp_asignado: oc.kwp_total && oc.kwp_total > 0 ? Math.min(100, (kwpAsignado / oc.kwp_total) * 100) : null,
      costo_ejecutado: costoEjecutado,
      costo_no_ejecutado: Math.max(0, ocLineasTotal - costoEjecutado),
      construccion_subtotal: construccionSubtotal,
      flat_subtotal: flatSubtotal,
      precio_kwp_construccion: precioKwpConstruccion,
    },
    items: items ?? [],
    solutionPrices: solutionPrices ?? [],
    assignments: assignments ?? [],
    addenda: addenda ?? [],
    addendaTotal: (addenda ?? []).reduce((sum, a) => sum + Number(a.valor_total), 0),
    addendaLimit: Number(oc.valor_total) * 0.1,
  });
}

/** PATCH /api/purchase-orders/[id] — edita campos de cabecera. */
export async function PATCH(request: Request, { params }: RouteContext) {
  try {
    const { id } = await params;
    const body = await request.json();
    const allowed = ['numero_oc', 'proveedor', 'fecha_documento', 'fecha_entrega', 'condiciones_pago', 'moneda', 'kwp_total', 'valor_total', 'observaciones', 'updated_by'];
    const patch: Record<string, unknown> = {};
    for (const key of allowed) if (key in body) patch[key] = body[key];

    const { data, error } = await supabaseAdmin.from('purchase_orders').update(patch).eq('id', id).select('*').single();
    if (error) throw error;
    return NextResponse.json({ purchaseOrder: data });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}

/** DELETE /api/purchase-orders/[id] — borra la OC (cascada: items, precios, asignaciones, adicionales). */
export async function DELETE(_request: Request, { params }: RouteContext) {
  const { id } = await params;
  const { data: oc } = await supabaseAdmin.from('purchase_orders').select('pdf_storage_path').eq('id', id).single();
  if (oc?.pdf_storage_path) {
    await supabaseAdmin.storage.from('purchase-orders').remove([oc.pdf_storage_path]);
  }
  const { error } = await supabaseAdmin.from('purchase_orders').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
