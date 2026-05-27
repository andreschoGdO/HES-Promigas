import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

interface Ctx { params: Promise<{ id: string }>; }

/**
 * GET /api/crm/projects/[id]
 * Devuelve el proyecto + sus eventos + categorías relacionadas + visita previa/instalación + reserva.
 */
export async function GET(_request: Request, context: Ctx) {
  const { id } = await context.params;
  const { data: project, error } = await supabaseAdmin
    .from('crm_projects')
    .select(`
      *,
      diseno_inversor_categoria:inventory_categories!diseno_inversor_categoria_id(id, code, name, family, default_capacity_value, default_capacity_unit),
      diseno_panel_categoria:inventory_categories!diseno_panel_categoria_id(id, code, name, family, default_capacity_value, default_capacity_unit),
      diseno_bateria_categoria:inventory_categories!diseno_bateria_categoria_id(id, code, name, family, default_capacity_value, default_capacity_unit),
      visita_previa:field_visits!visita_previa_id(id, visit_type, casa, visit_date, status),
      visita_instalacion:field_visits!visita_instalacion_id(id, visit_type, casa, visit_date, status),
      reserva:inventory_reservations!reservation_id(id, title, status)
    `)
    .eq('id', id)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 404 });

  const { data: events } = await supabaseAdmin
    .from('crm_project_events')
    .select('*')
    .eq('project_id', id)
    .order('created_at', { ascending: false })
    .limit(100);

  return NextResponse.json({ project, events: events ?? [] });
}
