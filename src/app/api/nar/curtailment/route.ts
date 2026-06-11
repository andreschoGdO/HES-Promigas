import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { loginToMetrum, getTimeseries } from '@/lib/metrum-api';

/**
 * GET /api/nar/curtailment?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Calcula curtailment DC integrado (kWh) por casa en el rango, sin tabla
 * precomputada — al vuelo desde Metrum + cache de irradiancia.
 *
 * Por cada inversor activo:
 *   1. Trae timeseries del rango con las claves del DC y los gates de
 *      saturación (Livoltek: powerAEgdc_LV; DEYE: powerAPg-BattPower).
 *   2. Calcula P95(DC, hora) y P95(GHI, hora) usando la cache de irradiancia
 *      (si falta, cae a P95 puro sin ajuste de irradiancia).
 *   3. Por cada muestra: si BattSOC ≥ 95 y |ExportGrid_LV| < 100 y de día,
 *      curtailment_t = max(0, envelope_t − DC_t). Integra en kWh (trapezoidal).
 *
 * Suma kWh por casa y devuelve el ranking.
 *
 * Respuesta:
 *   { items: [{ casa, curtailment_kwh, devices_count, days }], summary: {...} }
 */

const SATURATION_SOC = 95;
const EXPORT_GUARD_W = 100;
const COT_OFFSET_MS = 5 * 3600 * 1000;
const DAYLIGHT_START_H = 6;
const DAYLIGHT_END_H = 18;
const CONCURRENCY = 6;

interface DeviceRow {
  id: string;
  metrum_id: string;
  casa: string | null;
  city: string | null;
  marca: string | null;
}

interface CityHourlyGhi {
  // key = `YYYY-MM-DD|H` (hora local COT 0..23) → GHI W/m²
  byTs: Map<string, number>;
  // P95 por hora-del-día
  p95ByHour: Array<number | null>;
}

interface DeviceResult {
  casa: string;
  curtailment_kwh: number;
  device_id: string;
  brand: 'Livoltek' | 'DEYE' | 'unknown';
}

function p95(arr: number[]): number | null {
  if (arr.length === 0) return null;
  if (arr.length === 1) return arr[0];
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * 0.95))];
}

function inferBrand(marca: string | null | undefined): 'Livoltek' | 'DEYE' | 'unknown' {
  if (!marca) return 'unknown';
  const m = marca.toLowerCase();
  if (m.includes('livoltek')) return 'Livoltek';
  if (m.includes('deye') || m.includes('sunsynk')) return 'DEYE';
  return 'unknown';
}

// Convierte timestamp UTC ms → (dateLocal YYYY-MM-DD, hourLocal 0..23) en COT.
function tsToLocal(ts: number): { dateLocal: string; hourLocal: number } {
  const d = new Date(ts - COT_OFFSET_MS);
  return {
    dateLocal: d.toISOString().slice(0, 10),
    hourLocal: d.getUTCHours(),
  };
}

async function processDevice(
  token: string,
  dev: DeviceRow,
  fromTs: number,
  toTs: number,
  ghi: CityHourlyGhi | null,
): Promise<DeviceResult | null> {
  const brand = inferBrand(dev.marca);
  if (brand === 'unknown') return null;

  // Las claves a pedir y cómo calcular DC para cada muestra.
  const dcKey = brand === 'Livoltek' ? 'powerAEgdc_LV' : 'powerAPg';
  const extraKeys = brand === 'DEYE' ? ['BattPower'] : [];
  const gateKeys = ['BattSOC', 'ExportGrid_LV'];
  const keys = [dcKey, ...extraKeys, ...gateKeys];

  let raw: Record<string, Array<{ ts: number; value: string | number }>>;
  try {
    raw = await getTimeseries(token, dev.metrum_id, keys, fromTs, toTs, { limit: 50000 });
  } catch {
    return null;
  }

  // Unificar muestras por timestamp (Metrum responde con mismo ts entre claves
  // cuando se reportan juntas, pero por si acaso normalizamos por minuto).
  type Sample = {
    dc: number | null;
    battSoc: number | null;
    exportGrid: number | null;
    apg: number | null;
    battPower: number | null;
  };
  const samples = new Map<number, Sample>();
  const ensure = (ts: number): Sample => {
    let s = samples.get(ts);
    if (!s) {
      s = { dc: null, battSoc: null, exportGrid: null, apg: null, battPower: null };
      samples.set(ts, s);
    }
    return s;
  };
  for (const k of keys) {
    for (const point of raw[k] ?? []) {
      const v = typeof point.value === 'string' ? parseFloat(point.value) : Number(point.value);
      if (!Number.isFinite(v)) continue;
      const s = ensure(point.ts);
      if (k === 'BattSOC') s.battSoc = v;
      else if (k === 'ExportGrid_LV') s.exportGrid = v;
      else if (k === 'powerAEgdc_LV') s.dc = v;
      else if (k === 'powerAPg') s.apg = v;
      else if (k === 'BattPower') s.battPower = v;
    }
  }

  // Para DEYE el DC es derivado: powerAPg − BattPower.
  if (brand === 'DEYE') {
    for (const s of samples.values()) {
      if (s.apg !== null && s.battPower !== null) s.dc = s.apg - s.battPower;
    }
  }

  // P95(DC) por hora-del-día sobre las muestras del rango.
  const byHourDc: number[][] = Array.from({ length: 24 }, () => []);
  for (const [ts, s] of samples.entries()) {
    if (s.dc === null) continue;
    const { hourLocal } = tsToLocal(ts);
    byHourDc[hourLocal].push(s.dc);
  }
  const p95Dc = byHourDc.map(p95);

  // Integrar curtailment trapezoidal por intervalos sucesivos.
  // Solo cuenta cuando se cumplen las 3 condiciones de saturación.
  const sortedTs = Array.from(samples.keys()).sort((a, b) => a - b);
  let curtailmentJ = 0;
  for (let i = 0; i < sortedTs.length; i++) {
    const ts = sortedTs[i];
    const s = samples.get(ts)!;
    if (s.dc === null || s.battSoc === null || s.exportGrid === null) continue;

    const { dateLocal, hourLocal } = tsToLocal(ts);
    const isDaylight = hourLocal >= DAYLIGHT_START_H && hourLocal < DAYLIGHT_END_H;
    const saturated = s.battSoc >= SATURATION_SOC && Math.abs(s.exportGrid) < EXPORT_GUARD_W && isDaylight;
    if (!saturated) continue;

    const baseDc = p95Dc[hourLocal];
    if (baseDc === null || baseDc === undefined) continue;

    // Envelope ajustado por irradiancia si está disponible.
    let envelope = baseDc;
    if (ghi) {
      const ghiNow = ghi.byTs.get(`${dateLocal}|${hourLocal}`);
      const ghiBase = ghi.p95ByHour[hourLocal];
      if (ghiNow !== undefined && ghiBase !== null && ghiBase !== undefined && ghiBase > 0) {
        envelope = baseDc * (ghiNow / ghiBase);
      }
    }

    const curtailmentW = Math.max(0, envelope - s.dc);
    if (curtailmentW <= 0) continue;

    // Integrar usando el delta hasta la siguiente muestra (cap a 15 min para
    // no inflar el área si hay huecos en el reporte).
    const nextTs = sortedTs[i + 1] ?? ts;
    const dtMs = Math.min(nextTs - ts, 15 * 60 * 1000);
    if (dtMs <= 0) continue;
    curtailmentJ += curtailmentW * (dtMs / 1000); // W·s = J
  }

  return {
    casa: dev.casa ?? 'sin casa',
    curtailment_kwh: curtailmentJ / 3_600_000, // J → kWh
    device_id: dev.id,
    brand,
  };
}

async function loadCityGhi(
  cities: string[],
  from: string,
  to: string,
): Promise<Map<string, CityHourlyGhi>> {
  const out = new Map<string, CityHourlyGhi>();
  if (cities.length === 0) return out;
  const { data } = await supabaseAdmin
    .from('solar_irradiance_cache')
    .select('city, date, hour, ghi_w_m2')
    .in('city', cities)
    .gte('date', from)
    .lte('date', to);
  for (const row of data ?? []) {
    let g = out.get(row.city);
    if (!g) { g = { byTs: new Map(), p95ByHour: Array(24).fill(null) }; out.set(row.city, g); }
    g.byTs.set(`${row.date}|${row.hour}`, Number(row.ghi_w_m2));
  }
  // Calcular P95 por hora-del-día para cada ciudad
  for (const g of out.values()) {
    const byHour: number[][] = Array.from({ length: 24 }, () => []);
    for (const [key, val] of g.byTs.entries()) {
      const h = parseInt(key.split('|')[1], 10);
      if (Number.isFinite(h)) byHour[h].push(val);
    }
    g.p95ByHour = byHour.map(p95);
  }
  return out;
}

async function runLimited<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  let cursor = 0;
  const workers: Promise<void>[] = [];
  const worker = async () => {
    while (cursor < items.length) {
      const idx = cursor++;
      results[idx] = await fn(items[idx]);
    }
  };
  for (let i = 0; i < Math.min(limit, items.length); i++) workers.push(worker());
  await Promise.all(workers);
  return results;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      return NextResponse.json({ error: 'from y to requeridos (YYYY-MM-DD)' }, { status: 400 });
    }

    const fromTs = new Date(from + 'T00:00:00-05:00').getTime();
    const toTs = new Date(to + 'T23:59:59-05:00').getTime();

    // Cap defensivo: máximo 31 días para no explotar el timeout.
    const daySpan = (toTs - fromTs) / 86400000;
    if (daySpan > 31) {
      return NextResponse.json({ error: 'Rango máximo 31 días' }, { status: 400 });
    }

    // 1. Devices inversor activos con casa+marca+metrum_id.
    const { data: devices, error: devErr } = await supabaseAdmin
      .from('devices')
      .select('id, metrum_id, casa, city, marca, type, is_active')
      .eq('is_active', true)
      .not('metrum_id', 'is', null)
      .not('casa', 'is', null)
      .ilike('type', '%nversor%')
      .limit(200);
    if (devErr) return NextResponse.json({ error: devErr.message }, { status: 500 });

    const valid: DeviceRow[] = (devices ?? [])
      .filter((d) => inferBrand(d.marca) !== 'unknown')
      .map((d) => ({ id: d.id, metrum_id: d.metrum_id, casa: d.casa, city: d.city, marca: d.marca }));

    if (valid.length === 0) {
      return NextResponse.json({ items: [], summary: { casas: 0, devices: 0, from, to } });
    }

    // 2. Irradiancia por ciudad de la cache.
    const cities = Array.from(new Set(valid.map((d) => d.city).filter((c): c is string => !!c)));
    const cityGhi = await loadCityGhi(cities, from, to);

    // 3. Token Metrum (un login para todo el batch).
    const token = await loginToMetrum();

    // 4. Procesar devices con concurrencia limitada.
    const results = await runLimited(valid, CONCURRENCY, async (dev) =>
      processDevice(token, dev, fromTs, toTs, dev.city ? cityGhi.get(dev.city) ?? null : null),
    );

    // 5. Agregar por casa.
    const byCasa = new Map<string, { curtailment_kwh: number; devices_count: number }>();
    for (const r of results) {
      if (!r) continue;
      let agg = byCasa.get(r.casa);
      if (!agg) { agg = { curtailment_kwh: 0, devices_count: 0 }; byCasa.set(r.casa, agg); }
      agg.curtailment_kwh += r.curtailment_kwh;
      agg.devices_count++;
    }

    const items = Array.from(byCasa.entries())
      .map(([casa, v]) => ({ casa, curtailment_kwh: Math.round(v.curtailment_kwh * 100) / 100, devices_count: v.devices_count }))
      .sort((a, b) => b.curtailment_kwh - a.curtailment_kwh);

    return NextResponse.json({
      items,
      summary: {
        casas: items.length,
        devices: valid.length,
        devices_with_data: results.filter(Boolean).length,
        from, to,
      },
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}
