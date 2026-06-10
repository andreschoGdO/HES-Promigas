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
  diseno_inversor_potencia_kw: 'number',
  diseno_bateria_capacidad_kwh: 'number',
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
      'diseno_inversor_marca','diseno_inversor_potencia_kw',
      'diseno_bateria_marca','diseno_bateria_capacidad_kwh',
      'diseno_inversor_categoria_id','diseno_panel_categoria_id',
      'diseno_bateria_categoria_id','diseno_yield_estimado_kwh_mes','diseno_notes',
      'diseno_aprobado_por','tipo_red',
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

    // ─── Preflight: validar prerequisitos ANTES de aplicar la transición ───
    // Si alguno falla, la etapa NO cambia y el frontend recibe un mensaje claro.
    if (def.action === 'operations_dimensionado_to_alistamiento') {
      const preflight = await checkStockForAlistamiento(id);
      if (!preflight.ok) {
        // Auto-tag 'sin stock' para que el card lo refleje visualmente
        await addProjectTag(id, 'sin stock');
        return NextResponse.json({
          error: preflight.message,
          shortages: preflight.shortages,
        }, { status: 409 });
      } else {
        // Si antes tenía el tag y ahora sí hay stock, lo limpiamos.
        await removeProjectTag(id, 'sin stock');
      }
    }

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

    // ─── Side effects automáticos al cambiar de etapa ───
    const sideEffects: Record<string, unknown> = {};
    if (def.action === 'operations_dimensionado_to_alistamiento') {
      const r = await autoReserveInventoryForProject(updated[0], body.actor_email ?? null);
      if (r) sideEffects.reservation = r;
    }
    if (def.action === 'operations_to_operativo') {
      const r = await ensureFacturacionRecord(updated[0], body.actor_email ?? null);
      if (r) sideEffects.facturacion = r;
    }

    return NextResponse.json({ project: updated[0], action: def.action, side_effects: sideEffects });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}

/* ──────────────────────────────────────────────────────────────────
 * Side effects: cablean el flujo de Construcción con Inventario y Facturación.
 * ────────────────────────────────────────────────────────────────── */

const FAMILY_LABEL: Record<string, string> = {
  inverter: 'Inversor', battery: 'Batería', panel: 'Panel',
};

/** Añade un tag al proyecto (idempotente, sin duplicados). */
async function addProjectTag(projectId: string, tag: string): Promise<void> {
  const { data: p } = await supabaseAdmin
    .from('crm_projects')
    .select('tags')
    .eq('id', projectId)
    .single();
  const current = ((p?.tags ?? []) as string[]);
  if (current.includes(tag)) return;
  await supabaseAdmin
    .from('crm_projects')
    .update({ tags: [...current, tag] })
    .eq('id', projectId);
}

/** Quita un tag del proyecto si existe. */
async function removeProjectTag(projectId: string, tag: string): Promise<void> {
  const { data: p } = await supabaseAdmin
    .from('crm_projects')
    .select('tags')
    .eq('id', projectId)
    .single();
  const current = ((p?.tags ?? []) as string[]);
  if (!current.includes(tag)) return;
  await supabaseAdmin
    .from('crm_projects')
    .update({ tags: current.filter((t) => t !== tag) })
    .eq('id', projectId);
}

/**
 * Preflight para Dimensionado → Alistamiento: verifica que haya stock
 * suficiente de TODAS las categorías del diseño. Si falta cualquiera, bloquea.
 *
 * Reglas:
 *   - Si una categoría del diseño no está asignada (null), se ignora (no es bloqueante).
 *   - Si la categoría está asignada pero el stock disponible < cantidad necesaria, bloquea.
 *   - Si el proyecto ya tiene reservation_id, también pasa (no se requiere preflight).
 */
async function checkStockForAlistamiento(projectId: string): Promise<{ ok: true } | { ok: false; message: string; shortages: Array<{ family: string; family_label: string; needed: number; available: number }> }> {
  const { data: p } = await supabaseAdmin
    .from('crm_projects')
    .select('reservation_id, diseno_inversor_categoria_id, diseno_bateria_categoria_id, diseno_panel_categoria_id, diseno_paneles, diseno_baterias_cantidad')
    .eq('id', projectId)
    .single();
  if (!p) return { ok: true };
  if (p.reservation_id) return { ok: true };

  const requirements: Array<{ family: string; categoryId: string | null; qty: number }> = [
    { family: 'inverter', categoryId: p.diseno_inversor_categoria_id, qty: p.diseno_inversor_categoria_id ? 1 : 0 },
    { family: 'battery',  categoryId: p.diseno_bateria_categoria_id,  qty: p.diseno_bateria_categoria_id ? (Number(p.diseno_baterias_cantidad ?? 0) || 0) : 0 },
    { family: 'panel',    categoryId: p.diseno_panel_categoria_id,    qty: p.diseno_panel_categoria_id ? (Number(p.diseno_paneles ?? 0) || 0) : 0 },
  ].filter((r) => r.categoryId && r.qty > 0);

  const shortages: Array<{ family: string; family_label: string; needed: number; available: number }> = [];
  for (const req of requirements) {
    const { count } = await supabaseAdmin
      .from('inventory_items')
      .select('id', { count: 'exact', head: true })
      .eq('category_id', req.categoryId!)
      .eq('status', 'in_stock');
    const available = count ?? 0;
    if (available < req.qty) {
      shortages.push({ family: req.family, family_label: FAMILY_LABEL[req.family] ?? req.family, needed: req.qty, available });
    }
  }

  if (shortages.length === 0) return { ok: true };
  const summary = shortages.map((s) => `${s.family_label}: necesitas ${s.needed}, hay ${s.available} en bodega`).join(' · ');
  return {
    ok: false,
    message: `No hay stock suficiente para reservar — ${summary}. Recibe más equipos en Inventario antes de alistar.`,
    shortages,
  };
}


type ProjRow = {
  id: string; code: string | null; title: string; house_id: string | null;
  diseno_inversor_categoria_id: string | null;
  diseno_bateria_categoria_id: string | null;
  diseno_panel_categoria_id: string | null;
  diseno_paneles: number | null;
  diseno_baterias_cantidad: number | null;
  reservation_id: string | null;
};

/**
 * Al pasar de Dimensionado → Alistamiento: crear reserva automática con los
 * items disponibles en bodega de las categorías del diseño. Resultado se
 * devuelve para que el frontend pueda mostrarle al usuario qué se reservó
 * y qué faltó.
 *
 * Cantidades: 1 inversor, N paneles (diseno_paneles), M baterías
 * (diseno_baterias_cantidad). Si una categoría está vacía o no hay stock
 * suficiente, se omite silenciosamente y se reporta en la respuesta.
 */
async function autoReserveInventoryForProject(
  project: ProjRow,
  actorEmail: string | null,
): Promise<null | {
  reservation_id: string;
  reserved: Array<{ family: string; serial: string }>;
  shortages: Array<{ family: string; needed: number; available: number }>;
}> {
  // Si ya tiene una reserva, no duplicar
  if (project.reservation_id) return null;

  const requirements: Array<{ family: string; categoryId: string | null; qty: number }> = [
    { family: 'inverter', categoryId: project.diseno_inversor_categoria_id, qty: 1 },
    { family: 'battery',  categoryId: project.diseno_bateria_categoria_id,  qty: Math.max(1, Number(project.diseno_baterias_cantidad ?? 0)) || 0 },
    { family: 'panel',    categoryId: project.diseno_panel_categoria_id,    qty: Math.max(1, Number(project.diseno_paneles ?? 0)) || 0 },
  ].filter((r) => r.categoryId && r.qty > 0);

  if (requirements.length === 0) return null;

  // Buscar items disponibles por categoría
  const reservedItems: Array<{ id: string; serial_number: string; family: string }> = [];
  const shortages: Array<{ family: string; needed: number; available: number }> = [];

  for (const req of requirements) {
    const { data: stockItems } = await supabaseAdmin
      .from('inventory_items')
      .select('id, serial_number')
      .eq('category_id', req.categoryId!)
      .eq('status', 'in_stock')
      .order('acquired_at', { ascending: true, nullsFirst: false })
      .limit(req.qty);
    const available = (stockItems ?? []).length;
    if (available < req.qty) {
      shortages.push({ family: req.family, needed: req.qty, available });
    }
    for (const it of stockItems ?? []) {
      reservedItems.push({ id: it.id, serial_number: it.serial_number, family: req.family });
    }
  }

  if (reservedItems.length === 0) {
    // Nada que reservar — pero sí reportar shortages
    return { reservation_id: '', reserved: [], shortages };
  }

  // Crear la reserva en draft
  const { data: resv, error: resvErr } = await supabaseAdmin
    .from('inventory_reservations')
    .insert({
      title: `${project.code ?? 'PROY'} · ${project.title}`.slice(0, 200),
      status: 'draft',
      requested_by: actorEmail,
      notes: 'Auto-reservado al pasar a Alistamiento',
    })
    .select('id')
    .single();
  if (resvErr || !resv) return null;

  // Líneas de la reserva
  await supabaseAdmin
    .from('inventory_reservation_items')
    .insert(reservedItems.map((it) => ({ reservation_id: resv.id, item_id: it.id })));

  // Confirmar: items pasan a reserved + movimientos
  await supabaseAdmin
    .from('inventory_items')
    .update({ status: 'reserved' })
    .in('id', reservedItems.map((it) => it.id))
    .eq('status', 'in_stock');

  await supabaseAdmin.from('inventory_movements').insert(
    reservedItems.map((it) => ({
      item_id: it.id,
      type: 'reserve',
      from_status: 'in_stock',
      to_status: 'reserved',
      responsible_email: actorEmail,
      notes: `Auto-reserva para ${project.code ?? project.title}`,
    })),
  );

  await supabaseAdmin
    .from('inventory_reservations')
    .update({ status: 'confirmed', confirmed_at: new Date().toISOString() })
    .eq('id', resv.id);

  // Vincular reservation_id al proyecto
  await supabaseAdmin
    .from('crm_projects')
    .update({ reservation_id: resv.id })
    .eq('id', project.id);

  return {
    reservation_id: resv.id,
    reserved: reservedItems.map((it) => ({ family: it.family, serial: it.serial_number })),
    shortages,
  };
}

/**
 * Al pasar a Operativo: garantizar que existe un registro en
 * `facturacion_records` para que el flujo de cierre tenga su entrada en
 * Facturación lista. No congela ni sobrescribe valores existentes.
 */
async function ensureFacturacionRecord(project: ProjRow, actorEmail: string | null): Promise<null | { facturacion_record_id: string; created: boolean }> {
  const { data: existing } = await supabaseAdmin
    .from('facturacion_records')
    .select('id')
    .eq('project_id', project.id)
    .maybeSingle();
  if (existing) return { facturacion_record_id: existing.id, created: false };

  const { data: created, error } = await supabaseAdmin
    .from('facturacion_records')
    .insert({
      project_id: project.id,
      created_by: actorEmail,
      updated_by: actorEmail,
      notes: 'Creado automáticamente al marcar Operativo',
    })
    .select('id')
    .single();
  if (error || !created) return null;

  await supabaseAdmin.from('facturacion_events').insert({
    project_id: project.id,
    event_type: 'cost_change',
    field: '__init__',
    source: 'user',
    actor_email: actorEmail,
    notes: 'Registro de facturación inicializado al pasar a Operativo. Costos derivados disponibles desde inventario; congelar al cerrar el periodo.',
  });

  return { facturacion_record_id: created.id, created: true };
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
