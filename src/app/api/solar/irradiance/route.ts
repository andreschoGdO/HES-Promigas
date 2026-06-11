import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

/**
 * GET /api/solar/irradiance?city=Cali&from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Devuelve GHI (Global Horizontal Irradiance, W/m²) hora a hora para la
 * ciudad en el rango dado. Cache first: lee de solar_irradiance_cache, y
 * solo llama a Open-Meteo para las fechas/horas faltantes.
 *
 * Response:
 *   {
 *     city: 'Cali',
 *     data: [
 *       { date: '2026-06-10', hour: 12, ghi_w_m2: 850 },
 *       ...
 *     ]
 *   }
 */

// Centroides de las ciudades donde opera GdO. Agregar conforme se necesiten.
const CITY_CENTROIDS: Record<string, [number, number]> = {
  'Cali':         [3.4516, -76.5320],
  'Bogotá':       [4.7110, -74.0721],
  'Medellín':     [6.2442, -75.5812],
  'Barranquilla': [10.9685, -74.7813],
  'Cartagena':    [10.3910, -75.4794],
  'Bucaramanga':  [7.1193, -73.1227],
  'Pereira':      [4.8133, -75.6961],
  'Manizales':    [5.0703, -75.5138],
  'Ibagué':       [4.4389, -75.2322],
  'Cúcuta':       [7.8939, -72.5078],
};

// Normaliza: 'CALI' o 'cali' → 'Cali'
const normalizeCity = (city: string): string | null => {
  const trimmed = city.trim();
  for (const known of Object.keys(CITY_CENTROIDS)) {
    if (known.toLowerCase() === trimmed.toLowerCase()) return known;
  }
  return null;
};

export async function GET(request: Request) {
  const url = new URL(request.url);
  const cityRaw = url.searchParams.get('city');
  const fromStr = url.searchParams.get('from');
  const toStr = url.searchParams.get('to');

  if (!cityRaw || !fromStr || !toStr) {
    return NextResponse.json({ error: 'city, from y to son requeridos (YYYY-MM-DD)' }, { status: 400 });
  }
  const city = normalizeCity(cityRaw);
  if (!city) {
    return NextResponse.json({ error: `Ciudad '${cityRaw}' no soportada. Soportadas: ${Object.keys(CITY_CENTROIDS).join(', ')}` }, { status: 400 });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromStr) || !/^\d{4}-\d{2}-\d{2}$/.test(toStr)) {
    return NextResponse.json({ error: 'from y to deben ser YYYY-MM-DD' }, { status: 400 });
  }

  // 1. Leer todo lo cacheado para ese rango
  const { data: cached } = await supabaseAdmin
    .from('solar_irradiance_cache')
    .select('date, hour, ghi_w_m2')
    .eq('city', city)
    .gte('date', fromStr)
    .lte('date', toStr);

  const cachedSet = new Set<string>();
  const result: Array<{ date: string; hour: number; ghi_w_m2: number }> = [];
  for (const r of cached ?? []) {
    cachedSet.add(`${r.date}|${r.hour}`);
    result.push({ date: r.date, hour: r.hour, ghi_w_m2: Number(r.ghi_w_m2) });
  }

  // 2. Detectar fechas faltantes
  const fromDate = new Date(fromStr + 'T00:00:00Z');
  const toDate = new Date(toStr + 'T00:00:00Z');
  const missingDates: string[] = [];
  for (let d = new Date(fromDate); d <= toDate; d.setUTCDate(d.getUTCDate() + 1)) {
    const dStr = d.toISOString().slice(0, 10);
    // Si faltan ≥6 horas de ese día, lo pedimos completo
    let presentHours = 0;
    for (let h = 0; h < 24; h++) {
      if (cachedSet.has(`${dStr}|${h}`)) presentHours++;
    }
    if (presentHours < 18) missingDates.push(dStr);
  }

  // 3. Para los faltantes, llamar a Open-Meteo y cachear
  if (missingDates.length > 0) {
    const [lat, lng] = CITY_CENTROIDS[city];
    // Open-Meteo Archive API: histórico hasta hoy. Si necesitan futuro, otra
    // URL — para envelope siempre miramos pasado, así que archive sirve.
    // Doc: https://open-meteo.com/en/docs/historical-weather-api
    const startStr = missingDates[0];
    const endStr = missingDates[missingDates.length - 1];

    try {
      const apiUrl = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lng}&start_date=${startStr}&end_date=${endStr}&hourly=shortwave_radiation&timezone=America%2FBogota`;
      const res = await fetch(apiUrl);
      if (!res.ok) {
        console.error('Open-Meteo error:', res.status, await res.text());
        // Si falla el API, devolvemos solo lo cacheado
      } else {
        const j = await res.json();
        type OmResponse = { hourly?: { time?: string[]; shortwave_radiation?: number[] } };
        const om = j as OmResponse;
        const times = om.hourly?.time ?? [];
        const ghis = om.hourly?.shortwave_radiation ?? [];

        const newRows: Array<{ city: string; date: string; hour: number; ghi_w_m2: number }> = [];
        for (let i = 0; i < times.length; i++) {
          const t = times[i];
          const ghi = ghis[i];
          if (ghi === null || ghi === undefined) continue;
          // t formato: "2026-06-10T12:00"
          const [datePart, hourPart] = t.split('T');
          const hour = parseInt(hourPart.split(':')[0], 10);
          if (!Number.isFinite(hour)) continue;
          // Skip si ya está en cache
          if (cachedSet.has(`${datePart}|${hour}`)) continue;
          newRows.push({ city, date: datePart, hour, ghi_w_m2: Number(ghi) });
        }
        if (newRows.length > 0) {
          // Upsert ignorando duplicados (la unique constraint los descarta)
          await supabaseAdmin
            .from('solar_irradiance_cache')
            .upsert(newRows, { onConflict: 'city,date,hour', ignoreDuplicates: true });
          for (const r of newRows) {
            result.push({ date: r.date, hour: r.hour, ghi_w_m2: r.ghi_w_m2 });
          }
        }
      }
    } catch (e) {
      console.error('Open-Meteo fetch failed:', e);
    }
  }

  // Ordenar por fecha + hora
  result.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    return a.hour - b.hour;
  });

  return NextResponse.json({ city, data: result, count: result.length });
}
