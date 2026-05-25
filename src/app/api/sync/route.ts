import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { loginToMetrum, getDailyClosure } from '@/lib/metrum-api';

interface TimeseriesPoint {
  ts: number;
  value: string | number;
}

type ClosureResponse = Record<string, TimeseriesPoint[] | undefined>;

/**
 * GET /api/sync?metrumId=<id>&startTs=<ms>&endTs=<ms>
 * Reads the daily closure (CenergyAI/AE/RI/RE) from Metrum for one device
 * and stores it as a single row in daily_energy_closures.
 *
 * Designed to be called by a Vercel Cron Job once per day per device.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const metrumId = url.searchParams.get('metrumId') ?? url.searchParams.get('deviceId');
  const startTs = Number(url.searchParams.get('startTs'));
  const endTs = Number(url.searchParams.get('endTs'));

  if (!metrumId || !Number.isFinite(startTs) || !Number.isFinite(endTs)) {
    return NextResponse.json(
      { error: 'Missing required query parameters: metrumId, startTs, endTs' },
      { status: 400 },
    );
  }

  try {
    // 1. Resolve internal device UUID from metrum_id
    const { data: device, error: deviceErr } = await supabaseAdmin
      .from('devices')
      .select('id')
      .eq('metrum_id', metrumId)
      .single();

    if (deviceErr || !device) {
      return NextResponse.json(
        { error: `Device with metrum_id=${metrumId} not found. Run /api/devices/sync first.` },
        { status: 404 },
      );
    }

    // 2. Authenticate + fetch telemetry
    const token = await loginToMetrum();
    const closure = (await getDailyClosure(token, metrumId, startTs, endTs)) as ClosureResponse;

    // 3. Pick the latest point per key in the requested window
    const pickLatest = (key: string): number | null => {
      const series = closure[key];
      if (!series || series.length === 0) return null;
      const latest = series.reduce((acc, cur) => (cur.ts > acc.ts ? cur : acc));
      const num = Number(latest.value);
      return Number.isFinite(num) ? num : null;
    };

    const recordDate = new Date(startTs).toISOString().slice(0, 10); // YYYY-MM-DD

    const row = {
      device_id: device.id,
      record_date: recordDate,
      energy_active_imported_wh: pickLatest('CenergyAI'),
      energy_active_exported_wh: pickLatest('CenergyAE'),
      energy_reactive_imported_varh: pickLatest('CenergyRI'),
      energy_reactive_exported_varh: pickLatest('CenergyRE'),
    };

    // 4. Upsert (device_id, record_date) is unique
    const { error: insertErr } = await supabaseAdmin
      .from('daily_energy_closures')
      .upsert(row, { onConflict: 'device_id,record_date' });

    if (insertErr) {
      console.error('Supabase insert error:', insertErr);
      return NextResponse.json(
        { error: 'Supabase insert failed', details: insertErr.message },
        { status: 500 },
      );
    }

    // 5. Update last_seen_at on the device
    await supabaseAdmin
      .from('devices')
      .update({ last_seen_at: new Date().toISOString() })
      .eq('id', device.id);

    return NextResponse.json({ success: true, row });
  } catch (err) {
    console.error('Sync route error:', err);
    return NextResponse.json(
      { error: 'Unexpected error', details: (err as Error).message },
      { status: 500 },
    );
  }
}
