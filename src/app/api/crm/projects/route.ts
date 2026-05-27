import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

/**
 * GET /api/crm/projects
 *   ?module=sales|engineering|operations
 *   ?stage=...
 *   ?q=texto-libre
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const module = url.searchParams.get('module');
  const stage = url.searchParams.get('stage');
  const q = url.searchParams.get('q');
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 500), 1000);

  let query = supabaseAdmin
    .from('crm_projects')
    .select('*')
    .order('updated_at', { ascending: false })
    .limit(limit);

  if (module) query = query.eq('current_module', module);
  if (stage && module) {
    const col = module === 'sales' ? 'sales_stage' : module === 'engineering' ? 'engineering_stage' : 'operations_stage';
    query = query.eq(col, stage);
  }
  if (q) query = query.or(`title.ilike.%${q}%,client_name.ilike.%${q}%,code.ilike.%${q}%,client_email.ilike.%${q}%`);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ projects: data });
}

/**
 * POST /api/crm/projects
 * Crea un proyecto nuevo en sales/prospecto.
 * Body: { title, created_by, ...campos opcionales }
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (!body.title) return NextResponse.json({ error: 'title requerido' }, { status: 400 });

    const payload = {
      title: body.title,
      client_name: body.client_name ?? null,
      client_email: body.client_email ?? null,
      client_phone: body.client_phone ?? null,
      client_address: body.client_address ?? null,
      client_city: body.client_city ?? null,
      created_by: body.created_by ?? null,
      assigned_to: body.assigned_to ?? body.created_by ?? null,
      notes: body.notes ?? null,
    };

    const { data, error } = await supabaseAdmin
      .from('crm_projects')
      .insert(payload)
      .select('*')
      .single();
    if (error) throw error;

    await supabaseAdmin.from('crm_project_events').insert({
      project_id: data.id,
      event_type: 'created',
      to_module: 'sales',
      to_stage: 'prospecto',
      actor_email: body.created_by ?? null,
      notes: 'Proyecto creado',
    });

    return NextResponse.json({ project: data });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}

/**
 * PATCH /api/crm/projects
 * Body: { id, ...campos a actualizar (sin tocar stages/module) }
 * Para cambio de etapa usar /api/crm/projects/[id]/transition
 */
export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    if (!body.id) return NextResponse.json({ error: 'id requerido' }, { status: 400 });

    const updates = { ...body };
    delete updates.id;
    // Stages y current_module solo se cambian vía transition
    delete updates.sales_stage;
    delete updates.engineering_stage;
    delete updates.operations_stage;
    delete updates.current_module;
    delete updates.code;
    delete updates.created_at;

    const { data, error } = await supabaseAdmin
      .from('crm_projects')
      .update(updates)
      .eq('id', body.id)
      .select('*')
      .single();
    if (error) throw error;

    await supabaseAdmin.from('crm_project_events').insert({
      project_id: body.id,
      event_type: 'field_update',
      actor_email: body.actor_email ?? null,
      notes: body.note ?? 'Campos actualizados',
      data: updates,
    });

    return NextResponse.json({ project: data });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}

/**
 * DELETE /api/crm/projects?id=...
 */
export async function DELETE(request: Request) {
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id requerido' }, { status: 400 });
  const { error } = await supabaseAdmin.from('crm_projects').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
