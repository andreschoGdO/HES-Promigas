import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, { params }: RouteContext) {
  const { id } = await params;
  const [{ data: addendum, error }, { data: items }, { data: assignments }] = await Promise.all([
    supabaseAdmin.from('purchase_order_addenda').select('*, purchaseOrder:purchase_orders(id, numero_oc, valor_total)').eq('id', id).single(),
    supabaseAdmin.from('purchase_order_addendum_items').select('*').eq('addendum_id', id).order('posicion'),
    supabaseAdmin
      .from('purchase_order_addendum_house_assignments')
      .select('*, project:crm_projects(id, title, conjunto, casa_numero)')
      .eq('addendum_id', id),
  ]);
  if (error || !addendum) return NextResponse.json({ error: 'Adicional no encontrado' }, { status: 404 });

  return NextResponse.json({ addendum, items: items ?? [], assignments: assignments ?? [] });
}

export async function PATCH(request: Request, { params }: RouteContext) {
  try {
    const { id } = await params;
    const body = await request.json();
    const allowed = ['numero_adicional', 'fecha', 'motivo', 'solicitado_por', 'aprobado_por', 'valor_total'];
    const patch: Record<string, unknown> = {};
    for (const key of allowed) if (key in body) patch[key] = body[key];

    const { data, error } = await supabaseAdmin.from('purchase_order_addenda').update(patch).eq('id', id).select('*').single();
    if (error) throw error;
    return NextResponse.json({ addendum: data });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  const { id } = await params;
  const { data: addendum } = await supabaseAdmin.from('purchase_order_addenda').select('pdf_storage_path').eq('id', id).single();
  if (addendum?.pdf_storage_path) {
    await supabaseAdmin.storage.from('purchase-orders').remove([addendum.pdf_storage_path]);
  }
  const { error } = await supabaseAdmin.from('purchase_order_addenda').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
