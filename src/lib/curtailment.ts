// Lógica común para calcular curtailment DC por casa, día por día,
// desde Metrum + cache de irradiancia. Usada por:
//   - /api/cron/compute-curtailment (persiste en daily_curtailment_by_house)
//   - /api/nar/curtailment (en su modo fallback cuando la tabla está vacía)
//
// El integrador hace P95(DC, hora) sobre TODO el rango fetched (baseline
// estadístico amplio) y luego acumula curtailment_kwh por día-casa.

import { supabaseAdmin } from '@/lib/supabase-admin';
import { loginToMetrum, getTimeseries } from '@/lib/metrum-api';

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
  byTs: Map<string, number>;
  p95ByHour: Array<number | null>;
}

export interface CurtailmentDayRow {
  casa: string;
  house_id: string | null;
  record_date: string; // YYYY-MM-DD local COT
  curtailment_kwh: number;
  devices_count: number;
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

function tsToLocal(ts: number): { dateLocal: string; hourLocal: number } {
  const d = new Date(ts - COT_OFFSET_MS);
  return {
    dateLocal: d.toISOString().slice(0, 10),
    hourLocal: d.getUTCHours(),
  };
}

interface DeviceDailyResult {
  casa: string;
  device_id: string;
  byDay: Map<string, number>; // record_date local → kWh
}

async function processDevice(
  token: string,
  dev: DeviceRow,
  fromTs: number,
  toTs: number,
  ghi: CityHourlyGhi | null,
): Promise<DeviceDailyResult | null> {
  const brand = inferBrand(dev.marca);
  if (brand === 'unknown') return null;

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

  if (brand === 'DEYE') {
    for (const s of samples.values()) {
      if (s.apg !== null && s.battPower !== null) s.dc = s.apg - s.battPower;
    }
  }

  // P95 DC por hora del día usando TODO el rango fetched
  const byHourDc: number[][] = Array.from({ length: 24 }, () => []);
  for (const [ts, s] of samples.entries()) {
    if (s.dc === null) continue;
    const { hourLocal } = tsToLocal(ts);
    byHourDc[hourLocal].push(s.dc);
  }
  const p95Dc = byHourDc.map(p95);

  // Acumular curtailment por día local
  const byDayJ = new Map<string, number>();
  const sortedTs = Array.from(samples.keys()).sort((a, b) => a - b);
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
    const nextTs = sortedTs[i + 1] ?? ts;
    const dtMs = Math.min(nextTs - ts, 15 * 60 * 1000);
    if (dtMs <= 0) continue;
    const j = curtailmentW * (dtMs / 1000);
    byDayJ.set(dateLocal, (byDayJ.get(dateLocal) ?? 0) + j);
  }

  // J → kWh por día
  const byDay = new Map<string, number>();
  for (const [day, joules] of byDayJ.entries()) byDay.set(day, joules / 3_600_000);

  return { casa: dev.casa ?? 'sin casa', device_id: dev.id, byDay };
}

async function loadCityGhi(cities: string[], from: string, to: string): Promise<Map<string, CityHourlyGhi>> {
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

/**
 * Computa curtailment integrado por día-casa para el rango [from, to].
 * Devuelve filas listas para upsert en daily_curtailment_by_house.
 * Suma los kWh de todos los inversores activos de la casa para cada día.
 */
export async function computeCurtailmentByDay(from: string, to: string): Promise<CurtailmentDayRow[]> {
  const fromTs = new Date(from + 'T00:00:00-05:00').getTime();
  const toTs = new Date(to + 'T23:59:59-05:00').getTime();

  // Filtro: el único requisito real es tener marca solar conocida (Livoltek/DEYE)
  // + metrum_id + casa. NO filtramos por is_active: en producción muchos inversores
  // están marcados como is_active=false pero siguen reportando datos a Metrum
  // (campo legacy). La marca como filtro es suficiente para descartar medidores
  // de red o gateways.
  const { data: devices } = await supabaseAdmin
    .from('devices')
    .select('id, metrum_id, casa, city, marca, type')
    .not('metrum_id', 'is', null)
    .not('casa', 'is', null)
    .not('marca', 'is', null)
    .limit(500);

  const valid: DeviceRow[] = (devices ?? [])
    .filter((d) => inferBrand(d.marca) !== 'unknown')
    .map((d) => ({ id: d.id, metrum_id: d.metrum_id, casa: d.casa, city: d.city, marca: d.marca }));

  if (valid.length === 0) return [];

  const cities = Array.from(new Set(valid.map((d) => d.city).filter((c): c is string => !!c)));
  const cityGhi = await loadCityGhi(cities, from, to);
  const token = await loginToMetrum();

  const results = await runLimited(valid, CONCURRENCY, async (dev) =>
    processDevice(token, dev, fromTs, toTs, dev.city ? cityGhi.get(dev.city) ?? null : null),
  );

  // Lookup casa → house_id (para guardar la FK opcional)
  const casas = Array.from(new Set(valid.map((d) => d.casa).filter((c): c is string => !!c)));
  const houseIdByCasa = new Map<string, string>();
  if (casas.length > 0) {
    const { data: houses } = await supabaseAdmin
      .from('client_houses')
      .select('id, casa')
      .in('casa', casas);
    for (const h of houses ?? []) {
      if (h.casa) houseIdByCasa.set(h.casa, h.id);
    }
  }

  // Agregar por (casa, día): suma kWh y cuenta de devices que aportaron a ese día
  type Cell = { kwh: number; devices: Set<string> };
  const grid = new Map<string, Cell>();
  const key = (casa: string, date: string) => `${casa}|${date}`;
  for (const r of results) {
    if (!r) continue;
    for (const [day, kwh] of r.byDay.entries()) {
      let cell = grid.get(key(r.casa, day));
      if (!cell) { cell = { kwh: 0, devices: new Set() }; grid.set(key(r.casa, day), cell); }
      cell.kwh += kwh;
      cell.devices.add(r.device_id);
    }
  }

  const out: CurtailmentDayRow[] = [];
  for (const [k, cell] of grid.entries()) {
    const [casa, date] = k.split('|');
    out.push({
      casa,
      house_id: houseIdByCasa.get(casa) ?? null,
      record_date: date,
      curtailment_kwh: Math.round(cell.kwh * 1000) / 1000,
      devices_count: cell.devices.size,
    });
  }
  return out;
}

/**
 * Lee del cache de la BD el curtailment integrado para el rango [from, to],
 * agregado por casa (suma kWh de todos los días).
 */
export async function readCurtailmentFromDb(from: string, to: string): Promise<Array<{ casa: string; curtailment_kwh: number; devices_count: number; days: number }>> {
  const { data, error } = await supabaseAdmin
    .from('daily_curtailment_by_house')
    .select('casa, curtailment_kwh, devices_count, record_date')
    .gte('record_date', from)
    .lte('record_date', to);
  if (error) throw new Error(error.message);

  const byCasa = new Map<string, { kwh: number; devices_max: number; days: number }>();
  for (const r of data ?? []) {
    let agg = byCasa.get(r.casa);
    if (!agg) { agg = { kwh: 0, devices_max: 0, days: 0 }; byCasa.set(r.casa, agg); }
    agg.kwh += Number(r.curtailment_kwh);
    agg.devices_max = Math.max(agg.devices_max, Number(r.devices_count));
    agg.days++;
  }
  return Array.from(byCasa.entries())
    .map(([casa, v]) => ({
      casa,
      curtailment_kwh: Math.round(v.kwh * 100) / 100,
      devices_count: v.devices_max,
      days: v.days,
    }))
    .sort((a, b) => b.curtailment_kwh - a.curtailment_kwh);
}
