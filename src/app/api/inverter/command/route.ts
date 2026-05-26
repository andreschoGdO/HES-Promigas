import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

/**
 * POST /api/inverter/command
 * Envía un comando manual a un inversor.
 *
 * Body:
 *   {
 *     inverter_id: uuid,
 *     action: 'set_power_factor' | 'set_reactive_power' | 'set_active_power_limit' | 'set_work_mode',
 *     value: number,
 *     sent_by: string (email)
 *   }
 *
 * Estado actual: MOCK — guarda el comando en `inverter_control_commands` con status='mocked'
 * pero NO lo manda al fabricante porque aún no tenemos credenciales OEM.
 * Cuando se agreguen credenciales (LIVOLTEK_API_KEY, DEYE_CLIENT_ID/SECRET) este route
 * pasará el comando al adaptador correspondiente según `devices.marca`.
 */

const ALLOWED_ACTIONS = ['set_power_factor', 'set_reactive_power', 'set_active_power_limit', 'set_work_mode'] as const;
type Action = (typeof ALLOWED_ACTIONS)[number];

// Rangos válidos por acción (clamping de seguridad)
const RANGES: Record<Action, { min: number; max: number; unit: string }> = {
  set_power_factor:        { min: 0.80, max: 1.00, unit: 'cos_phi' },
  set_reactive_power:      { min: -10, max: 10, unit: 'kvar' },        // capacitivo a inductivo
  set_active_power_limit:  { min: 0, max: 15, unit: 'kW' },             // hasta la potencia nominal típica
  set_work_mode:           { min: 0, max: 5, unit: 'mode_code' },       // depende del fabricante
};

interface RequestBody {
  inverter_id?: string;
  action?: Action;
  value?: number;
  sent_by?: string;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as RequestBody;
    if (!body.inverter_id) return NextResponse.json({ error: 'inverter_id requerido' }, { status: 400 });
    if (!body.action || !ALLOWED_ACTIONS.includes(body.action)) {
      return NextResponse.json({ error: `action inválido (debe ser ${ALLOWED_ACTIONS.join(' | ')})` }, { status: 400 });
    }
    if (typeof body.value !== 'number' || !Number.isFinite(body.value)) {
      return NextResponse.json({ error: 'value debe ser número' }, { status: 400 });
    }
    const range = RANGES[body.action];
    if (body.value < range.min || body.value > range.max) {
      return NextResponse.json({ error: `value fuera de rango (${range.min} a ${range.max} ${range.unit})` }, { status: 400 });
    }

    // Cargar info del inversor + última lectura instant_metrics
    const { data: dev } = await supabaseAdmin
      .from('devices')
      .select('id, name, casa, house_id, marca, modelo, subtype')
      .eq('id', body.inverter_id)
      .single();
    if (!dev) return NextResponse.json({ error: 'Inversor no encontrado' }, { status: 404 });
    if (dev.subtype !== 'inverter') {
      return NextResponse.json({ error: 'El device no es un inversor' }, { status: 400 });
    }

    const { data: instant } = await supabaseAdmin
      .from('instant_metrics')
      .select('cos_phi_now, power_active_w, power_reactive_var')
      .eq('house_id', dev.house_id)
      .order('recorded_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    // ─── STUB: Intentar enviar al fabricante ───
    // Hoy no tenemos credenciales OEM. Cuando estén:
    //   if (dev.marca === 'LIVOLTEK') return livoltekSendCommand(...)
    //   if (dev.marca === 'DEYE')     return deyeSendCommand(...)
    const LIVOLTEK_KEY = process.env.LIVOLTEK_API_KEY;
    const DEYE_CLIENT_ID = process.env.DEYE_CLIENT_ID;
    const haveCredentials = (dev.marca === 'LIVOLTEK' && LIVOLTEK_KEY) || (dev.marca === 'DEYE' && DEYE_CLIENT_ID);

    let status: string;
    let responsePayload: Record<string, unknown> = {};
    let errorMessage: string | null = null;

    if (!haveCredentials) {
      status = 'mocked';
      responsePayload = {
        mock: true,
        message: `Credenciales OEM ${dev.marca ?? '?'} no configuradas. Comando registrado en auditoría pero no enviado al inversor.`,
        would_send: {
          marca: dev.marca,
          inverter_name: dev.name,
          action: body.action,
          value: body.value,
          unit: range.unit,
        },
      };
    } else {
      // TODO: implementar adaptadores reales cuando haya credenciales
      status = 'failed';
      errorMessage = 'Adaptador del fabricante aún no implementado (TODO).';
    }

    const { data: cmd, error: insErr } = await supabaseAdmin
      .from('inverter_control_commands')
      .insert({
        house_id: dev.house_id,
        casa: dev.casa,
        inverter_id: dev.id,
        inverter_name: dev.name,
        marca: dev.marca,
        modelo: dev.modelo,
        action: body.action,
        target_value: body.value,
        target_unit: range.unit,
        cos_phi_at_send: instant?.cos_phi_now ?? null,
        power_active_w_at_send: instant?.power_active_w ?? null,
        power_reactive_var_at_send: instant?.power_reactive_var ?? null,
        status,
        response_payload: responsePayload,
        error_message: errorMessage,
        sent_by: body.sent_by ?? 'unknown',
        completed_at: new Date().toISOString(),
      })
      .select('*')
      .single();
    if (insErr) throw insErr;

    return NextResponse.json({
      success: status !== 'failed',
      status,
      command: cmd,
      hint: status === 'mocked'
        ? 'El comando NO se envió al inversor. Configura LIVOLTEK_API_KEY o DEYE_CLIENT_ID/SECRET para habilitar envío real.'
        : undefined,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}

/**
 * GET /api/inverter/command?casa=Casa%2010&limit=20
 * Lista los últimos comandos enviados (opcional filtro por casa).
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const casa = url.searchParams.get('casa');
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 50), 200);

  let q = supabaseAdmin
    .from('inverter_control_commands')
    .select('id, casa, inverter_name, marca, modelo, action, target_value, target_unit, cos_phi_at_send, status, error_message, sent_by, sent_at, response_payload')
    .order('sent_at', { ascending: false })
    .limit(limit);
  if (casa) q = q.eq('casa', casa);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ commands: data });
}
