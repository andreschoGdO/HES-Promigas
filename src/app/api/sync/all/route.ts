import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { loginToMetrum, getDailyClosure } from '@/lib/metrum-api';

interface TimeseriesPoint {
  ts: number;
  value: string | number;
}
type ClosureResponse = Record<string, TimeseriesPoint[] | undefined>;

const pickLatest = (series: TimeseriesPoint[] | undefined): number | null => {
  if (!series || series.length === 0) return null;
  const latest = series.reduce((acc, cur) => (cur.ts > acc.ts ? cur : acc));
  const num = Number(latest.value);
  return Number.isFinite(num) ? num : null;
};

/**
 * GET /api/sync/all?from=YYYY-MM-DD&to=YYYY-MM-DD
 * Loops through every device in Supabase and stores one daily_energy_closures
 * row per day in the requested range. Defaults to yesterday → today.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const today = new Date();
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);

  const fromStr = url.searchParams.get('from') ?? yesterday.toISOString().slice(0, 10);
  const toStr = url.searchParams.get('to') ?? today.toISOString().slice(0, 10);

  const fromDate = new Date(fromStr + 'T00:00:00Z');
  const toDate = new Date(toStr + 'T23:59:59Z');

  if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime()) || fromDate > toDate) {
    return NextResponse.json({ error: 'Invalid date range' }, { status: 400 });
  }

  try {
    const { data: devices, error: devErr } = await supabaseAdmin
      .from('devices')
      .select('id, metrum_id, name');
    if (devErr) throw devErr;
    if (!devices || devices.length === 0) {
      return NextResponse.json(
        { error: 'No hay dispositivos. Ejecuta /api/devices/sync primero.' },
        { status: 400 },
      );
    }

    const token = await loginToMetrum();

    // Build list of days
    const days: Date[] = [];
    for (let d = new Date(fromDate); d <= toDate; d.setUTCDate(d.getUTCDate() + 1)) {
      days.push(new Date(d));
    }

    const results: Array<{ device: string; date: string; ok: boolean; error?: string }> = [];
    let inserted = 0;

    for (const device of devices) {
      for (const day of days) {
        const startTs = day.getTime();
        const endTs = startTs + 24 * 60 * 60 * 1000 - 1;
        try {
          const closure = (await getDailyClosure(token, device.metrum_id, startTs, endTs)) as ClosureResponse;
          const row = {
            device_id: device.id,
            record_date: day.toISOString().slice(0, 10),
            energy_active_imported_wh: pickLatest(closure.CenergyAI),
            energy_active_exported_wh: pickLatest(closure.CenergyAE),
            energy_reactive_imported_varh: pickLatest(closure.CenergyRI),
            energy_reactive_exported_varh: pickLatest(closure.CenergyRE),
          };
          const hasAny =
            row.energy_active_imported_wh !== null ||
            row.energy_active_exported_wh !== null ||
            row.energy_reactive_imported_varh !== null ||
            row.energy_reactive_exported_varh !== null;
          if (!hasAny) {
            results.push({ device: device.name, date: row.record_date, ok: false, error: 'sin datos' });
            continue;
          }
          const { error } = await supabaseAdmin
            .from('daily_energy_closures')
            .upsert(row, { onConflict: 'device_id,record_date' });
          if (error) throw error;
          inserted++;
          results.push({ device: device.name, date: row.record_date, ok: true });
        } catch (e) {
          results.push({
            device: device.name,
            date: day.toISOString().slice(0, 10),
            ok: false,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
    }

    await supabaseAdmin
      .from('devices')
      .update({ last_seen_at: new Date().toISOString() })
      .in('id', devices.map((d) => d.id));

    return NextResponse.json({ success: true, inserted, total: results.length, results });
  } catch (err) {
    console.error('Bulk sync error:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
