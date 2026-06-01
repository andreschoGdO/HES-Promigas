import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

const ALLOWED_VARIABLES = [
  // Métricas diarias (de daily_casa_metrics)
  'generacion_wh', 'importacion_wh', 'excedentes_wh', 'demanda_wh',
  'gen_dem_pct', 'exc_gen_pct', 'imp_dem_pct',
  'yield_real', 'desempeno_pct', 'potencia_kw', 'imax_a',
  // Batería diaria (de daily_casa_metrics, alimentadas por daily_consumption)
  'batt_soh_pct', 'batt_energy_delivered_wh', 'batt_delivery_time_s',
  // Reactiva mensual CREG 015-2018 (month-to-date)
  'eri_ratio_pct_mtd', 'excedente_kvarh_mtd', 'cos_phi_mtd', 'penalizacion_cop_mtd',
  // Lazo 15 min (de instant_metrics)
  'current_a_max', 'power_active_w', 'power_active_kw', 'power_reactive_var',
  'cos_phi_now', 'fase_imbalance_pct', 'batt_soc_pct', 'gateway_offline_min',
];

// Variables tipo alarma `alarm_*` (mapean a una key dentro de devices.alarm_flags)
const ALARM_FLAG_KEYS = [
  'FSVER', 'FSCER', 'FBVER',
  'FFT', 'ETA',
  'FFDC',
  'FEM', 'FFB', 'FFCT', 'FAFER',
  'EMayor', 'EMenor', 'EAM', 'ECEO', 'EPSR', 'ESSI',
  'UIcolorRojo', 'UIcolorAmarillo', 'UIcolorNaranja',
  'TLinvstate_off',
];
const isAllowedVariable = (v: string) =>
  ALLOWED_VARIABLES.includes(v) || (v.startsWith('alarm_') && ALARM_FLAG_KEYS.includes(v.slice(6)));
const ALLOWED_OPERATORS = ['gt', 'lt', 'eq', 'gte', 'lte'];
const ALLOWED_SEVERITIES = ['high', 'medium', 'low'];

interface RuleInput {
  id?: string;
  name?: string;
  description?: string | null;
  variable?: string;
  operator?: string;
  threshold?: number;
  severity?: string;
  enabled?: boolean;
  scope?: string;
}

const validate = (r: RuleInput) => {
  if (!r.name) return 'name requerido';
  if (!r.variable || !isAllowedVariable(r.variable)) return `variable inválida`;
  if (!r.operator || !ALLOWED_OPERATORS.includes(r.operator)) return `operator inválido (${ALLOWED_OPERATORS.join('|')})`;
  if (typeof r.threshold !== 'number' || !Number.isFinite(r.threshold)) return 'threshold debe ser número';
  if (!r.severity || !ALLOWED_SEVERITIES.includes(r.severity)) return `severity inválida (${ALLOWED_SEVERITIES.join('|')})`;
  return null;
};

export async function GET() {
  const { data, error } = await supabaseAdmin.from('alert_rules').select('*').order('created_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ rules: data });
}

export async function POST(request: Request) {
  const body = await request.json() as RuleInput;
  const err = validate(body);
  if (err) return NextResponse.json({ error: err }, { status: 400 });
  const { data, error } = await supabaseAdmin
    .from('alert_rules')
    .insert({
      name: body.name,
      description: body.description ?? null,
      variable: body.variable,
      operator: body.operator,
      threshold: body.threshold,
      severity: body.severity,
      enabled: body.enabled ?? true,
      scope: body.scope ?? 'all',
    })
    .select('*')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ rule: data });
}

export async function PATCH(request: Request) {
  const body = await request.json() as RuleInput;
  if (!body.id) return NextResponse.json({ error: 'id requerido' }, { status: 400 });

  // Construir updates sólo con campos conocidos + validar los que vienen
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.name !== undefined) {
    if (!body.name) return NextResponse.json({ error: 'name no puede ser vacío' }, { status: 400 });
    updates.name = body.name;
  }
  if (body.description !== undefined) updates.description = body.description;
  if (body.variable !== undefined) {
    if (!isAllowedVariable(body.variable)) return NextResponse.json({ error: 'variable inválida' }, { status: 400 });
    updates.variable = body.variable;
  }
  if (body.operator !== undefined) {
    if (!ALLOWED_OPERATORS.includes(body.operator)) return NextResponse.json({ error: `operator inválido (${ALLOWED_OPERATORS.join('|')})` }, { status: 400 });
    updates.operator = body.operator;
  }
  if (body.threshold !== undefined) {
    if (typeof body.threshold !== 'number' || !Number.isFinite(body.threshold)) return NextResponse.json({ error: 'threshold debe ser número' }, { status: 400 });
    updates.threshold = body.threshold;
  }
  if (body.severity !== undefined) {
    if (!ALLOWED_SEVERITIES.includes(body.severity)) return NextResponse.json({ error: `severity inválida (${ALLOWED_SEVERITIES.join('|')})` }, { status: 400 });
    updates.severity = body.severity;
  }
  if (body.enabled !== undefined) updates.enabled = !!body.enabled;
  if (body.scope !== undefined) updates.scope = body.scope ?? 'all';

  const { data, error } = await supabaseAdmin.from('alert_rules').update(updates).eq('id', body.id).select('*').single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ rule: data });
}

export async function DELETE(request: Request) {
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id requerido' }, { status: 400 });
  const { error } = await supabaseAdmin.from('alert_rules').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
