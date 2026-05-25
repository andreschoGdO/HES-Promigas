import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

const ALLOWED_VARIABLES = ['generacion_wh', 'importacion_wh', 'excedentes_wh', 'demanda_wh', 'gen_dem_pct', 'exc_gen_pct', 'imp_dem_pct', 'yield_real', 'desempeno_pct', 'potencia_kw', 'imax_a'];
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
  if (!r.variable || !ALLOWED_VARIABLES.includes(r.variable)) return `variable inválida (debe ser uno de: ${ALLOWED_VARIABLES.join(', ')})`;
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
  const updates: Partial<RuleInput> = { ...body, updated_at: new Date().toISOString() } as Partial<RuleInput> & { updated_at: string };
  delete updates.id;
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
