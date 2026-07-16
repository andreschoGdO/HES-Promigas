import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

/**
 * GET /api/dash/gantt
 * Filas para el Gantt de obra del Dash de Construcción — ver
 * docs/superpowers/specs/2026-07-16-dash-gantt-scurve-design.md
 *
 * Trae todos los proyectos activos (no 'closed') que tengan cronograma
 * cargado (cronograma_fecha_inicio + installation_date = fin planeado).
 * Sin filtros server-side: el set esperado es de decenas de filas, se
 * filtra client-side por zona/constructor/conjunto.
 */

interface Row {
  id: string; code: string | null; title: string;
  client_name: string | null; conjunto: string | null; casa_numero: string | null;
  zona: string | null; client_city: string | null; contractor_name: string | null;
  cronograma_fecha_inicio: string; installation_date: string;
  operations_stage: string; current_module: string;
  inst_paneles_dc: boolean; inst_equipos_ac: boolean; inst_config_cierre: boolean;
  operativo_at: string | null;
}

function deriveZona(zona: string | null, city: string | null): string {
  if (zona) return zona;
  if (!city) return 'Sin zona';
  const c = city.trim().toLowerCase();
  if (['cali', 'jamundí', 'jamundi', 'yumbo', 'palmira', 'valle', 'buenaventura'].some((x) => c.includes(x))) return 'Valle';
  if (['barranquilla', 'soledad', 'malambo', 'puerto colombia', 'sabanagrande', 'galapa'].some((x) => c.includes(x))) return 'Costa';
  if (['cartagena', 'turbaco', 'arjona', 'magangué', 'magangue', 'bolívar', 'bolivar', 'sincelejo', 'monteria', 'montería'].some((x) => c.includes(x))) return 'Costa';
  return 'Sin zona';
}

function clienteCasaLabel(p: Row): string {
  const cliente = p.client_name ?? p.title ?? p.code ?? p.id.slice(0, 8);
  const casa = p.conjunto && p.casa_numero ? `${p.conjunto} · Casa ${p.casa_numero}` : (p.casa_numero ? `Casa ${p.casa_numero}` : null);
  return casa && casa !== cliente ? `${cliente} — ${casa}` : cliente;
}

export async function GET() {
  const { data, error } = await supabaseAdmin
    .from('crm_projects')
    .select(`
      id, code, title, client_name, conjunto, casa_numero, zona, client_city, contractor_name,
      cronograma_fecha_inicio, installation_date, operations_stage, current_module,
      inst_paneles_dc, inst_equipos_ac, inst_config_cierre, operativo_at
    `)
    .neq('current_module', 'closed')
    .not('cronograma_fecha_inicio', 'is', null)
    .not('installation_date', 'is', null)
    .order('cronograma_fecha_inicio', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = ((data ?? []) as Row[]).map((p) => {
    const done = [p.inst_paneles_dc, p.inst_equipos_ac, p.inst_config_cierre].filter(Boolean).length;
    return {
      id: p.id,
      cliente_casa: clienteCasaLabel(p),
      zona: deriveZona(p.zona, p.client_city),
      constructor: p.contractor_name ?? 'Sin asignar',
      conjunto: p.conjunto ?? 'Sin conjunto',
      cronograma_fecha_inicio: p.cronograma_fecha_inicio,
      cronograma_fecha_fin: p.installation_date,
      operations_stage: p.operations_stage,
      inst_progreso_pct: p.operations_stage === 'instalacion' ? Math.round((done / 3) * 100) : (p.operativo_at ? 100 : 0),
      operativo_at: p.operativo_at,
    };
  });

  return NextResponse.json({ rows });
}
