import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { TRANSITIONS, type CrmModule } from '@/lib/crm-stages';

interface Ctx { params: Promise<{ id: string }>; }

// Columnas por tipo SQL (para coerción correcta de strings → tipos DB)
const COL_TYPES: Record<string, 'number' | 'integer' | 'date' | 'timestamptz' | 'uuid' | 'text'> = {
  estrato: 'integer',
  invoice_kwh_mensual: 'number',
  invoice_valor_cop: 'number',
  propuesta_kwp: 'number',
  propuesta_valor_cop: 'number',
  diseno_kwp: 'number',
  diseno_paneles: 'integer',
  diseno_baterias_cantidad: 'integer',
  diseno_yield_estimado_kwh_mes: 'number',
  autosuficiencia_objetivo_pct: 'number',
  lectura_inicial_kwh: 'number',
  lat: 'number',
  lng: 'number',
  contrato_sent_at: 'timestamptz',
  contrato_signed_at: 'timestamptz',
  diseno_aprobado_at: 'timestamptz',
  operativo_at: 'timestamptz',
  legalizado_at: 'timestamptz',
  installation_date: 'date',
  diseno_inversor_categoria_id: 'uuid',
  diseno_panel_categoria_id: 'uuid',
  diseno_bateria_categoria_id: 'uuid',
  visita_previa_id: 'uuid',
  visita_instalacion_id: 'uuid',
  reservation_id: 'uuid',
  house_id: 'uuid',
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function coerceValue(key: string, raw: unknown): { ok: true; value: unknown } | { ok: false; error: string } {
  if (raw === null || raw === undefined || raw === '') return { ok: true, value: null };
  const t = COL_TYPES[key] ?? 'text';
  const s = String(raw).trim();
  if (s === '') return { ok: true, value: null };
  switch (t) {
    case 'number': {
      const n = Number(s.replace(',', '.'));
      if (!Number.isFinite(n)) return { ok: false, error: `${key}: "${s}" no es número` };
      return { ok: true, value: n };
    }
    case 'integer': {
      const n = Number(s);
      if (!Number.isInteger(n)) return { ok: false, error: `${key}: "${s}" no es entero` };
      return { ok: true, value: n };
    }
    case 'uuid': {
      if (!UUID_RE.test(s)) return { ok: false, error: `${key}: "${s}" no es un UUID válido` };
      return { ok: true, value: s };
    }
    case 'date': {
      // Acepta YYYY-MM-DD o ISO
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return { ok: true, value: s };
      const d = new Date(s);
      if (Number.isNaN(d.getTime())) return { ok: false, error: `${key}: fecha inválida "${s}"` };
      return { ok: true, value: d.toISOString().slice(0, 10) };
    }
    case 'timestamptz': {
      // Si vino solo fecha YYYY-MM-DD, interpretarla como medio día Colombia (UTC-5)
      // para evitar off-by-one al reportar.
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
        return { ok: true, value: `${s}T12:00:00-05:00` };
      }
      const d = new Date(s);
      if (Number.isNaN(d.getTime())) return { ok: false, error: `${key}: timestamp inválido "${s}"` };
      return { ok: true, value: d.toISOString() };
    }
    default:
      return { ok: true, value: s };
  }
}

/**
 * POST /api/crm/projects/[id]/transition
 */
export async function POST(request: Request, context: Ctx) {
  try {
    const { id } = await context.params;
    const body = await request.json();
    if (!body.action) return NextResponse.json({ error: 'action requerido' }, { status: 400 });

    const def = TRANSITIONS.find((t) => t.action === body.action);
    if (!def) return NextResponse.json({ error: `acción desconocida: ${body.action}` }, { status: 400 });

    // Cargar proyecto actual para validar
    const { data: project, error: getErr } = await supabaseAdmin
      .from('crm_projects')
      .select('id, current_module, sales_stage, engineering_stage, operations_stage')
      .eq('id', id)
      .single();
    if (getErr || !project) return NextResponse.json({ error: 'proyecto no encontrado' }, { status: 404 });

    const currentStageForModule =
      def.fromModule === 'operations' ? project.operations_stage
      : null;
    if (project.current_module !== def.fromModule || currentStageForModule !== def.fromStage) {
      return NextResponse.json({
        error: `transición ilegal: el proyecto está en ${project.current_module}/${currentStageForModule}, esta acción aplica solo desde ${def.fromModule}/${def.fromStage}`,
      }, { status: 400 });
    }

    // Validar campos requeridos + coerción de tipos
    const coerced: Record<string, unknown> = {};
    for (const f of def.requiredFields) {
      const raw = body[f.key];
      if (f.required && (raw === undefined || raw === null || raw === '')) {
        return NextResponse.json({ error: `${f.label} (${f.key}) es requerido` }, { status: 400 });
      }
      if (raw !== undefined) {
        const c = coerceValue(f.key, raw);
        if (!c.ok) return NextResponse.json({ error: c.error }, { status: 400 });
        if (c.value !== null) coerced[f.key] = c.value;
      }
    }

    // Columnas físicas reconocidas en crm_projects
    const knownColumns = new Set([
      'client_name','client_email','client_phone','client_address','client_city',
      'client_doc_type','client_doc_number','estrato','tipo_vivienda','lat','lng',
      'conjunto','casa_numero','carga_carro_electrico','autosuficiencia_objetivo_pct',
      'invoice_kwh_mensual','invoice_valor_cop',
      'propuesta_kwp','propuesta_valor_cop','propuesta_url','contrato_url','oferta_url',
      'contrato_sent_at','contrato_signed_at',
      'diseno_kwp','diseno_paneles','diseno_baterias_cantidad',
      'diseno_inversor_categoria_id','diseno_panel_categoria_id',
      'diseno_bateria_categoria_id','diseno_yield_estimado_kwh_mes','diseno_notes',
      'diseno_aprobado_por',
      'visita_previa_id','visita_instalacion_id','reservation_id','house_id',
      'contractor_name','contractor_email','installation_date','lectura_inicial_kwh',
      'operativo_at','legalizado_at','assigned_to','notes',
    ]);

    // Campos del body que no son del schema fijo van a custom_data JSONB
    const customExtras: Record<string, unknown> = {};
    const META_KEYS = new Set(['action','actor_email','notes_override','id']);
    for (const k of Object.keys(body)) {
      if (META_KEYS.has(k)) continue;
      if (k in coerced) continue;
      if (knownColumns.has(k)) {
        const c = coerceValue(k, body[k]);
        if (!c.ok) return NextResponse.json({ error: c.error }, { status: 400 });
        if (c.value !== null) coerced[k] = c.value;
      } else if (body[k] !== '' && body[k] !== null && body[k] !== undefined) {
        // Campo personalizado — guardarlo en custom_data
        customExtras[k] = body[k];
      }
    }

    // Si vinieron campos personalizados, hacer merge contra el custom_data existente
    if (Object.keys(customExtras).length > 0) {
      const { data: cur } = await supabaseAdmin
        .from('crm_projects')
        .select('custom_data')
        .eq('id', id)
        .single();
      coerced.custom_data = { ...(cur?.custom_data ?? {}), ...customExtras };
    }

    // Construir update
    const updates: Record<string, unknown> = { ...coerced, current_module: def.toModule };
    if (def.toModule === 'operations')  updates.operations_stage = def.toStage;
    if (def.toModule === 'closed')      updates.closed_at = new Date().toISOString();

    // Marcar fromModule como completado SOLO si no se pidió keepSourceStage
    if (def.fromModule !== def.toModule && !def.keepSourceStage) {
      if (def.fromModule === 'operations')  updates.operations_stage = 'completado';
    }

    // Auto-stamps
    if (def.action === 'operations_to_operativo') updates.operativo_at = new Date().toISOString();

    // UPDATE condicional con guard contra race: solo aplica si el estado no ha cambiado
    // desde nuestra lectura. Si otra request paralela ya ejecutó la transición, count=0.
    const stageCol = 'operations_stage';
    const { data: updated, error: updErr } = await supabaseAdmin
      .from('crm_projects')
      .update(updates)
      .eq('id', id)
      .eq('current_module', def.fromModule)
      .eq(stageCol, def.fromStage)
      .select('*');
    if (updErr) throw updErr;
    if (!updated || updated.length === 0) {
      return NextResponse.json({
        error: 'Transición no aplicada: el proyecto fue modificado por otra operación. Recarga y reintenta.',
      }, { status: 409 });
    }

    // Audit log
    await supabaseAdmin.from('crm_project_events').insert({
      project_id: id,
      event_type: def.fromModule !== def.toModule ? 'handoff' : 'stage_change',
      from_module: def.fromModule,
      to_module: def.toModule,
      from_stage: def.fromStage,
      to_stage: def.toStage,
      actor_email: body.actor_email ?? null,
      notes: body.notes_override ?? def.noteTemplate ?? def.label,
      data: { action: def.action, fields: coerced },
    });

    return NextResponse.json({ project: updated[0], action: def.action });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}

/** GET — devuelve transiciones legales para este proyecto */
export async function GET(_request: Request, context: Ctx) {
  const { id } = await context.params;
  const { data: project } = await supabaseAdmin
    .from('crm_projects')
    .select('current_module, sales_stage, engineering_stage, operations_stage')
    .eq('id', id)
    .single();
  if (!project) return NextResponse.json({ error: 'no encontrado' }, { status: 404 });

  const mod = project.current_module as CrmModule;
  const stage = mod === 'operations' ? project.operations_stage : null;

  const available = TRANSITIONS.filter((t) => t.fromModule === mod && t.fromStage === stage);
  return NextResponse.json({ current_module: mod, current_stage: stage, transitions: available });
}
