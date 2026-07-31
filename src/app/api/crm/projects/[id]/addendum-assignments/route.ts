import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/crm/projects/[id]/addendum-assignments
 * Vista "por casa": todos los adicionales (otrosí) de los que esta casa
 * recibe %, para la sección de instalación del CRM. El alta/edición/baja
 * sigue viviendo en /api/purchase-orders/addenda/[id]/assignments (ya
 * valida que la suma de % por adicional no pase de 100) — este endpoint
 * solo lista, mismo patrón de solo-lectura que oc-assignments para el
 * picker del lado de la casa.
 */
export async function GET(_request: Request, { params }: RouteContext) {
  const { id } = await params;
  const { data, error } = await supabaseAdmin
    .from('purchase_order_addendum_house_assignments')
    .select('*, addendum:purchase_order_addenda(id, numero_adicional, valor_total, purchaseOrder:purchase_orders(id, numero_oc))')
    .eq('project_id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ assignments: data ?? [] });
}
