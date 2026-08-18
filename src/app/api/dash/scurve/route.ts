import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

/**
 * GET /api/dash/scurve?from=YYYY-MM-DD&to=YYYY-MM-DD&zona=...&constructor=...
 * Curva S del Dash de Construcción — ver
 * docs/superpowers/specs/2026-07-16-dash-gantt-scurve-design.md
 *
 * Universo: proyectos activos cuyo fin de cronograma (installation_date)
 * cae dentro de [from, to] (y coinciden con zona/constructor si se filtran)
 * — ese conjunto es el denominador (100%). Para cada semana del rango:
 *   planeado = % de proyectos con installation_date <= semana
 *   real     = % de proyectos con operativo_at <= semana
 *
 * from/to por defecto = mín/máx real de installation_date entre los
 * proyectos activos con cronograma cargado (no un valor fijo de
 * app_settings) — así el rango siempre refleja las fechas que de verdad
 * hay cargadas en el CRM, sin que el usuario tenga que ajustarlo a mano.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function weeklyPoints(from: Date, to: Date): Date[] {
  const points: Date[] = [];
  const cursor = new Date(from);
  while (cursor <= to) {
    points.push(new Date(cursor));
    cursor.setTime(cursor.getTime() + 7 * DAY_MS);
  }
  if (points.length === 0 || points[points.length - 1].getTime() !== to.getTime()) points.push(new Date(to));
  return points;
}

/** Misma regla que /api/dash/report y /api/dash/gantt. */
function deriveZona(zona: string | null, city: string | null): string {
  if (zona) return zona;
  if (!city) return 'Sin zona';
  const c = city.trim().toLowerCase();
  if (['cali', 'jamundí', 'jamundi', 'yumbo', 'palmira', 'valle', 'buenaventura'].some((x) => c.includes(x))) return 'Valle';
  if (['barranquilla', 'soledad', 'malambo', 'puerto colombia', 'sabanagrande', 'galapa'].some((x) => c.includes(x))) return 'Costa';
  if (['cartagena', 'turbaco', 'arjona', 'magangué', 'magangue', 'bolívar', 'bolivar', 'sincelejo', 'monteria', 'montería'].some((x) => c.includes(x))) return 'Costa';
  return 'Sin zona';
}

interface ProjRow {
  id: string; installation_date: string; operativo_at: string | null;
  zona: string | null; client_city: string | null; contractor_name: string | null;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const zonaFilter = url.searchParams.get('zona') ?? '';
  const constructorFilter = url.searchParams.get('constructor') ?? '';

  // Todos los proyectos activos con cronograma cargado — sirve tanto para
  // derivar el rango de fechas por defecto (mín/máx real) como las
  // opciones de los filtros de zona/constructor.
  const { data: allRaw, error } = await supabaseAdmin
    .from('crm_projects')
    .select('id, installation_date, operativo_at, zona, client_city, contractor_name')
    .neq('current_module', 'closed')
    .not('installation_date', 'is', null);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const all = (allRaw ?? []) as ProjRow[];

  const zonaOptions = Array.from(new Set(all.map((p) => deriveZona(p.zona, p.client_city)))).sort();
  const constructorOptions = Array.from(new Set(all.map((p) => p.contractor_name ?? 'Sin asignar'))).sort();

  const dates = all.map((p) => p.installation_date).sort();
  const today = toISODate(new Date());
  const defaultFrom = dates[0] ?? today;
  const defaultTo = dates[dates.length - 1] ?? today;

  const fromStr = url.searchParams.get('from') ?? defaultFrom;
  const toStr = url.searchParams.get('to') ?? defaultTo;
  const from = new Date(fromStr);
  const to = new Date(toStr);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) {
    return NextResponse.json({ error: 'Rango de fechas inválido' }, { status: 400 });
  }

  const universe = all.filter((p) => {
    if (p.installation_date < fromStr || p.installation_date > toStr) return false;
    if (zonaFilter && deriveZona(p.zona, p.client_city) !== zonaFilter) return false;
    if (constructorFilter && (p.contractor_name ?? 'Sin asignar') !== constructorFilter) return false;
    return true;
  });
  const total = universe.length;

  if (total === 0) {
    return NextResponse.json({ total: 0, from: fromStr, to: toStr, points: [], zonaOptions, constructorOptions });
  }

  const points = weeklyPoints(from, to).map((w) => {
    const wIso = toISODate(w);
    const planeadoCount = universe.filter((p) => p.installation_date <= wIso).length;
    const realCount = universe.filter((p) => p.operativo_at != null && p.operativo_at.slice(0, 10) <= wIso).length;
    return {
      week: wIso,
      planeado: Math.round((planeadoCount / total) * 1000) / 10,
      real: Math.round((realCount / total) * 1000) / 10,
    };
  });

  return NextResponse.json({ total, from: fromStr, to: toStr, points, zonaOptions, constructorOptions });
}
