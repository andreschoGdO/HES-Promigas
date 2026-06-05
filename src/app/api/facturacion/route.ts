import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

/**
 * GET /api/facturacion
 *
 * Devuelve una fila por proyecto CRM con TODAS las columnas que pide el
 * negocio. Mezcla:
 *   - datos derivados de crm_projects (ciudad, conjunto, casa, paneles, kwp,
 *     baterías, kwh, contractor)
 *   - marcas derivadas de inventory_items + inventory_categories filtradas
 *     por house_id (equipos instalados en la casa del proyecto)
 *   - costos y campos comerciales libres de facturacion_records
 *
 * Una sola request al frontend → la tabla se renderiza directo sin más joins.
 */
type ProjectRow = {
  id: string;
  code: string | null;
  title: string;
  client_city: string | null;
  conjunto: string | null;
  casa_numero: string | null;
  propuesta_kwp: number | null;
  diseno_kwp: number | null;
  propuesta_valor_cop: number | null;
  diseno_paneles: number | null;
  diseno_baterias_cantidad: number | null;
  diseno_inversor_categoria_id: string | null;
  diseno_panel_categoria_id: string | null;
  diseno_bateria_categoria_id: string | null;
  contractor_name: string | null;
  house_id: string | null;
  updated_at: string;
};

export async function GET() {
  // 1. Todos los proyectos CRM (cualquier módulo/etapa — la facturación se
  // arma sobre el universo completo de proyectos, no solo los cerrados).
  const { data: projects, error: projErr } = await supabaseAdmin
    .from('crm_projects')
    .select(
      'id, code, title, client_city, conjunto, casa_numero, ' +
      'propuesta_kwp, diseno_kwp, propuesta_valor_cop, ' +
      'diseno_paneles, diseno_baterias_cantidad, ' +
      'diseno_inversor_categoria_id, diseno_panel_categoria_id, diseno_bateria_categoria_id, ' +
      'contractor_name, house_id, updated_at',
    )
    .order('updated_at', { ascending: false })
    .limit(1000);

  if (projErr) return NextResponse.json({ error: projErr.message }, { status: 500 });
  const projectList = (projects ?? []) as unknown as ProjectRow[];

  // 2. Catálogo de categorías para resolver marcas desde diseno_*_categoria_id
  const { data: cats } = await supabaseAdmin
    .from('inventory_categories')
    .select('id, family, default_brand, default_model, default_capacity_value, default_capacity_unit');
  const catById = new Map<string, { family: string; brand: string | null; model: string | null; cap: number | null; unit: string | null }>();
  for (const c of cats ?? []) {
    catById.set(c.id, {
      family: c.family,
      brand: c.default_brand ?? null,
      model: c.default_model ?? null,
      cap: c.default_capacity_value ?? null,
      unit: c.default_capacity_unit ?? null,
    });
  }

  // 3. Equipos instalados en las casas de los proyectos (para marcas reales,
  // no las teóricas del diseño). Cuando hay equipo instalado, prevalece.
  const houseIds = projectList.map((p) => p.house_id).filter((x): x is string => Boolean(x));
  type InstalledRow = { current_house_id: string; brand: string | null; model: string | null; capacity_value: number | null; capacity_unit: string | null; category_id: string | null };
  let installedRows: InstalledRow[] = [];
  if (houseIds.length > 0) {
    const { data } = await supabaseAdmin
      .from('inventory_items')
      .select('current_house_id, brand, model, capacity_value, capacity_unit, category_id')
      .in('current_house_id', houseIds)
      .eq('status', 'installed');
    installedRows = (data ?? []) as InstalledRow[];
  }
  // Indexar por house_id + family
  const installedByHouse = new Map<string, Map<string, { brand: string | null; model: string | null; cap: number | null; unit: string | null }>>();
  for (const it of installedRows) {
    if (!it.current_house_id || !it.category_id) continue;
    const fam = catById.get(it.category_id)?.family;
    if (!fam) continue;
    const houseMap = installedByHouse.get(it.current_house_id) ?? new Map();
    if (!houseMap.has(fam)) {
      houseMap.set(fam, {
        brand: it.brand ?? catById.get(it.category_id)?.brand ?? null,
        model: it.model ?? catById.get(it.category_id)?.model ?? null,
        cap: it.capacity_value ?? catById.get(it.category_id)?.cap ?? null,
        unit: it.capacity_unit ?? catById.get(it.category_id)?.unit ?? null,
      });
    }
    installedByHouse.set(it.current_house_id, houseMap);
  }

  // 4. Registros de facturación existentes
  const { data: facts } = await supabaseAdmin
    .from('facturacion_records')
    .select('*');
  const factByProject = new Map<string, Record<string, unknown>>();
  for (const f of facts ?? []) factByProject.set(f.project_id, f);

  // 5. Componer filas
  const resolveBrand = (p: ProjectRow, family: string, designCategoryId: string | null): string | null => {
    const installed = p.house_id ? installedByHouse.get(p.house_id)?.get(family) : null;
    if (installed?.brand) return installed.model ? `${installed.brand} ${installed.model}` : installed.brand;
    const designed = designCategoryId ? catById.get(designCategoryId) : null;
    if (designed?.brand) return designed.model ? `${designed.brand} ${designed.model}` : designed.brand;
    return null;
  };

  const resolveBatteryKwh = (p: ProjectRow): number | null => {
    const installed = p.house_id ? installedByHouse.get(p.house_id)?.get('battery') : null;
    if (installed?.cap && installed.unit === 'kWh') {
      // múltiples baterías → sumar capacidades
      const all = installedRows.filter((r) => r.current_house_id === p.house_id && r.category_id && catById.get(r.category_id)?.family === 'battery');
      const total = all.reduce((acc, r) => acc + Number(r.capacity_value ?? 0), 0);
      return total > 0 ? total : Number(installed.cap);
    }
    const designed = p.diseno_bateria_categoria_id ? catById.get(p.diseno_bateria_categoria_id) : null;
    if (designed?.cap && designed.unit === 'kWh' && p.diseno_baterias_cantidad) {
      return Number(designed.cap) * Number(p.diseno_baterias_cantidad);
    }
    return null;
  };

  const rows = projectList.map((p) => {
    const fact = factByProject.get(p.id) ?? {};
    return {
      project_id: p.id,
      project_code: p.code,
      project_title: p.title,
      ciudad: p.client_city ?? null,
      conjunto: p.conjunto ?? null,
      casa: p.casa_numero ?? null,
      solucion: (fact.solucion as string | null) ?? null,
      plan: (fact.plan as string | null) ?? null,
      paneles: p.diseno_paneles ?? null,
      kwp: p.diseno_kwp ?? p.propuesta_kwp ?? null,
      bateria: p.diseno_baterias_cantidad ?? null,
      kwh: resolveBatteryKwh(p),
      constructor: p.contractor_name ?? null,
      marca_bateria: resolveBrand(p, 'battery', p.diseno_bateria_categoria_id),
      marca_inversor: resolveBrand(p, 'inverter', p.diseno_inversor_categoria_id),
      marca_panel: resolveBrand(p, 'panel', p.diseno_panel_categoria_id),
      costo_inversor: (fact.costo_inversor as number | null) ?? null,
      costo_bateria: (fact.costo_bateria as number | null) ?? null,
      costo_control_box: (fact.costo_control_box as number | null) ?? null,
      costo_top_cover: (fact.costo_top_cover as number | null) ?? null,
      costo_panel_solar: (fact.costo_panel_solar as number | null) ?? null,
      costo_medidor_solar: (fact.costo_medidor_solar as number | null) ?? null,
      costo_medidor_generacion: (fact.costo_medidor_generacion as number | null) ?? null,
      costo_modem: (fact.costo_modem as number | null) ?? null,
      mano_de_obra: (fact.mano_de_obra as number | null) ?? null,
      desmantelamiento_mo: (fact.desmantelamiento_mo as number | null) ?? null,
      capex: (fact.capex as number | null) ?? null,
      operador_red: (fact.operador_red as string | null) ?? null,
      has_record: factByProject.has(p.id),
    };
  });

  return NextResponse.json({ rows });
}

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

const EDITABLE_NUM = [
  'costo_inversor', 'costo_bateria', 'costo_control_box', 'costo_top_cover',
  'costo_panel_solar', 'costo_medidor_solar', 'costo_medidor_generacion', 'costo_modem',
  'mano_de_obra', 'desmantelamiento_mo', 'capex',
] as const;
const EDITABLE_STR = ['solucion', 'plan', 'operador_red', 'notes'] as const;

/**
 * PATCH /api/facturacion
 * Body: { project_id, ...campos editables, actor_email? }
 *
 * Upsert por project_id: si no existe registro, lo crea con los campos
 * provistos. Si existe, hace UPDATE solo de los campos del body.
 */
export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const projectId = str(body.project_id);
    if (!projectId) return NextResponse.json({ error: 'project_id requerido' }, { status: 400 });

    const updates: Record<string, unknown> = {};
    for (const k of EDITABLE_NUM) {
      if (k in body) updates[k] = num(body[k]);
    }
    for (const k of EDITABLE_STR) {
      if (k in body) updates[k] = str(body[k]);
    }
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'sin campos para actualizar' }, { status: 400 });
    }

    const actor = str(body.actor_email);

    // Upsert: intentar UPDATE; si afecta 0 filas, INSERT.
    const { data: existing } = await supabaseAdmin
      .from('facturacion_records')
      .select('id')
      .eq('project_id', projectId)
      .maybeSingle();

    if (existing) {
      const { data, error } = await supabaseAdmin
        .from('facturacion_records')
        .update({ ...updates, updated_by: actor })
        .eq('project_id', projectId)
        .select('*')
        .single();
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ record: data });
    } else {
      const { data, error } = await supabaseAdmin
        .from('facturacion_records')
        .insert({ project_id: projectId, ...updates, created_by: actor, updated_by: actor })
        .select('*')
        .single();
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ record: data });
    }
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}
