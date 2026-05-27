import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

/**
 * GET /api/alerts/evaluate
 *
 * Evalúa TODAS las reglas activas, agrupadas por origen de los datos:
 *
 *   1. DAILY  → daily_casa_metrics (energía, yield, PR, demanda, batería diaria)
 *   2. MTD    → calculado de daily_energy_closures (reactiva month-to-date CREG)
 *   3. INSTANT→ instant_metrics (potencias, fp en vivo, corriente, SOC batería)
 *   4. ALARM  → devices.alarm_flags (flag* de inversores, estado on/off DEYE)
 *
 * Idempotente: el unique constraint (rule_id, house_id, record_date) evita duplicados.
 */

const MTD_VARS = new Set([
  'eri_ratio_pct_mtd',
  'excedente_kvarh_mtd',
  'cos_phi_mtd',
  'penalizacion_cop_mtd',
]);

const INSTANT_VARS = new Set([
  'current_a_max',
  'power_active_w',
  'power_active_kw',
  'power_reactive_var',
  'cos_phi_now',
  'fase_imbalance_pct',
  'batt_soc_pct',
  'gateway_offline_min',
]);

const TARIFA_DEFAULT_COP = 130;
const UMBRAL_CREG = 0.5;

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
  month: string;
  ea_wh: number;
  eri_varh: number;
}

async function computeReactiveMTD() {
  const now = new Date();
  const currentMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const monthStr = currentMonthStart.toISOString().slice(0, 10);
  const baselineDate = new Date(currentMonthStart.getTime() - 86400000).toISOString().slice(0, 10);

  const { data: houses } = await supabaseAdmin.from('client_houses').select('id, casa');
  const houseByCasa = new Map((houses ?? []).map((h: { id: string; casa: string }) => [h.casa, h.id]));

  const { data } = await supabaseAdmin
    .from('daily_energy_closures')
    .select('device_id, record_date, energy_active_imported_wh, energy_reactive_imported_varh, devices!inner(type, casa)')
    .eq('devices.type', 'red')
    .gte('record_date', baselineDate)
    .order('record_date', { ascending: true })
    .limit(5000);

  const closures = (data ?? []) as unknown as RawClosure[];
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
      if (r.record_date < monthStr) continue;
      const casa = r.devices?.casa;
      if (!casa) continue;
      const houseId = houseByCasa.get(casa);
      if (!houseId) continue;
      const dEA = (r.energy_active_imported_wh ?? 0) - (prev.energy_active_imported_wh ?? 0);
      const dERI = (r.energy_reactive_imported_varh ?? 0) - (prev.energy_reactive_imported_varh ?? 0);
      let a = aggByCasa.get(casa);
      if (!a) { a = { house_id: houseId, casa, month: monthStr, ea_wh: 0, eri_varh: 0 }; aggByCasa.set(casa, a); }
      a.ea_wh += Math.max(0, dEA);
      a.eri_varh += Math.max(0, dERI);
    }
  }

  const out: Array<{ house_id: string; casa: string; record_date: string; eri_ratio_pct_mtd: number | null; excedente_kvarh_mtd: number | null; cos_phi_mtd: number | null; penalizacion_cop_mtd: number | null; }> = [];
  for (const a of aggByCasa.values()) {
    let ratio_pct: number | null = null, excedente_kvarh: number | null = null, cos_phi: number | null = null, cop: number | null = null;
    if (a.ea_wh > 0) {
      ratio_pct = (a.eri_varh / a.ea_wh) * 100;
      const limite = UMBRAL_CREG * a.ea_wh;
      excedente_kvarh = Math.max(0, a.eri_varh - limite) / 1000;
      cos_phi = a.ea_wh / Math.sqrt(a.ea_wh ** 2 + a.eri_varh ** 2);
      cop = excedente_kvarh * TARIFA_DEFAULT_COP;
    }
    out.push({ house_id: a.house_id, casa: a.casa, record_date: a.month, eri_ratio_pct_mtd: ratio_pct, excedente_kvarh_mtd: excedente_kvarh, cos_phi_mtd: cos_phi, penalizacion_cop_mtd: cop });
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

    // Clasificar reglas por origen
    const alarmRules = rules.filter((r) => r.variable.startsWith('alarm_'));
    const mtdRules = rules.filter((r) => MTD_VARS.has(r.variable));
    const instantRules = rules.filter((r) => INSTANT_VARS.has(r.variable));
    const dailyRules = rules.filter((r) =>
      !r.variable.startsWith('alarm_') && !MTD_VARS.has(r.variable) && !INSTANT_VARS.has(r.variable)
    );

    interface AlertEventInsert {
      rule_id: string;
      house_id: string | null;
      casa: string;
      record_date: string;
      variable: string;
      value: number;
      threshold: number;
      operator: string;
      severity: 'high' | 'medium' | 'low';
      message: string;
    }
    const events: AlertEventInsert[] = [];

    // ─── 1. DAILY contra daily_casa_metrics ───
    if (dailyRules.length > 0) {
      const cutoff = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
      const { data: metrics } = await supabaseAdmin
        .from('daily_casa_metrics')
        .select('*')
        .gte('record_date', cutoff);
      for (const rule of dailyRules) {
        const scoped = rule.scope === 'all' ? (metrics ?? []) : (metrics ?? []).filter((m) => m.casa === rule.scope);
        for (const m of scoped) {
          const value = (m as unknown as Record<string, number | null>)[rule.variable];
          if (value === null || value === undefined) continue;
          if (!compare(Number(value), rule.operator, Number(rule.threshold))) continue;
          events.push({
            rule_id: rule.id, house_id: m.house_id, casa: m.casa, record_date: m.record_date,
            variable: rule.variable, value: Number(value), threshold: Number(rule.threshold),
            operator: rule.operator, severity: rule.severity,
            message: `${rule.name} — ${m.casa} (${m.record_date})`,
          });
        }
      }
    }

    // ─── 2. MTD reactiva ───
    if (mtdRules.length > 0) {
      const reactiveData = await computeReactiveMTD();
      for (const rule of mtdRules) {
        const scoped = rule.scope === 'all' ? reactiveData : reactiveData.filter((m) => m.casa === rule.scope);
        for (const m of scoped) {
          const value = (m as unknown as Record<string, number | null>)[rule.variable];
          if (value === null || value === undefined) continue;
          if (!compare(Number(value), rule.operator, Number(rule.threshold))) continue;
          events.push({
            rule_id: rule.id, house_id: m.house_id, casa: m.casa, record_date: m.record_date,
            variable: rule.variable, value: Number(value), threshold: Number(rule.threshold),
            operator: rule.operator, severity: rule.severity,
            message: `${rule.name} — ${m.casa} (mes ${m.record_date.slice(0, 7)})`,
          });
        }
      }
    }

    // ─── 3. INSTANT desde instant_metrics (último registro por casa) ───
    if (instantRules.length > 0) {
      const cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();
      const { data: rows } = await supabaseAdmin
        .from('instant_metrics')
        .select('*')
        .gte('recorded_at', cutoff)
        .order('recorded_at', { ascending: false });
      // Mantener solo el más reciente por casa
      const latestByCasa = new Map<string, Record<string, unknown>>();
      for (const r of rows ?? []) {
        if (!latestByCasa.has(r.casa)) latestByCasa.set(r.casa, r);
      }
      const dateToday = new Date().toISOString().slice(0, 10);
      for (const rule of instantRules) {
        const candidates = rule.scope === 'all' ? Array.from(latestByCasa.values()) : Array.from(latestByCasa.values()).filter((m) => m.casa === rule.scope);
        for (const m of candidates) {
          // Variable derivada: gateway_offline_min
          let value: number | null = null;
          if (rule.variable === 'gateway_offline_min') {
            const lastSeen = m.gateway_last_seen ? new Date(m.gateway_last_seen as string).getTime() : null;
            value = lastSeen !== null ? Math.floor((Date.now() - lastSeen) / 60000) : null;
          } else if (rule.variable === 'power_active_kw') {
            const w = m.power_active_w as number | null;
            value = typeof w === 'number' ? w / 1000 : null;
          } else {
            value = (m as Record<string, number | null>)[rule.variable] ?? null;
          }
          if (value === null || value === undefined) continue;
          if (!compare(Number(value), rule.operator, Number(rule.threshold))) continue;
          const mRow = m as { house_id: string | null; casa: string };
          events.push({
            rule_id: rule.id, house_id: mRow.house_id, casa: mRow.casa, record_date: dateToday,
            variable: rule.variable, value: Number(value), threshold: Number(rule.threshold),
            operator: rule.operator, severity: rule.severity,
            message: `${rule.name} — ${mRow.casa} (en vivo)`,
          });
        }
      }
    }

    // ─── 4. ALARM (flag*) desde devices.alarm_flags ───
    if (alarmRules.length > 0) {
      const { data: devs } = await supabaseAdmin
        .from('devices')
        .select('id, name, subtype, casa, house_id, alarm_flags')
        .eq('subtype', 'inverter');
      const dateToday = new Date().toISOString().slice(0, 10);
      for (const rule of alarmRules) {
        const flagKey = rule.variable.replace(/^alarm_/, '');
        const scopedDevs = rule.scope === 'all' ? (devs ?? []) : (devs ?? []).filter((d) => d.casa === rule.scope);
        for (const d of scopedDevs) {
          if (!d.house_id || !d.casa) continue;
          const flags = (d.alarm_flags ?? {}) as Record<string, number | string>;
          const raw = flags[flagKey];
          if (raw === undefined || raw === null) continue;
          const value = typeof raw === 'number' ? raw : (raw === 'on' ? 1 : raw === 'off' ? 0 : Number(raw));
          if (!Number.isFinite(value)) continue;
          if (!compare(value, rule.operator, Number(rule.threshold))) continue;
          events.push({
            rule_id: rule.id, house_id: d.house_id, casa: d.casa, record_date: dateToday,
            variable: rule.variable, value, threshold: Number(rule.threshold),
            operator: rule.operator, severity: rule.severity,
            message: `${rule.name} — ${d.casa} · ${d.name}`,
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
