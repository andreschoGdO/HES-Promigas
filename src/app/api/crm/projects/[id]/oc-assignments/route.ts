import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

interface RouteContext {
  params: Promise<{ id: string }>;
}

interface AssignmentInput {
  oc_id: string;
  kwp_asignado: number;
  solucion?: number | null;
}

/**
 * GET /api/crm/projects/[id]/oc-assignments
 * Vista "por casa": todas las OC de las que esta casa recibe plata, para
 * la sección de instalación del CRM (una casa puede tener varias OC).
 */
export async function GET(_request: Request, { params }: RouteContext) {
  const { id } = await params;
  const { data, error } = await supabaseAdmin
    .from('purchase_order_house_assignments')
    .select('*, purchaseOrder:purchase_orders(id, numero_oc, proveedor, kwp_total, valor_total)')
    .eq('project_id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ assignments: data ?? [] });
}

/**
 * PUT /api/crm/projects/[id]/oc-assignments
 * Reemplaza TODA la lista de OC asignadas a esta casa (mismo patrón
 * "reemplazar todo" que consumables de inventario). Valida:
 *   1. La suma de kwp_asignado de esta casa no supera su diseno_kwp.
 *   2. Cada OC individual sigue teniendo cupo (kwp_total - lo ya asignado
 *      a OTRAS casas) para el kwp que le estamos pidiendo acá.
 */
export async function PUT(request: Request, { params }: RouteContext) {
  try {
    const { id } = await params;
    const body = await request.json();
    const rows = body.assignments as AssignmentInput[];
    if (!Array.isArray(rows)) {
      return NextResponse.json({ error: '"assignments" debe ser un array' }, { status: 400 });
    }

    const { data: project, error: pErr } = await supabaseAdmin.from('crm_projects').select('diseno_kwp').eq('id', id).single();
    if (pErr || !project) return NextResponse.json({ error: 'Proyecto no encontrado' }, { status: 404 });

    const sumaCasa = rows.reduce((sum, r) => sum + Number(r.kwp_asignado), 0);
    if (project.diseno_kwp != null && sumaCasa > Number(project.diseno_kwp) + 1e-9) {
      return NextResponse.json(
        { error: `La suma de kWp asignados (${sumaCasa.toFixed(2)}) supera el kWp diseñado de la casa (${project.diseno_kwp}).` },
        { status: 400 },
      );
    }

    for (const [i, row] of rows.entries()) {
      if (!row.oc_id || !(Number(row.kwp_asignado) > 0)) {
        return NextResponse.json({ error: `Fila ${i + 1}: oc_id y kwp_asignado (>0) son requeridos` }, { status: 400 });
      }
      const { data: oc, error: ocErr } = await supabaseAdmin.from('purchase_orders').select('kwp_total').eq('id', row.oc_id).single();
      if (ocErr || !oc) return NextResponse.json({ error: `Fila ${i + 1}: OC no encontrada` }, { status: 404 });

      const { data: others, error: othErr } = await supabaseAdmin
        .from('purchase_order_house_assignments')
        .select('kwp_asignado')
        .eq('oc_id', row.oc_id)
        .neq('project_id', id);
      if (othErr) throw othErr;

      const yaAsignadoOtras = (others ?? []).reduce((sum, a) => sum + Number(a.kwp_asignado), 0);
      const disponible = Number(oc.kwp_total) - yaAsignadoOtras;
      if (Number(row.kwp_asignado) > disponible + 1e-9) {
        return NextResponse.json(
          { error: `Fila ${i + 1}: solo quedan ${disponible.toFixed(2)} kWp disponibles en esa OC.` },
          { status: 400 },
        );
      }
    }

    const { error: delErr } = await supabaseAdmin.from('purchase_order_house_assignments').delete().eq('project_id', id);
    if (delErr) throw delErr;

    if (rows.length === 0) return NextResponse.json({ assignments: [] });

    const insertRows = rows.map((r) => ({
      oc_id: r.oc_id,
      project_id: id,
      kwp_asignado: Number(r.kwp_asignado),
      solucion: r.solucion ?? null,
    }));
    const { data, error: insErr } = await supabaseAdmin
      .from('purchase_order_house_assignments')
      .insert(insertRows)
      .select('*, purchaseOrder:purchase_orders(id, numero_oc, proveedor, kwp_total, valor_total)');
    if (insErr) throw insErr;

    return NextResponse.json({ assignments: data ?? [] });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}
