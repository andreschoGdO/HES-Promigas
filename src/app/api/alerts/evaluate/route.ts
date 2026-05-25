import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

/**
 * GET /api/alerts/evaluate
 * Evalúa todas las reglas activas contra daily_casa_metrics y crea alert_events.
 * Idempotente: el unique constraint en (rule_id, house_id, record_date) evita duplicados.
 */
export async function GET() {
  try {
    const { data: rules, error: rErr } = await supabaseAdmin
      .from('alert_rules')
      .select('*')
      .eq('enabled', true);
    if (rErr) throw rErr;
    if (!rules || rules.length === 0) {
      return NextResponse.json({ success: true, evaluated: 0, fired: 0, message: 'no rules' });
    }

    // Evaluamos sobre los últimos 7 días (suficiente para alertas operativas)
    const cutoff = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
    const { data: metrics, error: mErr } = await supabaseAdmin
      .from('daily_casa_metrics')
      .select('house_id, casa, record_date, generacion_wh, importacion_wh, excedentes_wh, demanda_wh, gen_dem_pct, exc_gen_pct, imp_dem_pct, yield_real, desempeno_pct, potencia_kw, imax_a')
      .gte('record_date', cutoff);
    if (mErr) throw mErr;
    if (!metrics || metrics.length === 0) {
      return NextResponse.json({ success: true, evaluated: 0, fired: 0, message: 'no metrics — corre cron primero' });
    }

    const compare = (val: number, op: string, threshold: number): boolean => {
      switch (op) {
        case 'gt': return val > threshold;
        case 'gte': return val >= threshold;
        case 'lt': return val < threshold;
        case 'lte': return val <= threshold;
        case 'eq': return val === threshold;
        default: return false;
      }
    };

    const opSymbol = (op: string): string => ({ gt: '>', gte: '≥', lt: '<', lte: '≤', eq: '=' }[op] ?? op);

    const events: Array<Record<string, unknown>> = [];
    for (const rule of rules) {
      const filtered = rule.scope === 'all' ? metrics : metrics.filter((m) => m.casa === rule.scope);
      for (const m of filtered) {
        const value = (m as unknown as Record<string, number | null>)[rule.variable];
        if (value === null || value === undefined) continue;
        if (!compare(Number(value), rule.operator, Number(rule.threshold))) continue;
        events.push({
          rule_id: rule.id,
          house_id: m.house_id,
          casa: m.casa,
          record_date: m.record_date,
          variable: rule.variable,
          value: Number(value),
          threshold: Number(rule.threshold),
          operator: rule.operator,
          severity: rule.severity,
          message: `${rule.name}: ${rule.variable} = ${Number(value).toFixed(2)} ${opSymbol(rule.operator)} ${rule.threshold} (${m.casa}, ${m.record_date})`,
        });
      }
    }

    if (events.length === 0) {
      return NextResponse.json({ success: true, evaluated: rules.length, fired: 0 });
    }

    const { error: insErr } = await supabaseAdmin
      .from('alert_events')
      .upsert(events, { onConflict: 'rule_id,house_id,record_date', ignoreDuplicates: false });
    if (insErr) throw insErr;

    return NextResponse.json({ success: true, evaluated: rules.length, fired: events.length });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}
