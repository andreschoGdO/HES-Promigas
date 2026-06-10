import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

/**
 * POST /api/crm/projects/sync-coords
 *
 * Recorre todos los proyectos que tienen visita_previa_id pero les falta
 * lat/lng, lee las coordenadas del form_data.coordenadas (o lat/lng directos
 * del field_visits) y las copia al proyecto.
 *
 * Útil para retro-llenar coords después de crear proyectos antes de tener
 * esta sincronización en el POST/PATCH.
 */
const parseCoords = (raw: unknown): [number, number] | null => {
  if (!raw || typeof raw !== 'string') return null;
  const parts = raw.trim().split(/[\s,;]+/).filter(Boolean);
  if (parts.length < 2) return null;
  const lat = Number(parts[0]);
  const lng = Number(parts[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return [lat, lng];
};

export async function POST() {
  const { data: projects, error } = await supabaseAdmin
    .from('crm_projects')
    .select('id, code, visita_previa_id, lat, lng')
    .not('visita_previa_id', 'is', null)
    .or('lat.is.null,lng.is.null');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const updated: Array<{ code: string | null; lat: number; lng: number }> = [];
  const skipped: string[] = [];

  for (const p of projects ?? []) {
    const { data: visit } = await supabaseAdmin
      .from('field_visits')
      .select('form_data, lat, lng')
      .eq('id', p.visita_previa_id!)
      .maybeSingle();
    if (!visit) { skipped.push(`${p.code}: visita no encontrada`); continue; }

    let lat: number | null = visit.lat != null ? Number(visit.lat) : null;
    let lng: number | null = visit.lng != null ? Number(visit.lng) : null;
    if ((lat == null || lng == null) && visit.form_data) {
      const coords = parseCoords((visit.form_data as Record<string, unknown>).coordenadas);
      if (coords) { lat = coords[0]; lng = coords[1]; }
    }
    if (lat == null || lng == null) { skipped.push(`${p.code}: sin coordenadas en el acta`); continue; }

    await supabaseAdmin.from('crm_projects').update({ lat, lng }).eq('id', p.id);
    updated.push({ code: p.code, lat, lng });
  }

  return NextResponse.json({ updated_count: updated.length, updated, skipped });
}
