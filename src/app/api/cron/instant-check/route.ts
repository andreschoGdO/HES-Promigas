import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { loginToMetrum, getTimeseries } from '@/lib/metrum-api';

/**
 * GET /api/cron/instant-check
 *
 * Lazo de control de 15 minutos. Disparado por GitHub Actions cada `*​/15 * * * *`.
 *
 * Pasos:
 *  1. Por cada casa: trae powerAI, powerRI, currentA/B/C del meter rojo (últimos 15 min)
 *  2. Por cada inversor DEYE: trae TLBattSOC, TLinvstate
 *  3. Calcula derivadas: cos_phi_now, fase_imbalance_pct
 *  4. Upsert en instant_metrics (1 fila por casa por ventana de 15 min)
 *  5. Llama a /api/alerts/evaluate para que dispare reglas instantáneas
 *
 * Auth: header Authorization Bearer ${CRON_SECRET}
 */
export const runtime = 'nodejs';
export const maxDuration = 60;

const PERIOD_MS = 15 * 60 * 1000;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get('authorization') ?? '';
  if (secret && auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const startedAt = Date.now();
  const auditRow = (await supabaseAdmin
    .from('cron_runs')
    .insert({ trigger: 'instant', status: 'running' })
    .select('id')
    .single()).data;
  const auditId = auditRow?.id as string | undefined;

  try {
    // Cargar casas y devices
    const [housesRes, devicesRes] = await Promise.all([
      supabaseAdmin.from('client_houses').select('id, casa'),
      supabaseAdmin.from('devices').select('id, metrum_id, name, subtype, house_id, is_active, last_seen_at, alarm_flags'),
    ]);
    if (housesRes.error) throw housesRes.error;
    if (devicesRes.error) throw devicesRes.error;

    const houses = housesRes.data ?? [];
    const devices = devicesRes.data ?? [];
    const byHouse = new Map<string, typeof devices>();
    for (const d of devices) {
      if (!d.house_id) continue;
      if (!byHouse.has(d.house_id)) byHouse.set(d.house_id, []);
      byHouse.get(d.house_id)!.push(d);
    }

    const token = await loginToMetrum();

    const now = Date.now();
    const windowStart = now - PERIOD_MS;
    const recordedAt = new Date(now).toISOString();

    // Helper: extrae el último valor disponible de una serie
    const latestVal = (series: Array<{ ts: number; value: string | number }> | undefined): number | null => {
      if (!series || series.length === 0) return null;
      const latest = series.reduce((a, c) => (c.ts > a.ts ? c : a));
      const n = Number(latest.value);
      return Number.isFinite(n) ? n : null;
    };
    // Helper: el máximo absoluto de una serie
    const maxVal = (series: Array<{ ts: number; value: string | number }> | undefined): number | null => {
      if (!series || series.length === 0) return null;
      let m: number | null = null;
      for (const p of series) {
        const n = Number(p.value);
        if (Number.isFinite(n) && (m === null || n > m)) m = n;
      }
      return m;
    };

    let processed = 0;
    let failed = 0;
    const payload: Array<Record<string, unknown>> = [];

    for (const house of houses) {
      const members = byHouse.get(house.id) ?? [];
      const meterRed = members.find((m) => m.subtype === 'meter_red');
      const inverter = members.find((m) => m.subtype === 'inverter');
      const gateway = members.find((m) => m.subtype === 'gateway');

      let powerAI: number | null = null;
      let powerRI: number | null = null;
      let currentAmax: number | null = null;
      let faseImbalance: number | null = null;
      let invCurrentMax: number | null = null;
      let battSoc: number | null = null;
      let invState: string | null = null;
      let voltageA: number | null = null;
      let voltageB: number | null = null;
      let voltageC: number | null = null;
      let voltageMin: number | null = null;
      let voltageMax: number | null = null;
      let voltageImbalance: number | null = null;
      let frequencyHz: number | null = null;

      // 1. Meter rojo: potencia activa + reactiva + corrientes + voltajes + frecuencia
      if (meterRed) {
        try {
          // Fetch principal: potencias y corrientes (siempre disponibles en Eastron)
          const data = await getTimeseries(token, meterRed.metrum_id, ['powerAI', 'powerRI', 'currentA', 'currentB', 'currentC'], windowStart, now + 60_000, { agg: 'NONE', limit: 50 }) as Record<string, Array<{ ts: number; value: string | number }>>;
          powerAI = latestVal(data['powerAI']);
          powerRI = latestVal(data['powerRI']);
          const ia = maxVal(data['currentA']);
          const ib = maxVal(data['currentB']);
          const ic = maxVal(data['currentC']);
          const phases = [ia, ib, ic].filter((x): x is number => x !== null && Number.isFinite(x));
          if (phases.length > 0) {
            currentAmax = Math.max(...phases);
            const mn = Math.min(...phases);
            faseImbalance = currentAmax > 0 ? ((currentAmax - mn) / currentAmax) * 100 : 0;
          }
        } catch (e) {
          failed++;
          console.error('meter_red fetch error', house.casa, e instanceof Error ? e.message : e);
        }

        // Fetch separado de voltajes + frecuencia. Probamos varias keys porque Eastron
        // puede exponerlas con nombres distintos según firmware (voltageA / UAI / voltageL1N).
        // Si ninguna existe en Metrum, las columnas quedan null y las reglas no disparan.
        try {
          const vData = await getTimeseries(token, meterRed.metrum_id,
            ['voltageA', 'voltageB', 'voltageC', 'frequency', 'UAI', 'UBI', 'UCI', 'voltageL1N', 'voltageL2N', 'voltageL3N'],
            windowStart, now + 60_000, { agg: 'NONE', limit: 30 }) as Record<string, Array<{ ts: number; value: string | number }>>;
          voltageA = latestVal(vData['voltageA']) ?? latestVal(vData['UAI']) ?? latestVal(vData['voltageL1N']);
          voltageB = latestVal(vData['voltageB']) ?? latestVal(vData['UBI']) ?? latestVal(vData['voltageL2N']);
          voltageC = latestVal(vData['voltageC']) ?? latestVal(vData['UCI']) ?? latestVal(vData['voltageL3N']);
          frequencyHz = latestVal(vData['frequency']);
          const voltages = [voltageA, voltageB, voltageC].filter((x): x is number => x !== null && Number.isFinite(x) && x > 0);
          if (voltages.length > 0) {
            voltageMin = Math.min(...voltages);
            voltageMax = Math.max(...voltages);
            voltageImbalance = voltageMax > 0 ? ((voltageMax - voltageMin) / voltageMax) * 100 : 0;
          }
        } catch (e) {
          // No es crítico: si Metrum no expone estos keys, simplemente quedan null
          console.warn('voltage fetch warning', house.casa, e instanceof Error ? e.message : e);
        }
      }

      // 2. Inversor: corriente + estado batería/on-off (DEYE)
      if (inverter) {
        try {
          const data = await getTimeseries(token, inverter.metrum_id, ['currentA', 'currentB', 'currentC'], windowStart, now + 60_000, { agg: 'NONE', limit: 30 }) as Record<string, Array<{ ts: number; value: string | number }>>;
          const ia = maxVal(data['currentA']);
          const ib = maxVal(data['currentB']);
          const ic = maxVal(data['currentC']);
          const phases = [ia, ib, ic].filter((x): x is number => x !== null && Number.isFinite(x));
          if (phases.length > 0) invCurrentMax = Math.max(...phases);
          // SOC y estado vienen de alarm_flags ya capturado por devices/sync
          const flags = (inverter.alarm_flags as Record<string, number | string> | null) ?? {};
          if (typeof flags.TLBattSOC === 'number') battSoc = flags.TLBattSOC;
          if (typeof flags.TLinvstate === 'string') invState = flags.TLinvstate;
        } catch (e) {
          failed++;
          console.error('inverter fetch error', house.casa, e instanceof Error ? e.message : e);
        }
      }

      // 3. Estado del gateway (sin red, basado en is_active y last_seen_at)
      // Si la casa no tiene gateway registrado, no podemos afirmar que esté "online" → false
      const gatewayOnline = gateway ? gateway.is_active !== false : false;
      const gatewayLastSeen = gateway?.last_seen_at ?? null;

      // 4. Calcular cos φ instantáneo
      let cosPhi: number | null = null;
      if (powerAI !== null && powerRI !== null && powerAI > 0) {
        cosPhi = powerAI / Math.sqrt(powerAI * powerAI + powerRI * powerRI);
      }

      payload.push({
        house_id: house.id,
        casa: house.casa,
        recorded_at: recordedAt,
        current_a_max: currentAmax,
        power_active_w: powerAI,
        power_reactive_var: powerRI,
        cos_phi_now: cosPhi,
        fase_imbalance_pct: faseImbalance,
        inv_state: invState,
        inv_current_a_max: invCurrentMax,
        batt_soc_pct: battSoc,
        gateway_online: gatewayOnline,
        gateway_last_seen: gatewayLastSeen,
        voltage_a_v: voltageA,
        voltage_b_v: voltageB,
        voltage_c_v: voltageC,
        voltage_min_v: voltageMin,
        voltage_max_v: voltageMax,
        voltage_imbalance_pct: voltageImbalance,
        frequency_hz: frequencyHz,
      });
      processed++;
    }

    if (payload.length > 0) {
      const { error: upErr } = await supabaseAdmin
        .from('instant_metrics')
        .upsert(payload, { onConflict: 'house_id,recorded_at' });
      if (upErr) throw upErr;
    }

    // Disparar evaluación de reglas instantáneas
    let alertsResult: { fired?: number; evaluated?: number } = {};
    try {
      const url = new URL(request.url);
      const base = `${url.protocol}//${url.host}`;
      const r = await fetch(`${base}/api/alerts/evaluate?source=instant`, { headers: { 'x-internal': '1' } });
      alertsResult = await r.json();
    } catch (e) {
      console.error('alerts evaluate failed', e instanceof Error ? e.message : e);
    }

    const durationMs = Date.now() - startedAt;
    if (auditId) {
      await supabaseAdmin
        .from('cron_runs')
        .update({
          finished_at: new Date().toISOString(),
          status: failed > 0 ? 'partial' : 'success',
          steps: { processed, failed, duration_ms: durationMs, alerts: alertsResult },
        })
        .eq('id', auditId);
    }

    return NextResponse.json({
      success: true,
      processed,
      failed,
      duration_ms: durationMs,
      alerts: alertsResult,
    });
  } catch (err) {
    if (auditId) {
      await supabaseAdmin
        .from('cron_runs')
        .update({
          finished_at: new Date().toISOString(),
          status: 'error',
          error_message: err instanceof Error ? err.message : String(err),
        })
        .eq('id', auditId);
    }
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}
