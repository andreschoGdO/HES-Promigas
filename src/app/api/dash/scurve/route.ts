import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

/**
 * GET /api/dash/scurve?from=YYYY-MM-DD&to=YYYY-MM-DD
 * Curva S del Dash de Construcción — ver
 * docs/superpowers/specs/2026-07-16-dash-gantt-scurve-design.md
 *
 * Universo: proyectos activos cuyo fin de cronograma (installation_date)
 * cae dentro de [from, to] — ese conjunto es el denominador (100%).
 * Para cada semana del rango:
 *   planeado = % de proyectos con installation_date <= semana
 *   real     = % de proyectos con operativo_at <= semana
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

export async function GET(request: Request) {
  const url = new URL(request.url);

  const { data: settings } = await supabaseAdmin
    .from('app_settings')
    .select('key, value')
    .eq('key', 'dash_project_start');
  const projectStartRaw = (settings ?? [])[0]?.value as { value?: string } | undefined;
  const defaultFrom = projectStartRaw?.value ?? '2025-10-01';
  const defaultTo = toISODate(new Date(Date.now() + 60 * DAY_MS));

  const fromStr = url.searchParams.get('from') ?? defaultFrom;
  const toStr = url.searchParams.get('to') ?? defaultTo;
  const from = new Date(fromStr);
  const to = new Date(toStr);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) {
    return NextResponse.json({ error: 'Rango de fechas inválido' }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from('crm_projects')
    .select('id, installation_date, operativo_at')
    .neq('current_module', 'closed')
    .gte('installation_date', fromStr)
    .lte('installation_date', toStr);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const universe = (data ?? []) as Array<{ id: string; installation_date: string; operativo_at: string | null }>;
  const total = universe.length;

  if (total === 0) {
    return NextResponse.json({ total: 0, from: fromStr, to: toStr, points: [] });
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

  return NextResponse.json({ total, from: fromStr, to: toStr, points });
}
