import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

/**
 * POST /api/facturacion/freeze
 * Body: { project_id, periodo?, actor_email? }
 *
 * Congela los costos de un proyecto:
 *   1. Lee el estado efectivo (user override O derivado de inventario) de cada
 *      costo y lo materializa en facturacion_records.
 *   2. Marca frozen_at = now(), frozen_by = actor, periodo = periodo provisto
 *      (o el mes actual si no se especifica).
 *   3. Registra un evento `freeze` con el snapshot completo.
 *
 * Después de congelar, los valores de inventario YA NO se aplican aunque
 * cambien los precios en órdenes de compra futuras.
 */

const FAMILY_TO_COST: Record<string, string> = {
  inverter: 'costo_inversor',
  battery:  'costo_bateria',
  panel:    'costo_panel_solar',
  gateway:  'costo_modem',
};
const ALL_COST_KEYS = [
  'costo_inversor', 'costo_bateria', 'costo_control_box', 'costo_top_cover',
  'costo_panel_solar', 'costo_medidor_solar', 'costo_medidor_generacion', 'costo_modem',
  'mano_de_obra', 'desmantelamiento_mo', 'capex',
] as const;

const currentPeriodo = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
const isValidPeriodo = (s: string): boolean => /^\d{4}-(0[1-9]|1[0-2])$/.test(s);

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const projectId: string | undefined = body.project_id;
    if (!projectId) return NextResponse.json({ error: 'project_id requerido' }, { status: 400 });

    const periodoRaw = typeof body.periodo === 'string' ? body.periodo.trim() : '';
    const periodo = periodoRaw && isValidPeriodo(periodoRaw) ? periodoRaw : currentPeriodo();
    if (periodoRaw && !isValidPeriodo(periodoRaw)) {
      return NextResponse.json({ error: 'periodo inválido (esperado YYYY-MM)' }, { status: 400 });
    }
    const actor = typeof body.actor_email === 'string' ? body.actor_email : null;

    // Cargar proyecto y registro actual
    const { data: project } = await supabaseAdmin
      .from('crm_projects')
      .select('id, house_id')
      .eq('id', projectId)
      .maybeSingle();
    if (!project) return NextResponse.json({ error: 'proyecto no encontrado' }, { status: 404 });

    const { data: existing } = await supabaseAdmin
      .from('facturacion_records')
      .select('*')
      .eq('project_id', projectId)
      .maybeSingle();

    if (existing?.frozen_at) {
      return NextResponse.json({
        error: 'El proyecto ya estaba congelado',
        frozen_at: existing.frozen_at,
        periodo: existing.periodo,
      }, { status: 409 });
    }

    // Calcular derivados desde inventario para esta casa
    const derived: Record<string, number> = {};
    if (project.house_id) {
      const { data: items } = await supabaseAdmin
        .from('inventory_items')
        .select('category_id, acquired_cost_cop, inventory_categories(family, default_cost_cop)')
        .eq('current_house_id', project.house_id)
        .eq('status', 'installed');
      type Item = { category_id: string | null; acquired_cost_cop: number | null; inventory_categories: { family: string; default_cost_cop: number | null } | { family: string; default_cost_cop: number | null }[] | null };
      for (const raw of (items ?? []) as Item[]) {
        const cat = Array.isArray(raw.inventory_categories) ? raw.inventory_categories[0] : raw.inventory_categories;
        if (!cat?.family) continue;
        const key = FAMILY_TO_COST[cat.family];
        if (!key) continue;
        const unitCost = raw.acquired_cost_cop != null ? Number(raw.acquired_cost_cop)
                       : cat.default_cost_cop != null ? Number(cat.default_cost_cop)
                       : null;
        if (unitCost == null) continue;
        derived[key] = (derived[key] ?? 0) + unitCost;
      }
    }

    // Construir snapshot: user override prevalece, derivado completa
    const snapshot: Record<string, number | null> = {};
    for (const key of ALL_COST_KEYS) {
      if (key === 'capex') continue;  // capex se calcula al final
      const userVal = existing ? (existing as Record<string, unknown>)[key] as number | null | undefined : null;
      if (userVal != null) snapshot[key] = Number(userVal);
      else if (derived[key] != null) snapshot[key] = derived[key];
      else snapshot[key] = null;
    }
    // Capex: user override o suma de los 10 costos resueltos
    const userCapex = existing ? (existing as Record<string, unknown>).capex as number | null | undefined : null;
    if (userCapex != null) {
      snapshot.capex = Number(userCapex);
    } else {
      const sum = Object.entries(snapshot).reduce((acc, [, v]) => acc + (v ?? 0), 0);
      snapshot.capex = sum > 0 ? sum : null;
    }

    const frozenAt = new Date().toISOString();
    const upsertPayload = {
      ...snapshot,
      frozen_at: frozenAt,
      frozen_by: actor,
      periodo,
      updated_by: actor,
    };

    let record;
    if (existing) {
      const { data, error } = await supabaseAdmin
        .from('facturacion_records')
        .update(upsertPayload)
        .eq('project_id', projectId)
        .select('*')
        .single();
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      record = data;
    } else {
      const { data, error } = await supabaseAdmin
        .from('facturacion_records')
        .insert({ project_id: projectId, ...upsertPayload, created_by: actor })
        .select('*')
        .single();
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      record = data;
    }

    // Audit: evento `freeze` con el snapshot completo en data
    await supabaseAdmin.from('facturacion_events').insert({
      project_id: projectId,
      event_type: 'freeze',
      source: 'freeze',
      actor_email: actor,
      notes: `Congelado para periodo ${periodo}`,
      data: { periodo, snapshot, derived_keys: Object.keys(derived) },
    });

    return NextResponse.json({ record });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}

/**
 * DELETE /api/facturacion/freeze?project_id=...&actor_email=...
 * Descongela (limpia frozen_at/by/periodo). NO toca los valores de costos
 * — quedan como estaban en el snapshot. El usuario puede editarlos después.
 */
export async function DELETE(request: Request) {
  const url = new URL(request.url);
  const projectId = url.searchParams.get('project_id');
  const actor = url.searchParams.get('actor_email');
  if (!projectId) return NextResponse.json({ error: 'project_id requerido' }, { status: 400 });

  const { data: existing } = await supabaseAdmin
    .from('facturacion_records')
    .select('frozen_at, periodo')
    .eq('project_id', projectId)
    .maybeSingle();
  if (!existing?.frozen_at) {
    return NextResponse.json({ error: 'el proyecto no está congelado' }, { status: 400 });
  }

  const prevPeriodo = existing.periodo;
  const { data, error } = await supabaseAdmin
    .from('facturacion_records')
    .update({ frozen_at: null, frozen_by: null, periodo: null, updated_by: actor })
    .eq('project_id', projectId)
    .select('*')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await supabaseAdmin.from('facturacion_events').insert({
    project_id: projectId,
    event_type: 'unfreeze',
    source: 'unfreeze',
    actor_email: actor,
    notes: `Descongelado (era periodo ${prevPeriodo})`,
    data: { previous_periodo: prevPeriodo },
  });

  return NextResponse.json({ record: data });
}
