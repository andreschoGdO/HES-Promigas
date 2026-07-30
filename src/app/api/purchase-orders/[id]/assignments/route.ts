import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, { params }: RouteContext) {
  const { id } = await params;
  const { data, error } = await supabaseAdmin
    .from('purchase_order_house_assignments')
    .select('*, project:crm_projects(id, title, conjunto, casa_numero, diseno_kwp, operations_stage)')
    .eq('oc_id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ assignments: data ?? [] });
}

/**
 * POST /api/purchase-orders/[id]/assignments
 * Asigna una casa a la OC. Acepta kwp_asignado (para la parte de la OC que
 * es construcción, proporcional a kWp) y/o monto_fijo (para la parte de
 * "otro tema" — ej. medidores — que no se reparte por kWp, se captura a
 * mano). Al menos uno de los dos es requerido. Si viene kwp_asignado, se
 * valida que la suma no supere `kwp_total` de la OC. La UI de instalación
 * en el CRM (una casa repartida entre varias OC, tope = diseno_kwp de la
 * casa) usa este mismo endpoint fila por fila — ver
 * /api/crm/projects/[id]/oc-assignments para el listado agregado por casa.
 */
export async function POST(request: Request, { params }: RouteContext) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { project_id, kwp_asignado, monto_fijo, solucion, created_by } = body;

    if (!project_id) return NextResponse.json({ error: 'project_id es requerido' }, { status: 400 });
    const hasKwp = kwp_asignado != null && kwp_asignado !== '';
    const hasMonto = monto_fijo != null && monto_fijo !== '';
    if (!hasKwp && !hasMonto) {
      return NextResponse.json({ error: 'Indicá kwp_asignado y/o monto_fijo' }, { status: 400 });
    }
    if (hasKwp && !(Number(kwp_asignado) > 0)) return NextResponse.json({ error: 'kwp_asignado debe ser mayor a 0' }, { status: 400 });
    if (hasMonto && !(Number(monto_fijo) >= 0)) return NextResponse.json({ error: 'monto_fijo inválido' }, { status: 400 });

    const { data: oc, error: ocErr } = await supabaseAdmin.from('purchase_orders').select('kwp_total').eq('id', id).single();
    if (ocErr || !oc) return NextResponse.json({ error: 'Orden de compra no encontrada' }, { status: 404 });

    if (hasKwp) {
      if (!(oc.kwp_total > 0)) {
        return NextResponse.json({ error: 'Esta OC no tiene kwp_total definido — no se le puede asignar kWp, solo monto_fijo.' }, { status: 400 });
      }
      const { data: existing, error: exErr } = await supabaseAdmin
        .from('purchase_order_house_assignments')
        .select('kwp_asignado')
        .eq('oc_id', id);
      if (exErr) throw exErr;

      const yaAsignado = (existing ?? []).reduce((sum, a) => sum + Number(a.kwp_asignado ?? 0), 0);
      const disponible = Number(oc.kwp_total) - yaAsignado;
      if (Number(kwp_asignado) > disponible + 1e-9) {
        return NextResponse.json(
          { error: `Solo quedan ${disponible.toFixed(2)} kWp disponibles en esta OC (total ${oc.kwp_total} kWp).` },
          { status: 400 },
        );
      }
    }

    const { data, error } = await supabaseAdmin
      .from('purchase_order_house_assignments')
      .upsert(
        {
          oc_id: id,
          project_id,
          kwp_asignado: hasKwp ? Number(kwp_asignado) : null,
          monto_fijo: hasMonto ? Number(monto_fijo) : null,
          solucion: solucion ?? null,
          created_by: created_by || null,
        },
        { onConflict: 'oc_id,project_id' },
      )
      .select('*, project:crm_projects(id, title, conjunto, casa_numero, diseno_kwp, operations_stage)')
      .single();
    if (error) throw error;

    return NextResponse.json({ assignment: data }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}

/** DELETE /api/purchase-orders/[id]/assignments?project_id=... */
export async function DELETE(request: Request, { params }: RouteContext) {
  const { id } = await params;
  const url = new URL(request.url);
  const projectId = url.searchParams.get('project_id');
  if (!projectId) return NextResponse.json({ error: 'project_id requerido' }, { status: 400 });

  const { error } = await supabaseAdmin
    .from('purchase_order_house_assignments')
    .delete()
    .eq('oc_id', id)
    .eq('project_id', projectId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
