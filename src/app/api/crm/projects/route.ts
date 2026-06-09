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
  const moduleParam = url.searchParams.get('module');
  const stage = url.searchParams.get('stage');
  const q = url.searchParams.get('q');
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 500), 1000);

  let query = supabaseAdmin
    .from('crm_projects')
    .select('*')
    .order('updated_at', { ascending: false })
    .limit(limit);

  if (moduleParam) query = query.eq('current_module', moduleParam);
  if (stage && moduleParam === 'operations') query = query.eq('operations_stage', stage);
  if (q) {
    // Sanitizar: PostgREST.or() es un DSL — comas, paréntesis, asteriscos rompen sintaxis
    // y podrían usarse para inyectar filtros adicionales. Eliminarlos del input.
    const safe = q.replace(/[,()*"\\]/g, ' ').trim();
    if (safe) {
      query = query.or(`title.ilike.%${safe}%,client_name.ilike.%${safe}%,code.ilike.%${safe}%,client_email.ilike.%${safe}%`);
    }
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ projects: data });
}

/**
 * POST /api/crm/projects
 * Crea un proyecto en Operaciones (único módulo activo).
 * Body soporta:
 *   - title (requerido)
 *   - module: 'operations' (opcional, único valor aceptado)
 *   - stage: etapa de operations (default 'dimensionado')
 *   - cualquier campo de crm_projects (cliente, dimensionamiento, contractor, etc.)
 */
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const str = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
};

export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (!body.title) return NextResponse.json({ error: 'title requerido' }, { status: 400 });

    // Single módulo activo: operations. sales/engineering quedan como 'completado'
    // por compatibilidad con las columnas de la BD pero ya no se usan en la UI.
    const targetModule = 'operations' as const;
    const targetStage = str(body.stage) ?? 'dimensionado';
    if (str(body.module) && str(body.module) !== 'operations') {
      return NextResponse.json({ error: `module inválido: "${str(body.module)}". Solo se acepta 'operations'.` }, { status: 400 });
    }

    const payload: Record<string, unknown> = {
      title: String(body.title).trim(),
      current_module: targetModule,
      sales_stage: 'completado',
      engineering_stage: 'completado',
      operations_stage: targetStage,
      // Cliente
      client_name: str(body.client_name),
      client_email: str(body.client_email),
      client_phone: str(body.client_phone),
      client_address: str(body.client_address),
      client_city: str(body.client_city),
      client_doc_type: str(body.client_doc_type),
      client_doc_number: str(body.client_doc_number),
      estrato: num(body.estrato),
      tipo_vivienda: str(body.tipo_vivienda),
      lat: num(body.lat),
      lng: num(body.lng),
      conjunto: str(body.conjunto),
      casa_numero: str(body.casa_numero),
      carga_carro_electrico: str(body.carga_carro_electrico),
      autosuficiencia_objetivo_pct: num(body.autosuficiencia_objetivo_pct),
      // Comercial
      invoice_kwh_mensual: num(body.invoice_kwh_mensual),
      invoice_valor_cop: num(body.invoice_valor_cop),
      propuesta_kwp: num(body.propuesta_kwp),
      propuesta_valor_cop: num(body.propuesta_valor_cop),
      propuesta_url: str(body.propuesta_url),
      contrato_url: str(body.contrato_url),
      oferta_url: str(body.oferta_url),
      // Dimensionamiento
      diseno_kwp: num(body.diseno_kwp),
      diseno_paneles: num(body.diseno_paneles),
      diseno_baterias_cantidad: num(body.diseno_baterias_cantidad),
      diseno_inversor_marca: str(body.diseno_inversor_marca),
      diseno_inversor_potencia_kw: num(body.diseno_inversor_potencia_kw),
      diseno_bateria_marca: str(body.diseno_bateria_marca),
      diseno_bateria_capacidad_kwh: num(body.diseno_bateria_capacidad_kwh),
      diseno_inversor_categoria_id: str(body.diseno_inversor_categoria_id),
      diseno_panel_categoria_id: str(body.diseno_panel_categoria_id),
      diseno_bateria_categoria_id: str(body.diseno_bateria_categoria_id),
      diseno_yield_estimado_kwh_mes: num(body.diseno_yield_estimado_kwh_mes),
      diseno_notes: str(body.diseno_notes),
      diseno_aprobado_por: str(body.diseno_aprobado_por),
      diseno_aprobado_at: str(body.diseno_aprobado_por) ? new Date().toISOString() : null,
      tipo_red: str(body.tipo_red),
      // Operación
      contractor_name: str(body.contractor_name),
      contractor_email: str(body.contractor_email),
      installation_date: str(body.installation_date),
      // Metadata
      created_by: str(body.created_by),
      assigned_to: str(body.assigned_to) ?? str(body.created_by),
      notes: str(body.notes),
    };

    // Limpiar nulls para que la BD aplique sus defaults
    for (const k of Object.keys(payload)) if (payload[k] === null || payload[k] === undefined) delete payload[k];

    const { data, error } = await supabaseAdmin
      .from('crm_projects')
      .insert(payload)
      .select('*')
      .single();
    if (error) {
      console.error('crm_projects insert error', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    await supabaseAdmin.from('crm_project_events').insert({
      project_id: data.id,
      event_type: 'created',
      to_module: targetModule,
      to_stage: targetStage,
      actor_email: str(body.created_by),
      notes: 'Proyecto creado en Operaciones',
    });

    return NextResponse.json({ project: data });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}

/**
 * PATCH /api/crm/projects
 * Body: { id, ...campos a actualizar (sin tocar stages/module) }
 *   + opcionales meta-fields: actor_email, note (van al audit log, NO a la tabla)
 * Para cambio de etapa usar /api/crm/projects/[id]/transition
 */

// Allow-list de columnas que PATCH puede tocar. Cualquier otro campo del body
// se descarta para no romper si el cliente envía campos meta o derivados (ej.
// actor_email, note, custom_data, current_module, *_stage, code, *_at).
const PATCHABLE_COLUMNS = new Set<string>([
  // Cliente
  'client_name', 'client_email', 'client_phone', 'client_address', 'client_city',
  'client_doc_type', 'client_doc_number', 'estrato', 'tipo_vivienda', 'lat', 'lng',
  'conjunto', 'casa_numero', 'carga_carro_electrico', 'autosuficiencia_objetivo_pct',
  // Comercial / Propuesta
  'invoice_kwh_mensual', 'invoice_valor_cop',
  'propuesta_kwp', 'propuesta_valor_cop', 'propuesta_url',
  'contrato_url', 'oferta_url', 'contrato_sent_at', 'contrato_signed_at',
  // Diseño / Ingeniería
  'diseno_kwp', 'diseno_paneles', 'diseno_baterias_cantidad',
  'diseno_inversor_marca', 'diseno_inversor_potencia_kw',
  'diseno_bateria_marca', 'diseno_bateria_capacidad_kwh',
  'diseno_inversor_categoria_id', 'diseno_panel_categoria_id', 'diseno_bateria_categoria_id',
  'diseno_yield_estimado_kwh_mes', 'diseno_notes', 'diseno_aprobado_por', 'diseno_aprobado_at',
  'tipo_red',
  // Operación / Instalación
  'visita_previa_id', 'visita_instalacion_id', 'reservation_id', 'house_id',
  'contractor_name', 'contractor_email', 'installation_date', 'lectura_inicial_kwh',
  'operativo_at', 'legalizado_at',
  // Metadata editable
  'title', 'assigned_to', 'notes',
]);

export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    if (!body.id) return NextResponse.json({ error: 'id requerido' }, { status: 400 });

    // Filtrar updates al allow-list de columnas. Stages, current_module, code,
    // created_at, updated_at, *_at se mantienen fuera del set, igual que meta
    // fields (actor_email, note).
    const updates: Record<string, unknown> = {};
    for (const k of Object.keys(body)) {
      if (PATCHABLE_COLUMNS.has(k)) updates[k] = body[k];
    }
    // Coerción de strings vacíos a null para columnas numéricas / FK uuid.
    // (Postgres rechaza '' donde espera numeric o uuid.)
    for (const k of Object.keys(updates)) {
      if (updates[k] === '') updates[k] = null;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'sin campos válidos para actualizar' }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from('crm_projects')
      .update(updates)
      .eq('id', body.id)
      .select('*')
      .single();
    if (error) {
      console.error('crm_projects PATCH error', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

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
