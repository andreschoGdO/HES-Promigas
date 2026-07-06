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

    // ─── Para Alistamiento: la reserva DEBE crearse antes de cambiar la etapa.
    // Si falla por cualquier motivo (categorías, stock, error inesperado), la
    // etapa NO cambia y se tagueea el proyecto para que el problema sea visible.
    let preReservation: Awaited<ReturnType<typeof autoReserveInventoryForProject>> = null;
    if (def.action === 'operations_dimensionado_to_alistamiento') {
      // 1. Categorías del diseño deben estar seleccionadas — si no, no hay qué reservar.
      const missingCats = await checkDesignCategoriesPresent(id);
      if (missingCats.length > 0) {
        await addProjectTag(id, 'sin modelos');
        return NextResponse.json({
          error: `Falta seleccionar el modelo de catálogo para: ${missingCats.join(', ')}. Abre el proyecto, clic en "Editar" y elige los modelos en la sección "Equipos del diseño (catálogo)" antes de alistar.`,
          missing_categories: missingCats,
        }, { status: 409 });
      }
      await removeProjectTag(id, 'sin modelos');

      // 2. Stock disponible para esas categorías
      const preflight = await checkStockForAlistamiento(id);
      if (!preflight.ok) {
        await addProjectTag(id, 'sin stock');
        return NextResponse.json({
          error: preflight.message,
          shortages: preflight.shortages,
        }, { status: 409 });
      }
      await removeProjectTag(id, 'sin stock');

      // 3. Crear la reserva ANTES de cambiar la etapa
      const { data: projForReserve } = await supabaseAdmin
        .from('crm_projects')
        .select('id, code, title, house_id, client_city, diseno_inversor_categoria_id, diseno_bateria_categoria_id, diseno_panel_categoria_id, diseno_paneles, diseno_baterias_cantidad, reservation_id')
        .eq('id', id)
        .single();
      if (!projForReserve) {
        return NextResponse.json({ error: 'Proyecto no encontrado al crear reserva' }, { status: 404 });
      }
      try {
        preReservation = await autoReserveInventoryForProject(projForReserve as ProjRow, body.actor_email ?? null);
      } catch (e) {
        await addProjectTag(id, 'reserva falló');
        return NextResponse.json({
          error: 'Falló la creación de reserva: ' + (e instanceof Error ? e.message : 'error desconocido'),
        }, { status: 500 });
      }
      // Si retornó null o sin items reservados, NO avanzar.
      if (!preReservation) {
        await addProjectTag(id, 'sin reserva');
        return NextResponse.json({
          error: 'No se pudo crear la reserva automática. Revisa que haya items in_stock con las categorías exactas del diseño (no solo de la misma marca).',
        }, { status: 409 });
      }
      if (preReservation.reserved.length === 0) {
        await addProjectTag(id, 'sin reserva');
        return NextResponse.json({
          error: 'No hay items in_stock para las categorías del diseño. Verifica que las categorías que seleccionaste en el proyecto coincidan con las categorías de los equipos en /inventario → Equipos.',
        }, { status: 409 });
      }
      // Reserva OK — limpiar el tag de fallo si quedó de un intento previo.
      await removeProjectTag(id, 'sin reserva');
      await removeProjectTag(id, 'reserva falló');
    }

    // ─── Para Instalación: validar que el proyecto tiene contractor + fecha.
    if (def.action === 'operations_to_instalacion') {
      const blockers = await checkReadyForInstalacion(id, coerced);
      if (blockers.length > 0) {
        await addProjectTag(id, 'falta contratista');
        return NextResponse.json({
          error: `No se puede iniciar instalación. Faltan: ${blockers.join(', ')}.`,
          blockers,
        }, { status: 409 });
      }
      await removeProjectTag(id, 'falta contratista');
    }

    // ─── Para Operativo: la reserva DEBE poder cumplirse — items pasan a installed
    // antes de cambiar la etapa. Si no se puede instalar nada, NO avanzar.
    let preInstallation: Awaited<ReturnType<typeof fulfillReservationOnOperativo>> = null;
    if (def.action === 'operations_to_operativo') {
      const { data: projOp } = await supabaseAdmin
        .from('crm_projects')
        .select('id, code, title, house_id, reservation_id, diseno_inversor_categoria_id, diseno_bateria_categoria_id, diseno_panel_categoria_id, diseno_paneles, diseno_baterias_cantidad')
        .eq('id', id)
        .single();
      if (!projOp) {
        return NextResponse.json({ error: 'Proyecto no encontrado al verificar instalación' }, { status: 404 });
      }
      // Validaciones bloqueantes — auto-resolver house_id si no está pero el
      // proyecto tiene casa_numero que matchea con una client_houses.
      let resolvedHouseId = projOp.house_id;
      if (!resolvedHouseId) {
        const { data: pCasaInfo } = await supabaseAdmin
          .from('crm_projects').select('casa_numero, conjunto').eq('id', id).single();
        const casaQuery = pCasaInfo?.casa_numero?.trim();
        if (casaQuery) {
          // Buscar coincidencia exacta o por sufijo "Casa N"
          const { data: candidates } = await supabaseAdmin
            .from('client_houses').select('id, casa').or(`casa.eq.${casaQuery},casa.ilike.%${casaQuery}`);
          const list = candidates ?? [];
          // Preferir match exacto sobre ilike
          const exact = list.find((h) => h.casa === casaQuery);
          const match = exact ?? list[0];
          if (match) {
            await supabaseAdmin.from('crm_projects').update({ house_id: match.id }).eq('id', id);
            resolvedHouseId = match.id;
          }
        }
      }
      if (!resolvedHouseId) {
        await addProjectTag(id, 'sin casa');
        return NextResponse.json({
          error: 'El proyecto no tiene casa asignada. Abre el proyecto → clic en "Editar" → sección "Casa vinculada" y selecciona la casa. Si la casa no aparece, créala desde Metrum o usa /api/houses/build.',
        }, { status: 409 });
      }
      await removeProjectTag(id, 'sin casa');
      // refresh projOp with resolved house_id
      projOp.house_id = resolvedHouseId;
      if (!projOp.reservation_id) {
        return NextResponse.json({
          error: 'El proyecto no tiene reserva activa. Debió haberse creado en Alistamiento — vuelve a esa etapa.',
        }, { status: 409 });
      }
      // Fuentes posibles de seriales para la reserva por cantidades (mig 44):
      //   1. body.serials — explícito del cliente { [category_id]: string[] }
      //   2. Acta de instalación vinculada — leemos inv_serials, panel_serials,
      //      batt_serials del form_data y los mapeamos a los category_id del
      //      diseño del proyecto.
      // La primera fuente gana si viene. La segunda es el flujo esperado
      // para producción (técnico llena acta → CRM avanza a Operativo).
      let serialsFromSource: Record<string, string[]> | null =
        (body.serials && typeof body.serials === 'object')
          ? body.serials as Record<string, string[]>
          : null;
      if (!serialsFromSource) {
        serialsFromSource = await readSerialsFromActa(projOp as ProjRow);
      }
      preInstallation = await fulfillReservationOnOperativo(projOp as ProjRow, body.actor_email ?? null, serialsFromSource);
      if (!preInstallation) {
        return NextResponse.json({
          error: 'No se pudo procesar la instalación de los items reservados.',
        }, { status: 500 });
      }
      const totalSuccess = preInstallation.installed.length + preInstallation.already_installed.length;
      if (totalSuccess === 0) {
        await addProjectTag(id, 'no se instaló');
        return NextResponse.json({
          error: `No se instaló ningún equipo. ${preInstallation.skipped.length > 0 ? 'Items omitidos:\n' + preInstallation.skipped.join('\n') : 'Verifica que los items de la reserva estén en estado reserved.'}`,
          skipped: preInstallation.skipped,
        }, { status: 409 });
      }
      await removeProjectTag(id, 'no se instaló');
    }

    // ─── Para Cerrar Proyecto: validar que todos los items siguen instalados en la casa
    if (def.action === 'operations_to_completado') {
      const blockers = await checkReadyForClose(id);
      if (blockers.length > 0) {
        return NextResponse.json({
          error: `No se puede cerrar el proyecto. Pendientes: ${blockers.join(', ')}.`,
          blockers,
        }, { status: 409 });
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
    if (preReservation) sideEffects.reservation = preReservation;
    if (preInstallation) sideEffects.installation = preInstallation;
    if (def.action === 'operations_to_operativo') {
      const r = await ensureFacturacionRecord(updated[0], body.actor_email ?? null);
      if (r) sideEffects.facturacion = r;
    }
    // Auto-crear tareas en el Planner para visibilidad de fechas
    if (def.action === 'operations_to_instalacion') {
      const t = await createPlannerTaskInstalacion(updated[0], body.actor_email ?? null);
      if (t) sideEffects.planner_task = t;
    }
    if (def.action === 'operations_to_logistica_inversa') {
      const t = await createPlannerTaskTicket(updated[0], body.actor_email ?? null, coerced.notes as string | undefined);
      if (t) sideEffects.planner_task = t;
    }
    // Devolver a Dimensionado desde Alistamiento → cancelar reserva activa
    // y liberar items para que la próxima auto-reserva funcione.
    if (def.action === 'operations_back_to_dimensionado') {
      const r = await cancelActiveReservation(updated[0], body.actor_email ?? null);
      if (r) sideEffects.reservation_cancelled = r;
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

/**
 * Devuelve los labels de las categorías que faltan en el diseño del proyecto.
 * Solo se exige Inversor (siempre 1) y, si la cantidad es > 0, Baterías y Paneles.
 */
async function checkDesignCategoriesPresent(projectId: string): Promise<string[]> {
  const { data: p } = await supabaseAdmin
    .from('crm_projects')
    .select('diseno_inversor_categoria_id, diseno_bateria_categoria_id, diseno_panel_categoria_id, diseno_paneles, diseno_baterias_cantidad')
    .eq('id', projectId)
    .single();
  if (!p) return [];
  const missing: string[] = [];
  if (!p.diseno_inversor_categoria_id) missing.push('Inversor');
  if ((p.diseno_baterias_cantidad ?? 0) > 0 && !p.diseno_bateria_categoria_id) missing.push('Batería');
  if ((p.diseno_paneles ?? 0) > 0 && !p.diseno_panel_categoria_id) missing.push('Panel');
  return missing;
}

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

/**
 * Cancela la reserva activa del proyecto (si la hay) y libera items
 * reserved → in_stock. Usado al devolver de Alistamiento → Dimensionado.
 */
async function cancelActiveReservation(project: ProjRow, actorEmail: string | null): Promise<null | { reservation_id: string; released: number }> {
  if (!project.reservation_id) return null;
  const { data: resv } = await supabaseAdmin
    .from('inventory_reservations')
    .select('id, status, title')
    .eq('id', project.reservation_id)
    .maybeSingle();
  if (!resv || (resv.status !== 'draft' && resv.status !== 'confirmed')) {
    // Ya estaba fulfilled o cancelled — solo limpiar la referencia.
    await supabaseAdmin.from('crm_projects').update({ reservation_id: null }).eq('id', project.id);
    return null;
  }

  let released = 0;

  // Modelo NUEVO (mig 44): borrar líneas por cantidad. No hay items que liberar
  // porque el modelo nuevo no cambia el status de inventory_items al reservar.
  const { data: lineRows } = await supabaseAdmin
    .from('inventory_reservation_lines')
    .select('id, qty_reserved')
    .eq('reservation_id', resv.id);
  if ((lineRows ?? []).length > 0) {
    released = (lineRows ?? []).reduce((acc, l) => acc + Number(l.qty_reserved ?? 0), 0);
    await supabaseAdmin
      .from('inventory_reservation_lines')
      .delete()
      .eq('reservation_id', resv.id);
  }

  // Modelo VIEJO (pre-mig 44): liberar items reservados (status reserved → in_stock)
  const { data: itemLines } = await supabaseAdmin
    .from('inventory_reservation_items')
    .select('item_id')
    .eq('reservation_id', resv.id);
  const itemIds = (itemLines ?? []).map((l) => l.item_id);
  if (itemIds.length > 0 && resv.status === 'confirmed') {
    const { data: updated } = await supabaseAdmin
      .from('inventory_items')
      .update({ status: 'in_stock' })
      .in('id', itemIds)
      .eq('status', 'reserved')
      .select('id');
    released += updated?.length ?? 0;
    if ((updated ?? []).length > 0) {
      await supabaseAdmin.from('inventory_movements').insert(
        (updated ?? []).map((u) => ({
          item_id: u.id, type: 'unreserve',
          from_status: 'reserved', to_status: 'in_stock',
          responsible_email: actorEmail,
          notes: `Reserva ${resv.title} cancelada al devolver proyecto a Dimensionado`,
        })),
      );
    }
  }

  // Restituir stock de consumibles si los hay
  try {
    const { data: consLines } = await supabaseAdmin
      .from('inventory_reservation_consumables')
      .select('consumable_id, quantity, inventory_consumables(stock_quantity)')
      .eq('reservation_id', resv.id);
    type CL = { consumable_id: string; quantity: number; inventory_consumables: { stock_quantity: number } | { stock_quantity: number }[] | null };
    if (resv.status === 'confirmed') {
      for (const line of (consLines ?? []) as CL[]) {
        const cons = Array.isArray(line.inventory_consumables) ? line.inventory_consumables[0] : line.inventory_consumables;
        if (!cons) continue;
        await supabaseAdmin
          .from('inventory_consumables')
          .update({ stock_quantity: Number(cons.stock_quantity) + Number(line.quantity) })
          .eq('id', line.consumable_id);
        await supabaseAdmin.from('inventory_movements').insert({
          consumable_id: line.consumable_id, type: 'unreserve', quantity: line.quantity,
          responsible_email: actorEmail,
          notes: `Reserva ${resv.title} cancelada al devolver proyecto a Dimensionado`,
        });
      }
    }
  } catch { /* tabla puede no existir si migration 23 no se ha aplicado */ }

  // Marcar la reserva como cancelled + limpiar reservation_id del proyecto
  await supabaseAdmin
    .from('inventory_reservations')
    .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
    .eq('id', resv.id);
  await supabaseAdmin.from('crm_projects').update({ reservation_id: null }).eq('id', project.id);

  return { reservation_id: resv.id, released };
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
    .select('reservation_id, client_city, diseno_inversor_categoria_id, diseno_bateria_categoria_id, diseno_panel_categoria_id, diseno_paneles, diseno_baterias_cantidad')
    .eq('id', projectId)
    .single();
  if (!p) return { ok: true };
  if (p.reservation_id) return { ok: true };

  const requirements: Array<{ family: string; categoryId: string | null; qty: number }> = [
    { family: 'inverter', categoryId: p.diseno_inversor_categoria_id, qty: p.diseno_inversor_categoria_id ? 1 : 0 },
    { family: 'battery',  categoryId: p.diseno_bateria_categoria_id,  qty: p.diseno_bateria_categoria_id ? (Number(p.diseno_baterias_cantidad ?? 0) || 0) : 0 },
    { family: 'panel',    categoryId: p.diseno_panel_categoria_id,    qty: p.diseno_panel_categoria_id ? (Number(p.diseno_paneles ?? 0) || 0) : 0 },
  ].filter((r) => r.categoryId && r.qty > 0);

  // Determinar bodega según ciudad — el preflight verifica stock SOLO en esa bodega.
  const warehouseCode = warehouseCodeForCity(p.client_city);
  let warehouseId: string | null = null;
  let bodegaLabel = 'bodega';
  if (warehouseCode) {
    const { data: wh } = await supabaseAdmin
      .from('warehouses')
      .select('id, name')
      .eq('code', warehouseCode)
      .maybeSingle();
    warehouseId = wh?.id ?? null;
    if (wh?.name) bodegaLabel = wh.name;
  }

  const shortages: Array<{ family: string; family_label: string; needed: number; available: number }> = [];
  for (const req of requirements) {
    // Stock físico in_stock en la bodega
    let stockQ = supabaseAdmin
      .from('inventory_items')
      .select('id', { count: 'exact', head: true })
      .eq('category_id', req.categoryId!)
      .eq('status', 'in_stock');
    if (warehouseId) stockQ = stockQ.eq('warehouse_id', warehouseId);
    const { count: stockCount } = await stockQ;

    // Cantidad ya reservada por otras reservas activas para
    // (categoría × bodega) — se descuenta del físico para el "disponible real"
    let pending = 0;
    if (warehouseId) {
      const { data: activeLines } = await supabaseAdmin
        .from('inventory_reservation_lines')
        .select('qty_reserved, qty_delivered, inventory_reservations!inner(status)')
        .eq('category_id', req.categoryId!)
        .eq('warehouse_id', warehouseId);
      type ActiveLine = { qty_reserved: number; qty_delivered: number; inventory_reservations: { status: string } | { status: string }[] | null };
      pending = ((activeLines ?? []) as unknown as ActiveLine[]).reduce((acc, l) => {
        const resv = Array.isArray(l.inventory_reservations) ? l.inventory_reservations[0] : l.inventory_reservations;
        if (!resv) return acc;
        if (resv.status === 'confirmed' || resv.status === 'draft') {
          return acc + Math.max(0, Number(l.qty_reserved) - Number(l.qty_delivered));
        }
        return acc;
      }, 0);
    }

    const available = Math.max(0, (stockCount ?? 0) - pending);
    if (available < req.qty) {
      shortages.push({ family: req.family, family_label: FAMILY_LABEL[req.family] ?? req.family, needed: req.qty, available });
    }
  }

  if (shortages.length === 0) return { ok: true };
  const summary = shortages.map((s) => `${s.family_label}: necesitas ${s.needed}, hay ${s.available} en ${bodegaLabel}`).join(' · ');
  return {
    ok: false,
    message: `No hay stock suficiente en ${bodegaLabel} para reservar — ${summary}. Recibe más equipos en Inventario antes de alistar, o transfiere desde otra bodega.`,
    shortages,
  };
}


type ProjRow = {
  id: string; code: string | null; title: string; house_id: string | null;
  client_city: string | null;
  diseno_inversor_categoria_id: string | null;
  diseno_bateria_categoria_id: string | null;
  diseno_panel_categoria_id: string | null;
  diseno_paneles: number | null;
  diseno_baterias_cantidad: number | null;
  reservation_id: string | null;
};

/**
 * Ciudad del proyecto → código de bodega (mig 36).
 * Turbaco, Arjona, Magangué, etc. → Cartagena (regional Bolívar).
 * Soledad, Malambo, etc. → Barranquilla (regional Atlántico).
 * Todo el Valle → Cali.
 * Devuelve null si no matchea → la reserva NO filtra por bodega (fallback
 * al comportamiento viejo) y agrega tag `bodega no identificada` al proyecto.
 */
function warehouseCodeForCity(city: string | null | undefined): string | null {
  if (!city) return null;
  const c = city.trim().toLowerCase();
  const cali = ['cali', 'jamundí', 'jamundi', 'yumbo', 'palmira', 'valle', 'buenaventura'];
  const barranquilla = ['barranquilla', 'soledad', 'malambo', 'puerto colombia', 'sabanagrande', 'galapa'];
  const cartagena = ['cartagena', 'turbaco', 'arjona', 'magangué', 'magangue', 'bolívar', 'bolivar', 'sincelejo', 'monteria', 'montería'];
  if (cali.some((x) => c.includes(x))) return 'BODEGA_CALI';
  if (barranquilla.some((x) => c.includes(x))) return 'BODEGA_BARRANQUILLA';
  if (cartagena.some((x) => c.includes(x))) return 'BODEGA_CARTAGENA';
  return null;
}

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
/**
 * Reserva por CANTIDADES (mig 44+). Ya no aparta items específicos.
 *
 * Flujo nuevo:
 *   1. Verifica que haya stock suficiente por categoría en la bodega
 *      de la ciudad (in_stock − reservado en otras líneas activas).
 *   2. Crea la reserva en status='confirmed' + inserta 3 líneas:
 *      inversor (1), batería (N), panel (M).
 *   3. NO toca inventory_items — el UI de /inventario ahora debe mostrar
 *      "reservado" como métrica derivada de las lines.
 *   4. Los items reales se marcan como installed solo cuando el acta de
 *      instalación aporta los seriales (fulfillReservationOnOperativo).
 *
 * Reservas existentes con `inventory_reservation_items` (modelo viejo)
 * siguen funcionando por compatibilidad — este código solo crea nuevas
 * en el modelo por líneas.
 */
async function autoReserveInventoryForProject(
  project: ProjRow,
  actorEmail: string | null,
): Promise<null | {
  reservation_id: string;
  reserved: Array<{ family: string; qty: number; category_id: string }>;
  shortages: Array<{ family: string; needed: number; available: number }>;
  reused?: boolean;
}> {
  // Si ya tiene reservation_id, verificar si hay líneas del modelo nuevo o
  // items del viejo. Si el modelo viejo, cancelamos y creamos una nueva
  // porque no podemos convertir automáticamente.
  if (project.reservation_id) {
    const { data: existingResv } = await supabaseAdmin
      .from('inventory_reservations')
      .select('id, status')
      .eq('id', project.reservation_id)
      .maybeSingle();
    if (existingResv && (existingResv.status === 'confirmed' || existingResv.status === 'draft')) {
      // Ya tiene reserva activa — verificar que tenga líneas del modelo nuevo
      const { data: lines, count: linesCount } = await supabaseAdmin
        .from('inventory_reservation_lines')
        .select('category_id, warehouse_id, qty_reserved, inventory_categories(family)', { count: 'exact' })
        .eq('reservation_id', existingResv.id);
      if ((linesCount ?? 0) > 0) {
        type LineRow = { category_id: string; warehouse_id: string; qty_reserved: number; inventory_categories: { family?: string } | { family?: string }[] | null };
        return {
          reservation_id: existingResv.id,
          reserved: ((lines ?? []) as unknown as LineRow[]).map((l) => {
            const cat = Array.isArray(l.inventory_categories) ? l.inventory_categories[0] : l.inventory_categories;
            return { family: cat?.family ?? 'unknown', qty: Number(l.qty_reserved), category_id: l.category_id };
          }),
          shortages: [],
          reused: true,
        };
      }
      // Sin líneas ni items → reserva inservible, cancelarla y crear nueva
      await supabaseAdmin.from('inventory_reservations')
        .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
        .eq('id', existingResv.id);
    }
    await supabaseAdmin.from('crm_projects').update({ reservation_id: null }).eq('id', project.id);
  }

  const requirements: Array<{ family: string; categoryId: string | null; qty: number }> = [
    { family: 'inverter', categoryId: project.diseno_inversor_categoria_id, qty: 1 },
    { family: 'battery',  categoryId: project.diseno_bateria_categoria_id,  qty: Math.max(1, Number(project.diseno_baterias_cantidad ?? 0)) || 0 },
    { family: 'panel',    categoryId: project.diseno_panel_categoria_id,    qty: Math.max(1, Number(project.diseno_paneles ?? 0)) || 0 },
  ].filter((r) => r.categoryId && r.qty > 0);

  if (requirements.length === 0) return null;

  // Bodega según ciudad
  const warehouseCode = warehouseCodeForCity(project.client_city);
  let warehouseId: string | null = null;
  if (warehouseCode) {
    const { data: wh } = await supabaseAdmin
      .from('warehouses').select('id').eq('code', warehouseCode).maybeSingle();
    warehouseId = wh?.id ?? null;
  }
  if (!warehouseId) {
    await addProjectTag(project.id, 'bodega no identificada');
    return null;
  }

  // Verificar stock efectivo (in_stock − reservado en líneas activas de otras reservas)
  const shortages: Array<{ family: string; needed: number; available: number }> = [];
  for (const req of requirements) {
    const { count: stockCount } = await supabaseAdmin
      .from('inventory_items')
      .select('id', { count: 'exact', head: true })
      .eq('category_id', req.categoryId!)
      .eq('status', 'in_stock')
      .eq('warehouse_id', warehouseId);
    // Sum qty pendiente (reserved − delivered) en reservas activas para
    // esa (categoría × bodega)
    const { data: activeLines } = await supabaseAdmin
      .from('inventory_reservation_lines')
      .select('qty_reserved, qty_delivered, inventory_reservations!inner(status)')
      .eq('category_id', req.categoryId!)
      .eq('warehouse_id', warehouseId);
    type ActiveLine = { qty_reserved: number; qty_delivered: number; inventory_reservations: { status: string } | { status: string }[] | null };
    const pending = ((activeLines ?? []) as unknown as ActiveLine[]).reduce((acc, l) => {
      const resv = Array.isArray(l.inventory_reservations) ? l.inventory_reservations[0] : l.inventory_reservations;
      if (!resv) return acc;
      if (resv.status === 'confirmed' || resv.status === 'draft') {
        return acc + Math.max(0, Number(l.qty_reserved) - Number(l.qty_delivered));
      }
      return acc;
    }, 0);
    const available = Math.max(0, (stockCount ?? 0) - pending);
    if (available < req.qty) {
      shortages.push({ family: req.family, needed: req.qty, available });
    }
  }

  if (shortages.length > 0) {
    return { reservation_id: '', reserved: [], shortages };
  }

  // Crear la reserva confirmada
  const { data: resv, error: resvErr } = await supabaseAdmin
    .from('inventory_reservations')
    .insert({
      title: `${project.code ?? 'PROY'} · ${project.title}`.slice(0, 200),
      status: 'confirmed',
      requested_by: actorEmail,
      confirmed_at: new Date().toISOString(),
      notes: 'Auto-reserva por cantidades (Alistamiento) — seriales se aportan en el acta',
    })
    .select('id')
    .single();
  if (resvErr || !resv) return null;

  // Insertar líneas por categoría
  const linesToInsert = requirements.map((req) => ({
    reservation_id: resv.id,
    category_id: req.categoryId!,
    warehouse_id: warehouseId!,
    qty_reserved: req.qty,
    qty_delivered: 0,
  }));
  const { error: linesErr } = await supabaseAdmin
    .from('inventory_reservation_lines')
    .insert(linesToInsert);
  if (linesErr) {
    // Rollback: borrar la reserva recién creada
    await supabaseAdmin.from('inventory_reservations').delete().eq('id', resv.id);
    return null;
  }

  // Vincular al proyecto
  await supabaseAdmin
    .from('crm_projects')
    .update({ reservation_id: resv.id })
    .eq('id', project.id);

  return {
    reservation_id: resv.id,
    reserved: requirements.map((req) => ({ family: req.family, qty: req.qty, category_id: req.categoryId! })),
    shortages: [],
  };
}


/**
 * Auto-crea una tarea en planner_tasks para una instalación.
 * start_date = installation_date, due_date = installation_date + 2 días
 * (ventana típica de obra: instalación + configuración + puesta en marcha).
 * Idempotente: si ya existe una task del proyecto con tag 'instalacion-auto', no duplica.
 */
type CrmProjectFull = {
  id: string; code: string | null; title: string; casa_numero: string | null;
  conjunto: string | null; client_name: string | null;
  contractor_name: string | null; contractor_email: string | null;
  installation_date: string | null;
};
async function createPlannerTaskInstalacion(project: CrmProjectFull, actorEmail: string | null): Promise<null | { id: string; title: string }> {
  if (!project.installation_date) return null;

  // Idempotente: no duplicar
  const { data: existing } = await supabaseAdmin
    .from('planner_tasks')
    .select('id')
    .eq('project_id', project.id)
    .contains('tags', ['instalacion-auto'])
    .maybeSingle();
  if (existing) return null;

  const dueDate = new Date(project.installation_date);
  dueDate.setDate(dueDate.getDate() + 2);
  const dueDateStr = dueDate.toISOString().slice(0, 10);

  const casaLabel = project.conjunto && project.casa_numero
    ? `${project.conjunto} · Casa ${project.casa_numero}`
    : (project.casa_numero ? `Casa ${project.casa_numero}` : (project.client_name ?? project.title));

  const { data: task, error } = await supabaseAdmin
    .from('planner_tasks')
    .insert({
      title: `Instalación: ${casaLabel}`,
      description: `Instalación física del sistema solar. Proyecto ${project.code ?? project.title}.\nContratista: ${project.contractor_name ?? '—'}.`,
      assigned_to: project.contractor_email ?? project.contractor_name ?? actorEmail,
      urgency: 'medium',
      status: 'todo',
      start_date: project.installation_date,
      due_date: dueDateStr,
      tags: ['instalacion-auto', 'construccion'],
      team: 'Construcción',
      project_id: project.id,
      created_by: actorEmail,
    })
    .select('id, title')
    .single();
  if (error) return null;
  return task;
}

/**
 * Auto-crea una tarea para un ticket de logística inversa (garantía / cambio).
 * Sin start/due — el usuario las ajusta después.
 */
async function createPlannerTaskTicket(project: CrmProjectFull, actorEmail: string | null, motivo: string | undefined): Promise<null | { id: string; title: string }> {
  const casaLabel = project.conjunto && project.casa_numero
    ? `${project.conjunto} · Casa ${project.casa_numero}`
    : (project.client_name ?? project.title);
  const { data: task, error } = await supabaseAdmin
    .from('planner_tasks')
    .insert({
      title: `Ticket garantía / cambio: ${casaLabel}`,
      description: motivo ?? `Ticket abierto en proyecto ${project.code ?? project.title}.`,
      assigned_to: actorEmail,
      urgency: 'high',
      status: 'todo',
      tags: ['logistica-inversa-auto', 'garantia'],
      team: 'Operaciones',
      project_id: project.id,
      created_by: actorEmail,
    })
    .select('id, title')
    .single();
  if (error) return null;
  return task;
}

/**
 * Preflight Alistamiento → Instalación: validar que contractor_name y
 * installation_date estén presentes (o se estén capturando en esta transición).
 * Devuelve lista de bloqueadores (vacío si todo OK).
 */
async function checkReadyForInstalacion(projectId: string, incomingFields: Record<string, unknown>): Promise<string[]> {
  const { data: p } = await supabaseAdmin
    .from('crm_projects')
    .select('contractor_name, installation_date, reservation_id')
    .eq('id', projectId)
    .single();
  if (!p) return ['proyecto no encontrado'];
  const blockers: string[] = [];
  const contractor = (incomingFields.contractor_name as string | undefined) ?? p.contractor_name;
  const date = (incomingFields.installation_date as string | undefined) ?? p.installation_date;
  if (!contractor || !String(contractor).trim()) blockers.push('contratista');
  if (!date) blockers.push('fecha de instalación');
  if (!p.reservation_id) blockers.push('reserva de inventario (regresa a alistamiento)');
  return blockers;
}

/**
 * Preflight Operativo → Cerrado: validar que el proyecto está limpio para cerrar.
 * Bloqueadores: no hay equipos installed en la casa o queda algo en reserved.
 */
async function checkReadyForClose(projectId: string): Promise<string[]> {
  const { data: p } = await supabaseAdmin
    .from('crm_projects')
    .select('house_id, reservation_id')
    .eq('id', projectId)
    .single();
  if (!p?.house_id) return ['casa no asignada — no se puede verificar el estado de los equipos'];

  const blockers: string[] = [];
  // ¿Hay items en la reserva que NO estén installed?
  if (p.reservation_id) {
    const { data: lines } = await supabaseAdmin
      .from('inventory_reservation_items')
      .select('inventory_items(serial_number, status)')
      .eq('reservation_id', p.reservation_id);
    type LI = { serial_number: string | null; status: string | null };
    const pending: string[] = [];
    for (const l of (lines ?? []) as Array<{ inventory_items: LI | LI[] | null }>) {
      const it = Array.isArray(l.inventory_items) ? l.inventory_items[0] : l.inventory_items;
      if (!it) continue;
      if (it.status !== 'installed') pending.push(`${it.serial_number ?? '?'} (${it.status ?? 'unknown'})`);
    }
    if (pending.length > 0) {
      blockers.push(`${pending.length} equipo(s) sin instalar: ${pending.slice(0, 5).join(', ')}${pending.length > 5 ? '…' : ''}`);
    }
  }
  return blockers;
}

/**
 * Al pasar a Operativo: tomar la reserva confirmada del proyecto y
 * materializar los items como 'installed' en la casa del proyecto.
 *
 * Idempotente: items ya en 'installed' con la casa correcta se skipean.
 * Items que cambiaron a otro estado (in_repair, decommissioned) se reportan
 * pero no se tocan.
 *
 * Resultado: items: reserved → installed, current_house_id = project.house_id,
 * movimientos type='install', reserva → fulfilled.
 */
async function fulfillReservationOnOperativo(
  project: ProjRow,
  actorEmail: string | null,
  serialsByCategory: Record<string, string[]> | null = null,
): Promise<null | { installed: string[]; already_installed: string[]; skipped: string[]; reservation_fulfilled: boolean }> {
  if (!project.reservation_id) {
    return { installed: [], already_installed: [], skipped: ['Proyecto sin reservation_id — nada que instalar'], reservation_fulfilled: false };
  }
  if (!project.house_id) {
    return { installed: [], already_installed: [], skipped: ['Proyecto sin house_id — asigna la casa antes de marcar Operativo'], reservation_fulfilled: false };
  }

  // 1. Cargar la reserva base
  const { data: resv } = await supabaseAdmin
    .from('inventory_reservations')
    .select('id, title, status')
    .eq('id', project.reservation_id)
    .maybeSingle();
  if (!resv) {
    return { installed: [], already_installed: [], skipped: ['Reserva del proyecto no existe'], reservation_fulfilled: false };
  }
  if (resv.status === 'cancelled') {
    return { installed: [], already_installed: [], skipped: ['Reserva está cancelada'], reservation_fulfilled: false };
  }

  // 2. Detectar modelo de reserva (líneas por qty o items específicos)
  const { data: newLines } = await supabaseAdmin
    .from('inventory_reservation_lines')
    .select('id, category_id, warehouse_id, qty_reserved, qty_delivered')
    .eq('reservation_id', resv.id);
  const hasNewModel = (newLines ?? []).length > 0;

  if (hasNewModel) {
    return fulfillByQuantityModel(project, resv, newLines ?? [], serialsByCategory, actorEmail);
  }
  return fulfillByLegacyItemsModel(project, resv, actorEmail);
}

/**
 * Modelo NUEVO (mig 44): la reserva tiene líneas por qty. El técnico aportó
 * los seriales reales en el acta de instalación. Verificamos que:
 *   - Por cada categoría, se enviaron exactamente `qty_reserved` seriales
 *   - Cada serial existe en inventory_items con status='in_stock' + bodega correcta
 *   - Ningún serial duplicado
 * Si todo OK: marcamos esos items como installed y qty_delivered = qty_reserved.
 */
async function fulfillByQuantityModel(
  project: ProjRow,
  resv: { id: string; title: string; status: string },
  lines: Array<{ id: string; category_id: string; warehouse_id: string; qty_reserved: number; qty_delivered: number }>,
  serialsByCategory: Record<string, string[]> | null,
  actorEmail: string | null,
): Promise<{ installed: string[]; already_installed: string[]; skipped: string[]; reservation_fulfilled: boolean }> {
  const installed: string[] = [];
  const skipped: string[] = [];

  if (!serialsByCategory) {
    return {
      installed: [], already_installed: [],
      skipped: ['El acta de instalación no aportó seriales. Completa el acta con los seriales escaneados por el técnico antes de marcar Operativo.'],
      reservation_fulfilled: false,
    };
  }

  // Validar por línea
  for (const line of lines) {
    if (line.qty_delivered >= line.qty_reserved) continue; // ya cumplida
    const serials = (serialsByCategory[line.category_id] ?? []).map((s) => s.trim()).filter(Boolean);
    const need = line.qty_reserved - line.qty_delivered;
    if (serials.length !== need) {
      skipped.push(`Categoría ${line.category_id}: se esperan ${need} seriales, se recibieron ${serials.length}. Solicita al equipo CRM ajustar la qty del diseño si no coincide.`);
      continue;
    }

    // Verificar que TODOS los seriales existan in_stock en la bodega correcta
    const { data: items } = await supabaseAdmin
      .from('inventory_items')
      .select('id, serial_number, status, warehouse_id')
      .in('serial_number', serials);
    const foundBySerial = new Map((items ?? []).map((it) => [it.serial_number, it] as const));
    const errors: string[] = [];
    for (const s of serials) {
      const it = foundBySerial.get(s);
      if (!it) errors.push(`serial "${s}" no existe en inventario`);
      else if (it.status !== 'in_stock') errors.push(`serial "${s}" no está in_stock (status: ${it.status})`);
      else if (it.warehouse_id !== line.warehouse_id) errors.push(`serial "${s}" está en otra bodega`);
    }
    if (errors.length > 0) {
      skipped.push(`Categoría ${line.category_id}: ${errors.join(' · ')}`);
      continue;
    }

    // Marcar como installed
    const ids = serials.map((s) => foundBySerial.get(s)!.id);
    const { data: updated } = await supabaseAdmin
      .from('inventory_items')
      .update({
        status: 'installed',
        current_location: 'house',
        current_house_id: project.house_id,
      })
      .in('id', ids)
      .eq('status', 'in_stock')
      .select('id, serial_number');
    for (const u of updated ?? []) installed.push(u.serial_number);

    // Registrar movimientos
    if ((updated ?? []).length > 0) {
      await supabaseAdmin.from('inventory_movements').insert(
        (updated ?? []).map((u) => ({
          item_id: u.id, type: 'install',
          from_status: 'in_stock', to_status: 'installed',
          to_location: 'house', to_house_id: project.house_id,
          responsible_email: actorEmail,
          notes: `Instalado al marcar Operativo (reserva ${resv.title}) — serial aportado por acta`,
        })),
      );
    }

    // Actualizar qty_delivered en la línea
    await supabaseAdmin
      .from('inventory_reservation_lines')
      .update({ qty_delivered: line.qty_delivered + (updated?.length ?? 0) })
      .eq('id', line.id);
  }

  // Si todas las líneas están cumplidas, marcar reserva como fulfilled
  const { data: lineCheck } = await supabaseAdmin
    .from('inventory_reservation_lines')
    .select('qty_reserved, qty_delivered')
    .eq('reservation_id', resv.id);
  const allFulfilled = (lineCheck ?? []).every((l) => Number(l.qty_delivered) >= Number(l.qty_reserved));
  let fulfilled = false;
  if (allFulfilled && installed.length > 0 && resv.status === 'confirmed') {
    await supabaseAdmin
      .from('inventory_reservations')
      .update({ status: 'fulfilled', fulfilled_at: new Date().toISOString() })
      .eq('id', resv.id);
    fulfilled = true;
  }

  return { installed, already_installed: [], skipped, reservation_fulfilled: fulfilled };
}

/**
 * Modelo VIEJO (pre-mig 44): la reserva tiene items específicos apartados
 * (status='reserved'). El endpoint simplemente los transiciona a installed.
 * Se mantiene para compatibilidad con reservas existentes.
 */
async function fulfillByLegacyItemsModel(
  project: ProjRow,
  resv: { id: string; title: string; status: string },
  actorEmail: string | null,
): Promise<{ installed: string[]; already_installed: string[]; skipped: string[]; reservation_fulfilled: boolean }> {
  type LineItem = { id?: string; serial_number?: string | null; status?: string | null; current_house_id?: string | null };
  type Line = { item_id: string; inventory_items?: LineItem | LineItem[] | null };
  const { data: full } = await supabaseAdmin
    .from('inventory_reservations')
    .select('inventory_reservation_items(item_id, inventory_items(id, serial_number, status, current_house_id))')
    .eq('id', resv.id)
    .maybeSingle();
  const lines = ((full as unknown as { inventory_reservation_items?: Line[] } | null)?.inventory_reservation_items) ?? [];

  const installed: string[] = [];
  const already: string[] = [];
  const skipped: string[] = [];
  const toInstall: Array<{ id: string; serial: string }> = [];

  for (const l of lines) {
    const itRaw = l.inventory_items;
    const it = Array.isArray(itRaw) ? itRaw[0] : itRaw;
    if (!it || !it.id) continue;
    const serial = it.serial_number ?? '';
    if (it.status === 'installed' && it.current_house_id === project.house_id) {
      already.push(serial);
      continue;
    }
    if (it.status === 'reserved') {
      toInstall.push({ id: it.id, serial });
      continue;
    }
    skipped.push(`${serial} (estado: ${it.status ?? 'unknown'})`);
  }

  if (toInstall.length > 0) {
    const { data: updated } = await supabaseAdmin
      .from('inventory_items')
      .update({ status: 'installed', current_location: 'house', current_house_id: project.house_id })
      .in('id', toInstall.map((it) => it.id))
      .eq('status', 'reserved')
      .select('id, serial_number');
    const updatedIds = new Set((updated ?? []).map((u) => u.id));
    if (updatedIds.size > 0) {
      await supabaseAdmin.from('inventory_movements').insert(
        toInstall.filter((it) => updatedIds.has(it.id)).map((it) => ({
          item_id: it.id, type: 'install',
          from_status: 'reserved', to_status: 'installed',
          to_location: 'house', to_house_id: project.house_id,
          responsible_email: actorEmail,
          notes: `Instalado al marcar Operativo (reserva ${resv.title}) — modelo legacy`,
        })),
      );
    }
    for (const it of toInstall) {
      if (updatedIds.has(it.id)) installed.push(it.serial);
      else skipped.push(`${it.serial} (cambió de estado mientras se procesaba)`);
    }
  }

  let fulfilled = false;
  if (installed.length > 0 && resv.status === 'confirmed') {
    await supabaseAdmin
      .from('inventory_reservations')
      .update({ status: 'fulfilled', fulfilled_at: new Date().toISOString() })
      .eq('id', resv.id);
    fulfilled = true;
  }
  return { installed, already_installed: already, skipped, reservation_fulfilled: fulfilled };
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

/**
 * Lee los seriales del acta de instalación vinculada al proyecto (si existe).
 * Extrae inv_serials, panel_serials, batt_serials del form_data y los mapea
 * a los category_id del diseño del proyecto.
 *
 * Fuentes del vínculo con el acta (en orden):
 *   1. crm_projects.visita_instalacion_id (FK directo)
 *   2. field_visits filtradas por house_id + type='instalacion' (más reciente)
 *   3. field_visits filtradas por casa (string) + type='instalacion' (más reciente)
 *
 * Retorna null si no se encuentra ningún acta o si no hay seriales cargados.
 * Retorna { [category_id]: string[] } listo para fulfillReservationOnOperativo.
 */
async function readSerialsFromActa(project: ProjRow): Promise<Record<string, string[]> | null> {
  // Cargar el proyecto completo para saber los category_id del diseño +
  // el FK al acta.
  const { data: p } = await supabaseAdmin
    .from('crm_projects')
    .select('visita_instalacion_id, house_id, casa_numero, conjunto, diseno_inversor_categoria_id, diseno_bateria_categoria_id, diseno_panel_categoria_id')
    .eq('id', project.id)
    .maybeSingle();
  if (!p) return null;

  // 1. Intento con FK directo
  let visit: { form_data: Record<string, unknown> } | null = null;
  if (p.visita_instalacion_id) {
    const { data } = await supabaseAdmin
      .from('field_visits')
      .select('form_data')
      .eq('id', p.visita_instalacion_id)
      .maybeSingle();
    if (data) visit = data as { form_data: Record<string, unknown> };
  }
  // 2. Fallback: buscar por house_id + tipo instalación
  if (!visit && p.house_id) {
    const { data } = await supabaseAdmin
      .from('field_visits')
      .select('form_data')
      .eq('house_id', p.house_id)
      .eq('visit_type', 'instalacion')
      .order('visit_date', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) visit = data as { form_data: Record<string, unknown> };
  }
  // 3. Último recurso: buscar por casa string
  if (!visit && p.casa_numero) {
    const casaLabel = `Casa ${p.casa_numero}`;
    const { data } = await supabaseAdmin
      .from('field_visits')
      .select('form_data')
      .ilike('casa', `%${casaLabel}%`)
      .eq('visit_type', 'instalacion')
      .order('visit_date', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) visit = data as { form_data: Record<string, unknown> };
  }
  if (!visit) return null;

  const fd = visit.form_data ?? {};
  const invSerials = Array.isArray(fd.inv_serials) ? (fd.inv_serials as unknown[]).map(String).filter((s) => s.trim()) : [];
  const panelSerials = Array.isArray(fd.panel_serials) ? (fd.panel_serials as unknown[]).map(String).filter((s) => s.trim()) : [];
  const battSerials = Array.isArray(fd.batt_serials) ? (fd.batt_serials as unknown[]).map(String).filter((s) => s.trim()) : [];

  // Si no hay nada, devolver null para que el endpoint falle con "acta sin seriales"
  if (invSerials.length === 0 && panelSerials.length === 0 && battSerials.length === 0) return null;

  const map: Record<string, string[]> = {};
  if (p.diseno_inversor_categoria_id && invSerials.length > 0) map[p.diseno_inversor_categoria_id] = invSerials;
  if (p.diseno_panel_categoria_id && panelSerials.length > 0) map[p.diseno_panel_categoria_id] = panelSerials;
  if (p.diseno_bateria_categoria_id && battSerials.length > 0) map[p.diseno_bateria_categoria_id] = battSerials;
  return Object.keys(map).length > 0 ? map : null;
}
