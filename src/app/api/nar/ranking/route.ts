import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { ALERT_VARIABLES, type AlertCategory } from '@/lib/alert-variables';

/**
 * GET /api/nar/ranking?from=YYYY-MM-DD&to=YYYY-MM-DD[&categories=solar,reactiva]
 *
 * Agrega por casa en el rango dado:
 *   - alertas_high     (eventos high)
 *   - alertas_medium   (eventos medium)
 *   - notificaciones   (eventos low)
 *   - recomendaciones  (reglas distintas con ≥3 disparos en el rango — heurística
 *                       de "recurrencia": ya generan recomendación visual en NAR)
 *
 * Filtro opcional `categories`: lista CSV de AlertCategory (solar, reactiva,
 * demanda, bateria, alarma_inversor, conexion). Si está, solo cuenta eventos
 * cuya variable pertenece a esas categorías.
 *
 * Reactiva CREG ya NO se devuelve aquí — vive como tab independiente en NAR.
 */

const RECOMENDACION_THRESHOLD = 3; // # disparos mínimo para considerar "recomendación"

interface RankRow {
  casa: string;
  house_id: string | null;
  alertas_high: number;
  alertas_medium: number;
  notificaciones: number;
  recomendaciones: number;
}

// Lookup variable → category (compilado al cargar el módulo)
const VAR_TO_CAT = new Map<string, AlertCategory>();
for (const v of ALERT_VARIABLES) VAR_TO_CAT.set(v.key, v.category);

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    const categoriesParam = url.searchParams.get('categories');
    const ruleId = url.searchParams.get('rule_id');

    if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      return NextResponse.json({ error: 'from y to son requeridos (YYYY-MM-DD)' }, { status: 400 });
    }

    const categoriesFilter = categoriesParam
      ? new Set(categoriesParam.split(',').map((s) => s.trim()).filter(Boolean) as AlertCategory[])
      : null;

    // 1. Eventos del rango (filtros opcionales: rule_id, category)
    let q = supabaseAdmin
      .from('alert_events')
      .select('casa, house_id, severity, record_date, variable, rule_id')
      .gte('record_date', from)
      .lte('record_date', to)
      .limit(50000);
    if (ruleId) q = q.eq('rule_id', ruleId);
    const { data: events, error: evErr } = await q;
    if (evErr) return NextResponse.json({ error: evErr.message }, { status: 500 });

    // Filtrar por categoría si aplica (después del fetch, en memoria —
    // la categoría se deriva de la variable, no es una columna indexable).
    const filteredEvents = (events ?? []).filter((ev) => {
      if (!ev.casa) return false;
      if (!categoriesFilter) return true;
      const cat = VAR_TO_CAT.get(ev.variable);
      return cat ? categoriesFilter.has(cat) : false;
    });

    const byCasa = new Map<string, RankRow>();
    // Para contar recomendaciones, necesitamos eventos por (casa, rule_id)
    const ruleCountByCasa = new Map<string, Map<string, number>>();

    for (const ev of filteredEvents) {
      let row = byCasa.get(ev.casa);
      if (!row) {
        row = { casa: ev.casa, house_id: ev.house_id, alertas_high: 0, alertas_medium: 0, notificaciones: 0, recomendaciones: 0 };
        byCasa.set(ev.casa, row);
      }
      if (ev.severity === 'high') row.alertas_high++;
      else if (ev.severity === 'medium') row.alertas_medium++;
      else if (ev.severity === 'low') row.notificaciones++;

      if (!ruleCountByCasa.has(ev.casa)) ruleCountByCasa.set(ev.casa, new Map());
      const ruleMap = ruleCountByCasa.get(ev.casa)!;
      ruleMap.set(ev.rule_id, (ruleMap.get(ev.rule_id) ?? 0) + 1);
    }

    // Recomendaciones por casa: # de reglas distintas con count ≥ threshold
    for (const [casa, ruleMap] of ruleCountByCasa.entries()) {
      const row = byCasa.get(casa);
      if (!row) continue;
      let recos = 0;
      for (const count of ruleMap.values()) {
        if (count >= RECOMENDACION_THRESHOLD) recos++;
      }
      row.recomendaciones = recos;
    }

    const items = Array.from(byCasa.values())
      .sort((a, b) => (b.alertas_high + b.alertas_medium) - (a.alertas_high + a.alertas_medium));

    return NextResponse.json({
      items,
      summary: {
        casas: items.length,
        total_events: filteredEvents.length,
        from, to,
        categories: categoriesFilter ? Array.from(categoriesFilter) : null,
        rule_id: ruleId,
      },
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}
