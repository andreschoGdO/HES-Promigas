import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

/** GET /api/alerts/events?severity=high&acknowledged=false&from=YYYY-MM-DD&to=YYYY-MM-DD */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const severity = url.searchParams.get('severity');
  const acknowledged = url.searchParams.get('acknowledged');
  const houseId = url.searchParams.get('houseId');
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');

  let q = supabaseAdmin
    .from('alert_events')
    .select('id, rule_id, house_id, casa, record_date, variable, value, threshold, operator, severity, message, fired_at, acknowledged, alert_rules(name)')
    .order('fired_at', { ascending: false })
    .limit(500);
  if (severity) q = q.eq('severity', severity);
  if (acknowledged !== null) q = q.eq('acknowledged', acknowledged === 'true');
  if (houseId) q = q.eq('house_id', houseId);
  if (from) q = q.gte('record_date', from);
  if (to) q = q.lte('record_date', to);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ events: data });
}

/** PATCH /api/alerts/events — acknowledge */
export async function PATCH(request: Request) {
  const body = await request.json();
  if (!body.id) return NextResponse.json({ error: 'id requerido' }, { status: 400 });
  const ack = body.acknowledged ?? true;
  const { data, error } = await supabaseAdmin
    .from('alert_events')
    .update({ acknowledged: ack, acknowledged_at: ack ? new Date().toISOString() : null })
    .eq('id', body.id)
    .select('*')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ event: data });
}
