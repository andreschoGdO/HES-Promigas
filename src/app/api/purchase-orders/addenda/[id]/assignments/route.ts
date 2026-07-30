import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, { params }: RouteContext) {
  const { id } = await params;
  const { data, error } = await supabaseAdmin
    .from('purchase_order_addendum_house_assignments')
    .select('*, project:crm_projects(id, title, conjunto, casa_numero)')
    .eq('addendum_id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ assignments: data ?? [] });
}

/**
 * POST — asigna a una casa qué % de este adicional le corresponde, con su
 * propio detalle en texto libre. Valida que la suma de % no pase de 100.
 */
export async function POST(request: Request, { params }: RouteContext) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { project_id, porcentaje, detalle, created_by } = body;

    if (!project_id) return NextResponse.json({ error: 'project_id es requerido' }, { status: 400 });
    const pct = Number(porcentaje);
    if (!(pct > 0 && pct <= 100)) return NextResponse.json({ error: 'porcentaje debe estar entre 0 y 100' }, { status: 400 });

    const { data: existing, error: exErr } = await supabaseAdmin
      .from('purchase_order_addendum_house_assignments')
      .select('project_id, porcentaje')
      .eq('addendum_id', id);
    if (exErr) throw exErr;

    const otros = (existing ?? []).filter((a) => a.project_id !== project_id);
    const sumaOtros = otros.reduce((sum, a) => sum + Number(a.porcentaje), 0);
    if (sumaOtros + pct > 100 + 1e-9) {
      return NextResponse.json({ error: `La suma de porcentajes asignados sería ${(sumaOtros + pct).toFixed(1)}%, supera 100%.` }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from('purchase_order_addendum_house_assignments')
      .upsert(
        { addendum_id: id, project_id, porcentaje: pct, detalle: detalle || null, created_by: created_by || null },
        { onConflict: 'addendum_id,project_id' },
      )
      .select('*, project:crm_projects(id, title, conjunto, casa_numero)')
      .single();
    if (error) throw error;

    return NextResponse.json({ assignment: data }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}

/** DELETE ?project_id=... */
export async function DELETE(request: Request, { params }: RouteContext) {
  const { id } = await params;
  const url = new URL(request.url);
  const projectId = url.searchParams.get('project_id');
  if (!projectId) return NextResponse.json({ error: 'project_id requerido' }, { status: 400 });

  const { error } = await supabaseAdmin
    .from('purchase_order_addendum_house_assignments')
    .delete()
    .eq('addendum_id', id)
    .eq('project_id', projectId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
