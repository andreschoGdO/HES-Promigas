import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { sendMeterCommand, type MeterAction } from '@/lib/metrum-meter-control';

/**
 * POST /api/metrum/meter-command
 * Envía un comando de corte/reconexión a un medidor.
 * Body: { meter_id: uuid (devices.id), action: 'disconnect'|'reconnect', sent_by: string }
 *
 * Estado actual: MOCK por defecto — ver src/lib/metrum-meter-control.ts.
 * El comando SIEMPRE queda registrado en auditoría, se envíe realmente o no.
 */
const ALLOWED_ACTIONS: MeterAction[] = ['disconnect', 'reconnect'];

export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (!body.meter_id) return NextResponse.json({ error: 'meter_id requerido' }, { status: 400 });
    if (!ALLOWED_ACTIONS.includes(body.action)) {
      return NextResponse.json({ error: `action inválido (debe ser ${ALLOWED_ACTIONS.join(' | ')})` }, { status: 400 });
    }

    const { data: dev, error: devErr } = await supabaseAdmin
      .from('devices')
      .select('id, name, casa, house_id, metrum_id, type')
      .eq('id', body.meter_id)
      .single();
    if (devErr || !dev) return NextResponse.json({ error: 'Medidor no encontrado' }, { status: 404 });
    if (!dev.metrum_id) return NextResponse.json({ error: 'Este device no tiene metrum_id configurado' }, { status: 400 });

    const result = await sendMeterCommand(dev.metrum_id, body.action as MeterAction);

    const { data: cmd, error: insErr } = await supabaseAdmin
      .from('meter_control_commands')
      .insert({
        house_id: dev.house_id,
        casa: dev.casa,
        meter_id: dev.id,
        meter_name: dev.name,
        metrum_id: dev.metrum_id,
        action: body.action,
        latch_state_at_send: result.latchStateAtSend,
        status: result.status,
        response_payload: result.responsePayload,
        error_message: result.errorMessage,
        sent_by: body.sent_by ?? 'unknown',
        completed_at: new Date().toISOString(),
      })
      .select('*')
      .single();
    if (insErr) throw insErr;

    return NextResponse.json({
      success: result.status !== 'failed',
      status: result.status,
      command: cmd,
      hint: result.status === 'mocked'
        ? 'El comando NO se envió al medidor. Falta confirmar con Metrum el string de comando y configurar METRUM_METER_CONTROL_LIVE + METRUM_METER_DISCONNECT_COMMAND/METRUM_METER_RECONNECT_COMMAND.'
        : undefined,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}

/** GET /api/metrum/meter-command?casa=&limit= — historial de comandos enviados. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const casa = url.searchParams.get('casa');
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 50), 200);

  let q = supabaseAdmin
    .from('meter_control_commands')
    .select('id, casa, meter_name, action, latch_state_at_send, status, error_message, sent_by, sent_at, response_payload')
    .order('sent_at', { ascending: false })
    .limit(limit);
  if (casa) q = q.eq('casa', casa);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ commands: data });
}
