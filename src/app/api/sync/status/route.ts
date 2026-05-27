import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

/**
 * GET /api/sync/status
 * Devuelve los timestamps de la última fila por tabla. Útil para diagnosticar
 * si los crons (Vercel diario + GitHub Actions cada 15 min) están vivos.
 *
 * No expone datos sensibles, solo timestamps + conteos.
 */
export async function GET() {
  try {
    const [instant, casa, closures, devicesActive, devicesTotal] = await Promise.all([
      supabaseAdmin.from('instant_metrics').select('recorded_at').order('recorded_at', { ascending: false }).limit(1).maybeSingle(),
      supabaseAdmin.from('daily_casa_metrics').select('record_date').order('record_date', { ascending: false }).limit(1).maybeSingle(),
      supabaseAdmin.from('daily_energy_closures').select('record_date').order('record_date', { ascending: false }).limit(1).maybeSingle(),
      supabaseAdmin.from('devices').select('last_seen_at', { count: 'exact', head: false }).order('last_seen_at', { ascending: false }).limit(1).maybeSingle(),
      supabaseAdmin.from('devices').select('id', { count: 'exact', head: true }),
    ]);

    return NextResponse.json({
      instant_metrics: { last_at: instant.data?.recorded_at ?? null },
      casa_metrics:    { last_date: casa.data?.record_date ?? null },
      closures:        { last_date: closures.data?.record_date ?? null },
      devices:         { last_seen_max: devicesActive.data?.last_seen_at ?? null, total: devicesTotal.count ?? null },
      now: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}
