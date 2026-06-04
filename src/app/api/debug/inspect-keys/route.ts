import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { loginToMetrum, getTimeseriesKeys, getTimeseries } from '@/lib/metrum-api';

/**
 * GET /api/debug/inspect-keys?type=inverter&brand=LIVOLTEK
 *
 * Para diagnosticar qué keys expone Metrum a un tipo/marca específica de
 * dispositivo. Toma una muestra (hasta `sample` devices) y para cada uno:
 *   - Lista TODOS los timeseries keys disponibles
 *   - Lee el último valor de cada key (último timestamp en las últimas 24h)
 *   - Agrupa los keys únicos a través de la muestra para tener el set total
 *
 * Útil para responder "¿el inversor expone Ppv1?" sin tener que abrir Granular
 * dispositivo por dispositivo.
 *
 * Query params:
 *   type   — 'inverter' | 'meter' | 'pulsar' | 'red' | 'solar' (default: inverter)
 *   brand  — opcional, filtra por marca (LIVOLTEK / DEYE)
 *   sample — cuántos devices muestrear (default 3, max 10)
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const type = (url.searchParams.get('type') ?? 'inverter').toLowerCase();
  const brand = url.searchParams.get('brand')?.toUpperCase();
  const sample = Math.min(Math.max(Number(url.searchParams.get('sample') ?? 3), 1), 10);

  try {
    // 1. Sacar devices de Supabase según filtros
    let q = supabaseAdmin.from('devices').select('id, metrum_id, name, type, marca, modelo, casa, is_active').eq('type', type);
    if (brand) q = q.eq('marca', brand);
    q = q.eq('is_active', true).limit(sample);
    const { data: devices, error } = await q;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!devices || devices.length === 0) {
      return NextResponse.json({ error: `No se encontraron devices type=${type}${brand ? ' brand=' + brand : ''}` }, { status: 404 });
    }

    // 2. Para cada device, fetch de keys + último valor
    const token = await loginToMetrum();
    const now = Date.now();
    const dayAgo = now - 24 * 3600 * 1000;

    const perDevice: Array<{
      name: string;
      metrum_id: string;
      casa: string | null;
      marca: string | null;
      modelo: string | null;
      keys_count: number;
      keys: Array<{ key: string; lastValue: string | number | null; lastTs: number | null }>;
      error?: string;
    }> = [];

    const allKeysSeen = new Set<string>();

    for (const d of devices) {
      try {
        const keys = await getTimeseriesKeys(token, d.metrum_id);
        keys.forEach((k) => allKeysSeen.add(k));

        // Tomar último valor de cada key (latest en 24h)
        const tsData = keys.length > 0
          ? await getTimeseries(token, d.metrum_id, keys, dayAgo, now, { agg: 'NONE', limit: 1 })
          : {};

        const keyDetails = keys.map((k) => {
          const points = (tsData as Record<string, Array<{ ts: number; value: string }>>)[k];
          const last = points && points.length > 0 ? points[points.length - 1] : null;
          return {
            key: k,
            lastValue: last ? last.value : null,
            lastTs: last ? last.ts : null,
          };
        }).sort((a, b) => a.key.localeCompare(b.key));

        perDevice.push({
          name: d.name,
          metrum_id: d.metrum_id,
          casa: d.casa,
          marca: d.marca,
          modelo: d.modelo,
          keys_count: keys.length,
          keys: keyDetails,
        });
      } catch (e) {
        perDevice.push({
          name: d.name,
          metrum_id: d.metrum_id,
          casa: d.casa,
          marca: d.marca,
          modelo: d.modelo,
          keys_count: 0,
          keys: [],
          error: e instanceof Error ? e.message : 'Error',
        });
      }
    }

    return NextResponse.json({
      filters: { type, brand: brand ?? null, sample },
      devices_inspected: perDevice.length,
      unique_keys_across_sample: Array.from(allKeysSeen).sort(),
      devices: perDevice,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}
