import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { computeCurtailmentByDay } from '@/lib/curtailment';

/**
 * GET /api/cron/compute-curtailment?days=30
 *
 * Calcula curtailment DC integrado por día y casa para los últimos `days` días
 * (default 30) y hace upsert en daily_curtailment_by_house.
 *
 * El integrador hace P95(DC, hora) usando TODA la ventana fetched, así que
 * re-ejecutar refresca también los días ya guardados (idempotente). El cron
 * nocturno lo corre una vez al día.
 *
 * Auth: misma convención que /api/cron/sync — Authorization Bearer CRON_SECRET
 * o header X-Cron-Secret. En dev se puede omitir si CRON_SECRET no está set.
 */
export const runtime = 'nodejs';
export const maxDuration = 300;

const dateStr = (d: Date) => d.toISOString().slice(0, 10);

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get('authorization') ?? '';
  const triggerHeader = request.headers.get('x-trigger') ?? 'cron';
  const isInternalUI = triggerHeader === 'manual';
  if (secret && auth !== `Bearer ${secret}` && !isInternalUI) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    const url = new URL(request.url);
    const days = Math.min(Math.max(Number(url.searchParams.get('days') ?? 30), 1), 60);

    // El cron usa "ahora menos N días" → "ayer". No incluimos hoy porque está incompleto.
    const todayUtc = new Date();
    const to = new Date(todayUtc.getTime() - 86400000);
    const from = new Date(todayUtc.getTime() - days * 86400000);
    const fromStr = dateStr(from);
    const toStr = dateStr(to);

    const startTs = Date.now();

    // Debug: cuántos devices hay según los filtros actuales
    const { data: debugDevices, count: debugCount } = await supabaseAdmin
      .from('devices')
      .select('id, casa, marca, type, is_active, metrum_id', { count: 'exact' })
      .limit(500);
    const debug = {
      total_in_devices: debugCount,
      sample: (debugDevices ?? []).slice(0, 5).map((d) => ({
        casa: d.casa, marca: d.marca, type: d.type, is_active: d.is_active, has_metrum: !!d.metrum_id,
      })),
      with_marca: (debugDevices ?? []).filter((d) => d.marca).length,
      with_casa: (debugDevices ?? []).filter((d) => d.casa).length,
      with_metrum: (debugDevices ?? []).filter((d) => d.metrum_id).length,
      is_active: (debugDevices ?? []).filter((d) => d.is_active).length,
      distinct_marca: Array.from(new Set((debugDevices ?? []).map((d) => d.marca).filter(Boolean))),
      distinct_type: Array.from(new Set((debugDevices ?? []).map((d) => d.type).filter(Boolean))),
    };

    const rows = await computeCurtailmentByDay(fromStr, toStr);

    let upserted = 0;
    if (rows.length > 0) {
      // Procesar en batches por si Supabase tiene límites en upserts grandes
      const BATCH = 200;
      for (let i = 0; i < rows.length; i += BATCH) {
        const chunk = rows.slice(i, i + BATCH);
        const { error } = await supabaseAdmin
          .from('daily_curtailment_by_house')
          .upsert(
            chunk.map((r) => ({
              casa: r.casa,
              house_id: r.house_id,
              record_date: r.record_date,
              curtailment_kwh: r.curtailment_kwh,
              devices_count: r.devices_count,
              source: 'metrum+ghi',
              computed_at: new Date().toISOString(),
            })),
            { onConflict: 'casa,record_date' },
          );
        if (error) throw new Error(`Upsert chunk ${i}: ${error.message}`);
        upserted += chunk.length;
      }
    }

    return NextResponse.json({
      ok: true,
      from: fromStr,
      to: toStr,
      days,
      rows_computed: rows.length,
      rows_upserted: upserted,
      casas: new Set(rows.map((r) => r.casa)).size,
      elapsed_ms: Date.now() - startTs,
      debug,
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}
