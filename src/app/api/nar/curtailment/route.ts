import { NextResponse } from 'next/server';
import { readCurtailmentFromDb, readCurtailmentDailyFromDb, computeCurtailmentByDay } from '@/lib/curtailment';
import { supabaseAdmin } from '@/lib/supabase-admin';

/**
 * GET /api/nar/curtailment?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Devuelve curtailment integrado por casa en el rango.
 *
 * Estrategia: lee de daily_curtailment_by_house (rápido, segundos).
 *
 * Si la tabla está vacía O cubre menos del 50% del rango pedido, cae al
 * cómputo al vuelo (Metrum + irradiancia) — lento pero garantiza respuesta
 * incluso si el cron nunca corrió. El primer hit calcula + persiste; los
 * siguientes leen del cache.
 */
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    const force = url.searchParams.get('force') === '1';
    const detailed = url.searchParams.get('detailed') === '1';
    if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      return NextResponse.json({ error: 'from y to requeridos (YYYY-MM-DD)' }, { status: 400 });
    }

    const fromTs = new Date(from + 'T00:00:00Z').getTime();
    const toTs = new Date(to + 'T00:00:00Z').getTime();
    const expectedDays = Math.floor((toTs - fromTs) / 86400000) + 1;
    if (expectedDays > 92) {
      return NextResponse.json({ error: 'Rango máximo 92 días' }, { status: 400 });
    }

    // 1. Intento desde el cache de BD (rápido).
    let items = await readCurtailmentFromDb(from, to);
    let source: 'db' | 'live' = 'db';

    // ¿Cobertura suficiente? Si menos del 50% de los días esperados existen
    // en la tabla, computamos al vuelo y persistimos.
    const { count } = await supabaseAdmin
      .from('daily_curtailment_by_house')
      .select('id', { count: 'exact', head: true })
      .gte('record_date', from)
      .lte('record_date', to);
    const distinctDaysApprox = (count ?? 0) > 0 ? Math.min(expectedDays, Math.ceil((count ?? 0) / Math.max(items.length, 1))) : 0;
    const coverageRatio = expectedDays > 0 ? distinctDaysApprox / expectedDays : 0;

    if (force || items.length === 0 || coverageRatio < 0.5) {
      const rows = await computeCurtailmentByDay(from, to);

      // Persistir lo computado para futuras llamadas
      if (rows.length > 0) {
        const BATCH = 200;
        for (let i = 0; i < rows.length; i += BATCH) {
          const chunk = rows.slice(i, i + BATCH);
          await supabaseAdmin
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
        }
      }

      items = await readCurtailmentFromDb(from, to);
      source = 'live';
    }

    // Modo detailed: además del agregado por casa, devolvemos el desglose
    // diario crudo. El cliente lo agrupa por bucket (semana/mes) según el
    // rango para construir un stacked bar cronológico.
    const daily = detailed ? await readCurtailmentDailyFromDb(from, to) : undefined;

    return NextResponse.json({
      items,
      daily,
      summary: {
        casas: items.length,
        from, to,
        source,
        expected_days: expectedDays,
      },
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}
