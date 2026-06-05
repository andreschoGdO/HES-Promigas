import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

/**
 * POST /api/facturacion/import
 * Body: { rows: ImportRow[], actor_email?, periodo?, freeze_after? }
 *
 * Recibe filas crudas del CSV. Cada fila debe traer al menos:
 *   - ciudad, conjunto, casa  (claves para match con crm_projects)
 *   ...y cualquier subset de los campos editables (costos, solucion, plan, OR, notes)
 *
 * Estrategia de match:
 *   - composite (lower(ciudad), lower(conjunto), trim(casa))
 *   - si match único → upsert
 *   - si 0 matches → registrar en `notFound`
 *   - si ≥2 matches → registrar en `ambiguous`
 *
 * Si freeze_after=true, congela cada proyecto actualizado al periodo provisto
 * (o al mes actual). Cada cambio queda registrado en facturacion_events.
 */

type ImportRow = Record<string, string | number | null | undefined>;
type Result = {
  total: number;
  updated: string[];          // titles de proyectos actualizados
  notFound: string[];         // claves que no matchearon
  ambiguous: string[];        // claves con ≥2 matches
  frozen?: string[];
  errors: string[];
};

const EDITABLE_NUM = [
  'costo_inversor', 'costo_bateria', 'costo_control_box', 'costo_top_cover',
  'costo_panel_solar', 'costo_medidor_solar', 'costo_medidor_generacion', 'costo_modem',
  'mano_de_obra', 'desmantelamiento_mo', 'capex',
] as const;
const EDITABLE_STR = ['solucion', 'plan', 'operador_red', 'notes'] as const;

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const cleaned = String(v).replace(/[^\d.-]/g, '');
  if (cleaned === '') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
};
const str = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
};
const lc = (v: unknown): string => String(v ?? '').trim().toLowerCase();

const isValidPeriodo = (s: string): boolean => /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
const currentPeriodo = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const rows: ImportRow[] = Array.isArray(body.rows) ? body.rows : [];
    if (rows.length === 0) return NextResponse.json({ error: 'rows vacío' }, { status: 400 });
    if (rows.length > 1000) return NextResponse.json({ error: 'máximo 1000 filas por import' }, { status: 400 });

    const actor: string | null = typeof body.actor_email === 'string' ? body.actor_email : null;
    const freezeAfter = body.freeze_after === true;
    const periodoRaw = typeof body.periodo === 'string' ? body.periodo.trim() : '';
    const periodo = periodoRaw && isValidPeriodo(periodoRaw) ? periodoRaw : currentPeriodo();
    if (periodoRaw && !isValidPeriodo(periodoRaw)) {
      return NextResponse.json({ error: 'periodo inválido (esperado YYYY-MM)' }, { status: 400 });
    }

    // Pre-cargar TODOS los proyectos para hacer matching en memoria
    const { data: projects } = await supabaseAdmin
      .from('crm_projects')
      .select('id, title, client_city, conjunto, casa_numero');
    type Proj = { id: string; title: string; client_city: string | null; conjunto: string | null; casa_numero: string | null };
    const projList = (projects ?? []) as Proj[];

    const result: Result = {
      total: rows.length,
      updated: [],
      notFound: [],
      ambiguous: [],
      frozen: freezeAfter ? [] : undefined,
      errors: [],
    };

    for (const raw of rows) {
      const ciudad = lc(raw.ciudad ?? raw.CIUDAD);
      const conjunto = lc(raw.conjunto ?? raw['CONJUNTO RESIDENCIAL'] ?? raw.conjunto_residencial);
      const casa = lc(raw.casa ?? raw.CASA);
      const key = `${ciudad}|${conjunto}|${casa}`;
      if (!ciudad || !conjunto || !casa) {
        result.errors.push(`Fila sin claves (ciudad/conjunto/casa): ${JSON.stringify(raw).slice(0, 100)}`);
        continue;
      }

      const matches = projList.filter((p) =>
        lc(p.client_city) === ciudad &&
        lc(p.conjunto) === conjunto &&
        lc(p.casa_numero) === casa,
      );
      if (matches.length === 0) {
        result.notFound.push(key);
        continue;
      }
      if (matches.length > 1) {
        result.ambiguous.push(`${key} (${matches.length} matches)`);
        continue;
      }

      const project = matches[0];
      const updates: Record<string, unknown> = {};
      for (const k of EDITABLE_NUM) {
        // Aceptar tanto el campo snake_case como los labels del CSV exportado
        const aliases: Record<string, string[]> = {
          costo_inversor:           ['Costo Inversor'],
          costo_bateria:            ['Costo Bateria', 'Costo Batería'],
          costo_control_box:        ['Costo Control Box (BMS)', 'Costo Control Box'],
          costo_top_cover:          ['Costo Top Cover'],
          costo_panel_solar:        ['Panel Solar', 'Costo Panel Solar'],
          costo_medidor_solar:      ['Medidor Solar', 'Costo Medidor Solar'],
          costo_medidor_generacion: ['Medidor Generacion', 'Medidor Generación'],
          costo_modem:              ['Modem', 'Modem (costo)'],
          mano_de_obra:             ['Mano de Obra'],
          desmantelamiento_mo:      ['Desmantelamiento x MO', 'Desmantelamiento'],
          capex:                    ['Capex'],
        };
        const candidates = [k, ...(aliases[k] ?? [])];
        for (const c of candidates) {
          if (c in raw) { const v = num(raw[c]); if (v != null) updates[k] = v; break; }
        }
      }
      for (const k of EDITABLE_STR) {
        const aliases: Record<string, string[]> = {
          solucion:     ['SOLUCIÓN', 'SOLUCION', 'Solución'],
          plan:         ['PLAN', 'Plan'],
          operador_red: ['OR', 'Operador de Red'],
          notes:        ['Notas', 'NOTES'],
        };
        const candidates = [k, ...(aliases[k] ?? [])];
        for (const c of candidates) {
          if (c in raw) { const v = str(raw[c]); if (v != null) updates[k] = v; break; }
        }
      }
      if (Object.keys(updates).length === 0) continue;

      // Verificar frozen — no permitir cambios sobre proyecto congelado vía import
      const { data: existing } = await supabaseAdmin
        .from('facturacion_records')
        .select('*')
        .eq('project_id', project.id)
        .maybeSingle();
      if (existing?.frozen_at && !freezeAfter) {
        result.errors.push(`${project.title}: congelado, no se actualizó`);
        continue;
      }

      // Audit log de cambios
      const events = Object.entries(updates)
        .filter(([k, v]) => {
          const prev = existing ? (existing as Record<string, unknown>)[k] : null;
          return String(prev ?? '') !== String(v ?? '');
        })
        .map(([k, v]) => ({
          project_id: project.id,
          event_type: EDITABLE_NUM.includes(k as typeof EDITABLE_NUM[number]) ? 'cost_change' : 'text_change',
          field: k,
          old_value: existing ? ((existing as Record<string, unknown>)[k] == null ? null : String((existing as Record<string, unknown>)[k])) : null,
          new_value: v == null ? null : String(v),
          source: 'csv_import',
          actor_email: actor,
        }));

      if (existing) {
        const { error } = await supabaseAdmin
          .from('facturacion_records')
          .update({ ...updates, updated_by: actor })
          .eq('project_id', project.id);
        if (error) { result.errors.push(`${project.title}: ${error.message}`); continue; }
      } else {
        const { error } = await supabaseAdmin
          .from('facturacion_records')
          .insert({ project_id: project.id, ...updates, created_by: actor, updated_by: actor });
        if (error) { result.errors.push(`${project.title}: ${error.message}`); continue; }
      }
      if (events.length > 0) await supabaseAdmin.from('facturacion_events').insert(events);
      result.updated.push(project.title);

      if (freezeAfter) {
        // Llamar al endpoint de freeze internamente sería overkill — inline.
        const frozenAt = new Date().toISOString();
        await supabaseAdmin
          .from('facturacion_records')
          .update({ frozen_at: frozenAt, frozen_by: actor, periodo })
          .eq('project_id', project.id);
        await supabaseAdmin.from('facturacion_events').insert({
          project_id: project.id,
          event_type: 'freeze',
          source: 'csv_import',
          actor_email: actor,
          notes: `Congelado al importar (periodo ${periodo})`,
          data: { periodo },
        });
        result.frozen?.push(project.title);
      }
    }

    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}
