import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

/**
 * GET /api/alerts/evaluate
 * Evalúa todas las reglas activas y crea alert_events.
 *
 * Variables soportadas:
 *   1. Diarias (de daily_casa_metrics): generacion_wh, demanda_wh, yield_real, desempeno_pct, etc.
 *   2. Mensuales reactiva (month-to-date, calculadas de daily_energy_closures):
 *      - eri_ratio_pct_mtd  (Σ ERI / Σ EA mes-en-curso, en %)
 *      - excedente_kvarh_mtd (max(0, ERI − 0.5·EA) / 1000)
 *      - cos_phi_mtd        (Σ EA / √(Σ EA² + Σ ERI²))
 *      - penalizacion_cop_mtd (excedente_kvarh × tarifa por defecto 130)
 *
 * Idempotente: el unique constraint (rule_id, house_id, record_date) evita duplicados.
 */

const REACTIVE_VARS = new Set([
  'eri_ratio_pct_mtd',
  'excedente_kvarh_mtd',
  'cos_phi_mtd',
  'penalizacion_cop_mtd',
]);

const TARIFA_DEFAULT_COP = 130; // COP/kvarh — referencia comercializadores Colombia
const UMBRAL_CREG = 0.5;        // 50% ERI/EA — fp 0.9

const opSymbol = (op: string): string => ({ gt: '>', gte: '≥', lt: '<', lte: '≤', eq: '=' }[op] ?? op);

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

interface RawClosure {
  device_id: string;
  record_date: string;
  energy_active_imported_wh: number | null;
  energy_reactive_imported_varh: number | null;
  devices: { type: string; casa: string | null } | null;
}

interface MonthAgg {
  house_id: string;
  casa: string;
  month: string;          // YYYY-MM
  ea_wh: number;
  eri_varh: number;
}

/** Calcula métricas reactivas month-to-date por casa para el mes actual */
async function computeReactiveMTD(): Promise<Array<{
  house_id: string;
  casa: string;
  record_date: string;
  eri_ratio_pct_mtd: number | null;
  excedente_kvarh_mtd: number | null;
  cos_phi_mtd: number | null;
  penalizacion_cop_mtd: number | null;
}>> {
  const now = new Date();
  const currentMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const monthStr = currentMonthStart.toISOString().slice(0, 10);
  // baseline = un día antes para deltas
  const baselineDate = new Date(currentMonthStart.getTime() - 86400000).toISOString().slice(0, 10);

  // Casa → house_id
  const { data: houses } = await supabaseAdmin.from('client_houses').select('id, casa');
  const houseByCasa = new Map((houses ?? []).map((h: { id: string; casa: string }) => [h.casa, h.id]));

  // Closures del mes actual + el día previo (para baseline)
  const { data } = await supabaseAdmin
    .from('daily_energy_closures')
    .select('device_id, record_date, energy_active_imported_wh, energy_reactive_imported_varh, devices!inner(type, casa)')
    .eq('devices.type', 'red')
    .gte('record_date', baselineDate)
    .order('record_date', { ascending: true })
    .limit(5000);

  const closures = (data ?? []) as unknown as RawClosure[];

  // Agrupar por device, calcular deltas, acumular por casa (mes actual)
  const byDevice = new Map<string, RawClosure[]>();
  for (const c of closures) {
    if (!c.devices?.casa) continue;
    if (!byDevice.has(c.device_id)) byDevice.set(c.device_id, []);
    byDevice.get(c.device_id)!.push(c);
  }
  for (const arr of byDevice.values()) arr.sort((a, b) => a.record_date.localeCompare(b.record_date));

  const aggByCasa = new Map<string, MonthAgg>();
  for (const rows of byDevice.values()) {
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const prev = rows[i - 1];
      if (r.record_date < monthStr) continue; // solo el mes en curso
      const casa = r.devices?.casa;
      if (!casa) continue;
      const houseId = houseByCasa.get(casa);
      if (!houseId) continue;
      const dEA = (r.energy_active_imported_wh ?? 0) - (prev.energy_active_imported_wh ?? 0);
      const dERI = (r.energy_reactive_imported_varh ?? 0) - (prev.energy_reactive_imported_varh ?? 0);
      let a = aggByCasa.get(casa);
      if (!a) {
        a = { house_id: houseId, casa, month: monthStr, ea_wh: 0, eri_varh: 0 };
        aggByCasa.set(casa, a);
      }
      a.ea_wh += Math.max(0, dEA);
      a.eri_varh += Math.max(0, dERI);
    }
  }

  // Calcular métricas derivadas (record_date = primer día del mes — eso usa el unique constraint)
  const out = [];
  for (const a of aggByCasa.values()) {
    let ratio_pct: number | null = null;
    let excedente_kvarh: number | null = null;
    let cos_phi: number | null = null;
    let cop: number | null = null;
    if (a.ea_wh > 0) {
      ratio_pct = (a.eri_varh / a.ea_wh) * 100;
      const limite = UMBRAL_CREG * a.ea_wh;
      excedente_kvarh = Math.max(0, a.eri_varh - limite) / 1000;
      cos_phi = a.ea_wh / Math.sqrt(a.ea_wh ** 2 + a.eri_varh ** 2);
      cop = excedente_kvarh * TARIFA_DEFAULT_COP;
    }
    out.push({
      house_id: a.house_id,
      casa: a.casa,
      record_date: a.month,
      eri_ratio_pct_mtd: ratio_pct,
      excedente_kvarh_mtd: excedente_kvarh,
      cos_phi_mtd: cos_phi,
      penalizacion_cop_mtd: cop,
    });
  }
  return out;
}

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

    // Separar reglas según el tipo de variable
    const dailyRules = rules.filter((r) => !REACTIVE_VARS.has(r.variable));
    const reactiveRules = rules.filter((r) => REACTIVE_VARS.has(r.variable));

    const events: Array<Record<string, unknown>> = [];

    // ─── 1. Reglas DIARIAS contra daily_casa_metrics (últimos 7 días) ───
    if (dailyRules.length > 0) {
      const cutoff = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
      const { data: metrics, error: mErr } = await supabaseAdmin
        .from('daily_casa_metrics')
        .select('house_id, casa, record_date, generacion_wh, importacion_wh, excedentes_wh, demanda_wh, gen_dem_pct, exc_gen_pct, imp_dem_pct, yield_real, desempeno_pct, potencia_kw, imax_a')
        .gte('record_date', cutoff);
      if (mErr) throw mErr;
      for (const rule of dailyRules) {
        const scoped = rule.scope === 'all' ? (metrics ?? []) : (metrics ?? []).filter((m) => m.casa === rule.scope);
        for (const m of scoped) {
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
    }

    // ─── 2. Reglas REACTIVAS mensuales (month-to-date) ───
    if (reactiveRules.length > 0) {
      const reactiveData = await computeReactiveMTD();
      for (const rule of reactiveRules) {
        const scoped = rule.scope === 'all' ? reactiveData : reactiveData.filter((m) => m.casa === rule.scope);
        for (const m of scoped) {
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
            message: `[CREG] ${rule.name}: ${rule.variable} = ${Number(value).toFixed(2)} ${opSymbol(rule.operator)} ${rule.threshold} — ${m.casa} mes ${m.record_date.slice(0, 7)}`,
          });
        }
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
