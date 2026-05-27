import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { TRANSITIONS, type CrmModule } from '@/lib/crm-stages';

interface Ctx { params: Promise<{ id: string }>; }

/**
 * POST /api/crm/projects/[id]/transition
 * Body: { action: string, actor_email?: string, ...campos requeridos por la transición }
 *
 * Valida que la transición sea legal desde el estado actual, aplica el cambio
 * de etapa/módulo, persiste los campos enviados y registra el evento de audit.
 */
export async function POST(request: Request, context: Ctx) {
  try {
    const { id } = await context.params;
    const body = await request.json();
    if (!body.action) return NextResponse.json({ error: 'action requerido' }, { status: 400 });

    const def = TRANSITIONS.find((t) => t.action === body.action);
    if (!def) return NextResponse.json({ error: `acción desconocida: ${body.action}` }, { status: 400 });

    // Cargar proyecto actual
    const { data: project, error: getErr } = await supabaseAdmin
      .from('crm_projects')
      .select('*')
      .eq('id', id)
      .single();
    if (getErr || !project) return NextResponse.json({ error: 'proyecto no encontrado' }, { status: 404 });

    // Validar precondición: módulo + etapa
    const currentStageForModule =
      def.fromModule === 'sales' ? project.sales_stage
      : def.fromModule === 'engineering' ? project.engineering_stage
      : def.fromModule === 'operations' ? project.operations_stage
      : null;
    if (project.current_module !== def.fromModule || currentStageForModule !== def.fromStage) {
      return NextResponse.json({
        error: `transición ilegal: el proyecto está en ${project.current_module}/${currentStageForModule}, esta acción aplica solo desde ${def.fromModule}/${def.fromStage}`,
      }, { status: 400 });
    }

    // Validar campos requeridos
    for (const f of def.requiredFields) {
      if (f.required && (body[f.key] === undefined || body[f.key] === null || body[f.key] === '')) {
        return NextResponse.json({ error: `${f.label} (${f.key}) es requerido` }, { status: 400 });
      }
    }

    // Construir el update del proyecto
    const updates: Record<string, unknown> = {
      current_module: def.toModule,
    };
    // Avanzar la etapa del módulo destino
    if (def.toModule === 'sales')       updates.sales_stage = def.toStage;
    if (def.toModule === 'engineering') updates.engineering_stage = def.toStage;
    if (def.toModule === 'operations')  updates.operations_stage = def.toStage;
    if (def.toModule === 'closed')      updates.closed_at = new Date().toISOString();

    // Si la transición sale del módulo, el módulo de origen queda en 'completado'
    if (def.fromModule !== def.toModule) {
      if (def.fromModule === 'sales')       updates.sales_stage = 'completado';
      if (def.fromModule === 'engineering') updates.engineering_stage = 'completado';
      if (def.fromModule === 'operations')  updates.operations_stage = 'completado';
    }

    // Persistir los campos del body que correspondan al schema
    const allowedFields = new Set([
      'client_name','client_email','client_phone','client_address','client_city',
      'client_doc_type','client_doc_number','estrato','tipo_vivienda','lat','lng',
      'invoice_kwh_mensual','invoice_valor_cop',
      'propuesta_kwp','propuesta_valor_cop','propuesta_url','contrato_url','oferta_url',
      'contrato_sent_at','contrato_signed_at',
      'diseno_kwp','diseno_paneles','diseno_inversor_categoria_id','diseno_panel_categoria_id',
      'diseno_bateria_categoria_id','diseno_yield_estimado_kwh_mes','diseno_notes',
      'diseno_aprobado_por',
      'visita_previa_id','visita_instalacion_id','reservation_id','house_id',
      'contractor_name','contractor_email','installation_date','lectura_inicial_kwh',
      'operativo_at','legalizado_at','assigned_to','notes',
    ]);
    for (const k of Object.keys(body)) {
      if (allowedFields.has(k) && body[k] !== undefined && body[k] !== '') {
        updates[k] = body[k];
      }
    }

    // Auto-stamps por transición
    if (def.action === 'engineering_aprobar') updates.diseno_aprobado_at = new Date().toISOString();
    if (def.action === 'operations_to_operativo') updates.operativo_at = new Date().toISOString();

    const { data: updated, error: updErr } = await supabaseAdmin
      .from('crm_projects')
      .update(updates)
      .eq('id', id)
      .select('*')
      .single();
    if (updErr) throw updErr;

    // Registrar evento
    await supabaseAdmin.from('crm_project_events').insert({
      project_id: id,
      event_type: def.fromModule !== def.toModule ? 'handoff' : 'stage_change',
      from_module: def.fromModule,
      to_module: def.toModule,
      from_stage: def.fromStage,
      to_stage: def.toStage,
      actor_email: body.actor_email ?? null,
      notes: body.notes_override ?? def.noteTemplate ?? `${def.label}`,
      data: { action: def.action, fields: Object.fromEntries(Object.entries(body).filter(([k]) => allowedFields.has(k))) },
    });

    return NextResponse.json({ project: updated, action: def.action });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}

/**
 * GET — devuelve transiciones legales para este proyecto desde su estado actual
 */
export async function GET(_request: Request, context: Ctx) {
  const { id } = await context.params;
  const { data: project } = await supabaseAdmin
    .from('crm_projects')
    .select('current_module, sales_stage, engineering_stage, operations_stage')
    .eq('id', id)
    .single();
  if (!project) return NextResponse.json({ error: 'no encontrado' }, { status: 404 });

  const mod = project.current_module as CrmModule;
  const stage = mod === 'sales' ? project.sales_stage
    : mod === 'engineering' ? project.engineering_stage
    : mod === 'operations' ? project.operations_stage
    : null;

  const available = TRANSITIONS.filter((t) => t.fromModule === mod && t.fromStage === stage);
  return NextResponse.json({ current_module: mod, current_stage: stage, transitions: available });
}
