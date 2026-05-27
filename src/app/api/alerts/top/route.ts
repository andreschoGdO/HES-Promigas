import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

/**
 * GET /api/alerts/top?days=7&severity=high&limit=50
 * Devuelve agregación por (rule + casa) sobre los últimos N días.
 * Útil para detectar alertas recurrentes que probablemente necesitan ajuste de umbral
 * o intervención en sitio.
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const days = Math.min(Math.max(Number(url.searchParams.get('days') ?? 7), 1), 90);
    const severity = url.searchParams.get('severity'); // 'high' | 'medium' | 'low' | null
    const limit = Math.min(Number(url.searchParams.get('limit') ?? 100), 500);

    const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
    let q = supabaseAdmin
      .from('alert_events')
      .select('rule_id, house_id, casa, severity, fired_at, record_date, alert_rules(name, variable)')
      .gte('record_date', since);
    if (severity) q = q.eq('severity', severity);
    const { data, error } = await q.limit(5000);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    interface Row {
      rule_id: string;
      house_id: string | null;
      casa: string;
      rule_name: string;
      variable: string | null;
      severity: 'high' | 'medium' | 'low';
      count: number;
      last_fired_at: string;
      first_fired_at: string;
    }

    interface RawEvent {
      rule_id: string;
      house_id: string | null;
      casa: string;
      severity: 'high' | 'medium' | 'low';
      fired_at: string;
      // Supabase embedded select puede venir como objeto o array; cubrimos ambos
      alert_rules?: { name?: string; variable?: string | null } | Array<{ name?: string; variable?: string | null }> | null;
    }

    const getRule = (r: RawEvent['alert_rules']): { name?: string; variable?: string | null } | null => {
      if (!r) return null;
      if (Array.isArray(r)) return r[0] ?? null;
      return r;
    };

    const agg = new Map<string, Row>();
    for (const ev of (data ?? []) as unknown as RawEvent[]) {
      const rule = getRule(ev.alert_rules);
      const k = `${ev.rule_id}|${ev.casa}`;
      const cur = agg.get(k);
      if (!cur) {
        agg.set(k, {
          rule_id: ev.rule_id, house_id: ev.house_id, casa: ev.casa,
          rule_name: rule?.name ?? '(regla eliminada)',
          variable: rule?.variable ?? null,
          severity: ev.severity, count: 1,
          last_fired_at: ev.fired_at, first_fired_at: ev.fired_at,
        });
      } else {
        cur.count++;
        if (ev.fired_at > cur.last_fired_at) cur.last_fired_at = ev.fired_at;
        if (ev.fired_at < cur.first_fired_at) cur.first_fired_at = ev.fired_at;
      }
    }

    const items = Array.from(agg.values())
      .sort((a, b) => b.count - a.count || (b.last_fired_at > a.last_fired_at ? 1 : -1))
      .slice(0, limit);

    const summary = {
      total_events: data?.length ?? 0,
      unique_combos: items.length,
      days_window: days,
    };
    return NextResponse.json({ items, summary });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}
