import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { TRANSITIONS, type CrmModule } from '@/lib/crm-stages';

/**
 * GET /api/crm/stage-fields?module=sales&stage=levantamiento
 *
 * Devuelve los campos configurados para esa etapa. Si la BD está vacía
 * para esa (module, stage), siembra automáticamente desde los defaults
 * hardcoded en TRANSITIONS y devuelve los seeded.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const module = url.searchParams.get('module') as CrmModule | null;
  const stage = url.searchParams.get('stage');
  if (!module || !stage) return NextResponse.json({ error: 'module y stage requeridos' }, { status: 400 });

  const { data: existing, error } = await supabaseAdmin
    .from('crm_stage_fields')
    .select('*')
    .eq('module', module)
    .eq('stage', stage)
    .order('sort_order', { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (existing && existing.length > 0) {
    return NextResponse.json({ fields: existing });
  }

  // No hay configuración: buscar la transición que LANDS en (module, stage)
  // y sembrar los campos default
  const trans = TRANSITIONS.find((t) => t.toModule === module && t.toStage === stage);
  if (!trans || trans.requiredFields.length === 0) {
    return NextResponse.json({ fields: [] });
  }

  const seeds = trans.requiredFields.map((f, i) => ({
    module,
    stage,
    field_key: f.key,
    field_label: f.label,
    field_type: f.type,
    options: f.options ?? null,
    required: f.required ?? false,
    placeholder: f.placeholder ?? null,
    help: f.help ?? null,
    sort_order: i,
    is_custom: false,
  }));

  const { data: seeded, error: seedErr } = await supabaseAdmin
    .from('crm_stage_fields')
    .upsert(seeds, { onConflict: 'module,stage,field_key' })
    .select('*')
    .order('sort_order', { ascending: true });
  if (seedErr) return NextResponse.json({ error: seedErr.message }, { status: 500 });
  return NextResponse.json({ fields: seeded ?? [] });
}

/** POST — agrega un campo (custom o default re-añadido) */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (!body.module || !body.stage || !body.field_key || !body.field_label || !body.field_type) {
      return NextResponse.json({ error: 'module, stage, field_key, field_label, field_type son requeridos' }, { status: 400 });
    }
    // Calcular sort_order al final
    const { data: last } = await supabaseAdmin
      .from('crm_stage_fields')
      .select('sort_order')
      .eq('module', body.module)
      .eq('stage', body.stage)
      .order('sort_order', { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextOrder = (last?.sort_order ?? -1) + 1;

    const payload = {
      module: body.module,
      stage: body.stage,
      field_key: String(body.field_key).trim().toLowerCase().replace(/\s+/g, '_'),
      field_label: body.field_label,
      field_type: body.field_type,
      options: Array.isArray(body.options) && body.options.length > 0 ? body.options : null,
      required: body.required ?? false,
      placeholder: body.placeholder ?? null,
      help: body.help ?? null,
      sort_order: nextOrder,
      is_custom: body.is_custom ?? true,
    };
    const { data, error } = await supabaseAdmin
      .from('crm_stage_fields')
      .insert(payload)
      .select('*')
      .single();
    if (error) {
      const status = error.message.toLowerCase().includes('duplicate') ? 409 : 500;
      return NextResponse.json({ error: error.message }, { status });
    }
    return NextResponse.json({ field: data });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}

/** PATCH — edita un campo existente */
export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    if (!body.id) return NextResponse.json({ error: 'id requerido' }, { status: 400 });
    const updates: Record<string, unknown> = {};
    for (const k of ['field_label', 'field_type', 'options', 'required', 'placeholder', 'help', 'sort_order']) {
      if (k in body) updates[k] = body[k];
    }
    const { data, error } = await supabaseAdmin
      .from('crm_stage_fields')
      .update(updates)
      .eq('id', body.id)
      .select('*')
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ field: data });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}

/** DELETE — quita un campo de la configuración (los datos en la BD no se borran) */
export async function DELETE(request: Request) {
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id requerido' }, { status: 400 });
  const { error } = await supabaseAdmin.from('crm_stage_fields').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
