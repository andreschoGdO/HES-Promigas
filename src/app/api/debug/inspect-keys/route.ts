import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { loginToMetrum, getTimeseriesKeys, getTimeseries } from '@/lib/metrum-api';

/**
 * GET /api/debug/inspect-keys
 *   → Sin parámetros: lista cuántos devices hay por (type, brand) — diagnóstico.
 *
 * GET /api/debug/inspect-keys?type=X&brand=Y&sample=N
 *   → Toma una muestra y para cada device dump TODOS los keys de timeseries de Metrum
 *     + último valor de cada uno. Útil para saber qué expone Metrum realmente.
 *
 * Params:
 *   type   — string libre, match contra devices.type (case-insensitive, partial OK)
 *   brand  — string libre, match contra devices.marca (case-insensitive, partial OK)
 *   sample — 1-10 (default 3)
 *   name   — filtro adicional por nombre del device (partial match)
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const type = url.searchParams.get('type');
  const brand = url.searchParams.get('brand');
  const name = url.searchParams.get('name');
  const sample = Math.min(Math.max(Number(url.searchParams.get('sample') ?? 3), 1), 10);

  // Si no pasaron filtros, devolvemos el inventario de la BD
  if (!type && !brand && !name) {
    const { data, error } = await supabaseAdmin
      .from('devices')
      .select('type, marca, modelo, is_active')
      .limit(2000);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const byTypeBrand = new Map<string, { type: string | null; marca: string | null; total: number; active: number }>();
    for (const d of data ?? []) {
      const k = `${d.type ?? '(null)'}|${d.marca ?? '(null)'}`;
      const e = byTypeBrand.get(k) ?? { type: d.type, marca: d.marca, total: 0, active: 0 };
      e.total++;
      if (d.is_active) e.active++;
      byTypeBrand.set(k, e);
    }

    return NextResponse.json({
      hint: 'Usa ?type=X&brand=Y&sample=3 con valores de esta tabla para inspeccionar keys',
      summary: Array.from(byTypeBrand.values()).sort((a, b) => b.total - a.total),
      total_devices: (data ?? []).length,
    });
  }

  try {
    // Buscar con ilike para que sea case-insensitive y permita partial match
    let q = supabaseAdmin
      .from('devices')
      .select('id, metrum_id, name, type, marca, modelo, casa, is_active');
    if (type)  q = q.ilike('type', `%${type}%`);
    if (brand) q = q.ilike('marca', `%${brand}%`);
    if (name)  q = q.ilike('name', `%${name}%`);
    // NO filtramos por is_active: muchos devices están marcados is_active=false en la BD
    // pero igual exponen keys en Metrum (la flag puede estar desactualizada).
    q = q.limit(sample);
    const { data: devices, error } = await q;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!devices || devices.length === 0) {
      // Fallback: traer todos los activos y dejar que el caller filtre, mostrando qué hay
      const { data: all } = await supabaseAdmin.from('devices').select('type, marca').eq('is_active', true);
      const types = Array.from(new Set((all ?? []).map((d) => d.type ?? '(null)')));
      const brands = Array.from(new Set((all ?? []).map((d) => d.marca ?? '(null)')));
      return NextResponse.json({
        error: `No se encontraron devices que matchen filtros`,
        filters_tried: { type, brand, name },
        available_types_in_db: types,
        available_brands_in_db: brands,
      }, { status: 404 });
    }

    // Fetch de keys + último valor por device
    const token = await loginToMetrum();
    const now = Date.now();
    const dayAgo = now - 24 * 3600 * 1000;

    const perDevice = [] as Array<Record<string, unknown>>;
    const allKeysSeen = new Set<string>();

    for (const d of devices) {
      try {
        const keys = await getTimeseriesKeys(token, d.metrum_id);
        keys.forEach((k) => allKeysSeen.add(k));

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
          type: d.type,
          marca: d.marca,
          modelo: d.modelo,
          keys_count: keys.length,
          keys: keyDetails,
        });
      } catch (e) {
        perDevice.push({
          name: d.name,
          metrum_id: d.metrum_id,
          error: e instanceof Error ? e.message : 'Error',
        });
      }
    }

    return NextResponse.json({
      filters: { type, brand, name, sample },
      devices_inspected: perDevice.length,
      unique_keys_across_sample: Array.from(allKeysSeen).sort(),
      devices: perDevice,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}
