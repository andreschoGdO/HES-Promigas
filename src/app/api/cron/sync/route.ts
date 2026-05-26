import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { loginToMetrum, getTimeseries } from '@/lib/metrum-api';

/**
 * GET /api/cron/sync
 *
 * Cron horario (Vercel Cron: 0 * * * *) que sincroniza TODO desde Metrum
 * y pre-computa las métricas por casa en daily_casa_metrics. Auditoría en cron_runs.
 *
 * Pasos (en cascada, no abortan si uno falla):
 *   1. /api/devices/sync     → upsert de 117 devices
 *   2. /api/houses/build     → 28 casas + subtype
 *   3. /api/sync/all         → daily_energy_closures por device
 *   4. /api/sync/consumption → daily_consumption por casa
 *   5. computeCasaMetrics    → daily_casa_metrics (incluye imax)
 *
 * Auth: header X-Cron-Secret debe coincidir con CRON_SECRET (Vercel Cron lo añade
 * automáticamente vía vercel.json). En dev se puede omitir.
 */
export const runtime = 'nodejs';
export const maxDuration = 300; // 5 min — pre-compute imax es lento

const YIELD_TEORICO_REF = 4.5;
const RANGE_DAYS = 14; // re-computar últimos 14 días por si llegó data atrasada

interface AuditSteps {
  devices?: number;
  houses?: number;
  cierres?: { inserted: number; total: number };
  consumo?: { inserted: number; days: number };
  casa_metrics?: { upserted: number; range_days: number };
  alerts?: { evaluated: number; fired: number };
}

export async function GET(request: Request) {
  // Auth: Vercel Cron envía un header Authorization con el CRON_SECRET.
  // Si la petición viene del propio dominio (botón "Sincronizar Metrum") aceptamos sin secret.
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get('authorization') ?? '';
  const triggerHeader = request.headers.get('x-trigger') ?? 'cron';
  const isInternalUI = triggerHeader === 'manual';
  if (secret && auth !== `Bearer ${secret}` && !isInternalUI) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // Modo quick: salta los pasos pesados (sync/all + sync/consumption) que no caben en 60s de Vercel Hobby.
  // El cron diario sigue corriendo el ciclo completo (sin x-trigger=manual).
  const url = new URL(request.url);
  const quick = url.searchParams.get('quick') === '1' || isInternalUI;

  // 1. Crear audit row
  const { data: auditRow } = await supabaseAdmin
    .from('cron_runs')
    .insert({ trigger: triggerHeader, status: 'running' })
    .select('id')
    .single();
  const auditId = auditRow?.id as string | undefined;

  const base = `${url.protocol}//${url.host}`;
  const steps: AuditSteps = {};
  const errors: string[] = [];

  const callInternal = async (path: string, method: 'GET' | 'POST' = 'GET'): Promise<unknown> => {
    const r = await fetch(`${base}${path}`, { method, headers: { 'x-internal-cron': '1' } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`${path} → ${j.error ?? 'HTTP ' + r.status}`);
    return j;
  };

  try {
    // 1. Devices
    try {
      const j = (await callInternal('/api/devices/sync')) as { inserted?: number };
      steps.devices = j.inserted ?? 0;
    } catch (e) {
      errors.push(`devices: ${e instanceof Error ? e.message : e}`);
    }

    // 2. Houses
    try {
      const j = (await callInternal('/api/houses/build', 'POST')) as { houses?: number };
      steps.houses = j.houses ?? 0;
    } catch (e) {
      errors.push(`houses: ${e instanceof Error ? e.message : e}`);
    }

    // 3. Cierres (últimos 14 días) — SOLO en modo full (cron diario)
    const today = new Date();
    const fromDate = new Date(today.getTime() - RANGE_DAYS * 86400000);
    const fromStr = fromDate.toISOString().slice(0, 10);
    const toStr = today.toISOString().slice(0, 10);
    if (!quick) {
      try {
        const j = (await callInternal(`/api/sync/all?from=${fromStr}&to=${toStr}`)) as { inserted?: number; total?: number };
        steps.cierres = { inserted: j.inserted ?? 0, total: j.total ?? 0 };
      } catch (e) {
        errors.push(`cierres: ${e instanceof Error ? e.message : e}`);
      }

      // 4. Consumo (últimos 14 días) — SOLO en modo full
      try {
        const j = (await callInternal(`/api/sync/consumption?from=${fromStr}&to=${toStr}`)) as { rows_upserted?: number; days_per_house?: number };
        steps.consumo = { inserted: j.rows_upserted ?? 0, days: j.days_per_house ?? 0 };
      } catch (e) {
        errors.push(`consumo: ${e instanceof Error ? e.message : e}`);
      }
    } else {
      // En modo quick anotamos que se saltaron los pesados
      steps.cierres = { inserted: 0, total: 0 };
      steps.consumo = { inserted: 0, days: 0 };
    }

    // 5. Pre-compute casa metrics (de la data ya en Supabase)
    try {
      const result = await computeAndStoreCasaMetrics(fromStr, toStr);
      steps.casa_metrics = result;
    } catch (e) {
      errors.push(`casa_metrics: ${e instanceof Error ? e.message : e}`);
    }

    // 6. Evaluar alertas contra las métricas pre-computadas
    try {
      const j = (await callInternal('/api/alerts/evaluate')) as { evaluated?: number; fired?: number };
      steps.alerts = { evaluated: j.evaluated ?? 0, fired: j.fired ?? 0 };
    } catch (e) {
      errors.push(`alerts: ${e instanceof Error ? e.message : e}`);
    }

    // Update audit
    const finalStatus = errors.length === 0 ? 'success' : errors.length === 6 ? 'error' : 'partial';
    if (auditId) {
      await supabaseAdmin
        .from('cron_runs')
        .update({
          finished_at: new Date().toISOString(),
          status: finalStatus,
          steps,
          error_message: errors.length > 0 ? errors.join(' | ') : null,
        })
        .eq('id', auditId);
    }

    return NextResponse.json({ success: errors.length === 0, status: finalStatus, steps, errors });
  } catch (err) {
    if (auditId) {
      await supabaseAdmin
        .from('cron_runs')
        .update({
          finished_at: new Date().toISOString(),
          status: 'error',
          steps,
          error_message: err instanceof Error ? err.message : String(err),
        })
        .eq('id', auditId);
    }
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}

// ─────────────────────────────────────────────────────────────────
// Pre-cómputo de daily_casa_metrics
// ─────────────────────────────────────────────────────────────────

interface ClosureWithDevice {
  device_id: string;
  record_date: string;
  energy_active_imported_wh: number | null;
  energy_active_exported_wh: number | null;
  devices: {
    type: string | null;
    casa: string | null;
    potencia_kw: number | null;
    metrum_id: string;
  } | null;
}

async function computeAndStoreCasaMetrics(fromStr: string, toStr: string) {
  // Traer cierres con device info — necesitamos un día previo para deltas
  const baselineFrom = new Date(new Date(fromStr + 'T00:00:00Z').getTime() - 86400000).toISOString().slice(0, 10);

  const { data, error } = await supabaseAdmin
    .from('daily_energy_closures')
    .select('device_id, record_date, energy_active_imported_wh, energy_active_exported_wh, devices(type, casa, potencia_kw, metrum_id)')
    .gte('record_date', baselineFrom)
    .lte('record_date', toStr)
    .order('record_date', { ascending: true })
    .limit(20000);
  if (error) throw error;

  const closures = (data ?? []) as unknown as ClosureWithDevice[];

  // Agrupar por device + ordenar
  const byDevice = new Map<string, ClosureWithDevice[]>();
  for (const c of closures) {
    if (!c.devices?.casa) continue;
    if (!byDevice.has(c.device_id)) byDevice.set(c.device_id, []);
    byDevice.get(c.device_id)!.push(c);
  }
  for (const arr of byDevice.values()) arr.sort((a, b) => a.record_date.localeCompare(b.record_date));

  // Acumular por casa+fecha
  type Agg = {
    casa: string;
    date: string;
    inv_eae: number | null;
    red_eai: number | null;
    red_eae: number | null;
    potencia_kw: number | null;
    inv_metrum: string | null;
    red_metrum: string | null;
  };
  const byKey = new Map<string, Agg>();
  for (const rows of byDevice.values()) {
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const prev = rows[i - 1];
      const dev = r.devices!;
      const eaiDelta = r.energy_active_imported_wh !== null && prev.energy_active_imported_wh !== null
        ? r.energy_active_imported_wh - prev.energy_active_imported_wh : null;
      const eaeDelta = r.energy_active_exported_wh !== null && prev.energy_active_exported_wh !== null
        ? r.energy_active_exported_wh - prev.energy_active_exported_wh : null;
      const k = `${dev.casa}|${r.record_date}`;
      let a = byKey.get(k);
      if (!a) {
        a = { casa: dev.casa!, date: r.record_date, inv_eae: null, red_eai: null, red_eae: null, potencia_kw: null, inv_metrum: null, red_metrum: null };
        byKey.set(k, a);
      }
      const t = (dev.type ?? '').toLowerCase();
      if (t === 'inverter' || t === 'inversor') {
        a.inv_eae = (a.inv_eae ?? 0) + (eaeDelta ?? 0);
        a.potencia_kw = (a.potencia_kw ?? 0) + (dev.potencia_kw ?? 0);
        a.inv_metrum = dev.metrum_id;
      } else if (t === 'red') {
        a.red_eai = (a.red_eai ?? 0) + (eaiDelta ?? 0);
        a.red_eae = (a.red_eae ?? 0) + (eaeDelta ?? 0);
        a.red_metrum = dev.metrum_id;
      }
    }
  }

  // Mapear casa name → house_id
  const { data: houses } = await supabaseAdmin.from('client_houses').select('id, casa');
  const houseByCasa = new Map((houses ?? []).map((h: { id: string; casa: string }) => [h.casa, h.id]));

  // Pre-fetch imax para cada casa-día (Metrum timeseries con AGG=MAX)
  // Solo para los últimos 7 días para no sobrecargar el cron
  const today = new Date();
  const imaxCutoff = new Date(today.getTime() - 7 * 86400000).toISOString().slice(0, 10);
  const aggsForImax = Array.from(byKey.values()).filter((a) => a.date >= imaxCutoff && a.date >= fromStr);

  let token: string | null = null;
  const fetchImax = async (metrumId: string, dateStr: string): Promise<number | null> => {
    const startTs = new Date(dateStr + 'T00:00:00Z').getTime();
    const endTs = startTs + 86400000;
    try {
      if (!token) token = await loginToMetrum();
      const raw = await getTimeseries(token, metrumId, ['currentA', 'currentB', 'currentC'], startTs, endTs, {
        agg: 'MAX',
        interval: 24 * 60 * 60 * 1000,
      });
      let max = 0;
      for (const arr of Object.values(raw as Record<string, Array<{ value: string | number }>>)) {
        for (const p of arr) {
          const v = Number(p.value);
          if (Number.isFinite(v) && v > max) max = v;
        }
      }
      return max > 0 ? max : null;
    } catch {
      return null;
    }
  };

  const imaxByKey = new Map<string, number | null>();
  // Limitar concurrencia a 4 a la vez para no martillear Metrum
  const queue = aggsForImax.slice();
  const inflight: Array<Promise<void>> = [];
  while (queue.length > 0 || inflight.length > 0) {
    while (inflight.length < 4 && queue.length > 0) {
      const a = queue.shift()!;
      const k = `${a.casa}|${a.date}`;
      const p = (async () => {
        const candidates = [a.inv_metrum, a.red_metrum].filter(Boolean) as string[];
        let best: number | null = null;
        for (const mid of candidates) {
          const v = await fetchImax(mid, a.date);
          if (v !== null && (best === null || v > best)) best = v;
        }
        imaxByKey.set(k, best);
      })();
      inflight.push(p);
    }
    if (inflight.length > 0) {
      await Promise.race(inflight);
      // Remover los que terminaron
      for (let i = inflight.length - 1; i >= 0; i--) {
        if ((await Promise.race([inflight[i], Promise.resolve('pending')])) !== 'pending') {
          inflight.splice(i, 1);
        }
      }
    }
  }

  // Traer datos de batería de daily_consumption (alimentado por sync/consumption)
  const { data: consumoRows } = await supabaseAdmin
    .from('daily_consumption')
    .select('house_id, dia_consumo, energia_entregada_bateria, estado_salud_bateria, tiempo_entrega_bateria, client_houses(casa)')
    .gte('dia_consumo', fromStr)
    .lte('dia_consumo', toStr);
  const battByKey = new Map<string, { soh: number | null; energy: number | null; time: number | null }>();
  for (const r of consumoRows ?? []) {
    const casa = (r as unknown as { client_houses?: { casa?: string } }).client_houses?.casa;
    if (!casa) continue;
    battByKey.set(`${casa}|${r.dia_consumo}`, {
      soh: r.estado_salud_bateria,
      energy: r.energia_entregada_bateria,
      time: r.tiempo_entrega_bateria,
    });
  }

  // Construir filas para upsert (filtrar a partir de fromStr)
  const payload: Array<Record<string, unknown>> = [];
  for (const a of byKey.values()) {
    if (a.date < fromStr) continue;
    const houseId = houseByCasa.get(a.casa);
    if (!houseId) continue;
    const gen = a.inv_eae;
    const imp = a.red_eai;
    const exc = a.red_eae;
    const dem = (gen ?? 0) + (imp ?? 0) - (exc ?? 0);
    const yieldReal = gen !== null && a.potencia_kw && a.potencia_kw > 0
      ? (gen / 1000) / a.potencia_kw : null;
    const batt = battByKey.get(`${a.casa}|${a.date}`);
    payload.push({
      house_id: houseId,
      casa: a.casa,
      record_date: a.date,
      generacion_wh: gen,
      importacion_wh: imp,
      excedentes_wh: exc,
      demanda_wh: dem,
      gen_dem_pct: gen !== null && dem > 0 ? (gen / dem) * 100 : null,
      exc_gen_pct: exc !== null && gen !== null && gen > 0 ? (exc / gen) * 100 : null,
      imp_dem_pct: imp !== null && dem > 0 ? (imp / dem) * 100 : null,
      yield_real: yieldReal,
      desempeno_pct: yieldReal !== null ? (yieldReal / YIELD_TEORICO_REF) * 100 : null,
      potencia_kw: a.potencia_kw,
      imax_a: imaxByKey.get(`${a.casa}|${a.date}`) ?? null,
      batt_soh_pct: batt?.soh ?? null,
      batt_energy_delivered_wh: batt?.energy ?? null,
      batt_delivery_time_s: batt?.time ?? null,
      updated_at: new Date().toISOString(),
    });
  }

  if (payload.length === 0) return { upserted: 0, range_days: 0 };

  const { error: upsertErr } = await supabaseAdmin
    .from('daily_casa_metrics')
    .upsert(payload, { onConflict: 'house_id,record_date' });
  if (upsertErr) throw upsertErr;

  const dates = new Set(payload.map((p) => p.record_date));
  return { upserted: payload.length, range_days: dates.size };
}
