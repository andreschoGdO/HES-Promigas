import { loginToMetrum, getAttributeValues, setServerAttributes } from './metrum-api';

/**
 * Corte/reconexión remota de medidores vía Metrum.
 *
 * Se confirmó por inspección en vivo que cada medidor (device type='meter',
 * protocolo DLMS/COSEM — modelos dds23y-1p, dtsy23-3p) expone:
 *   - `latch_state` / `latch_output` (SERVER_SCOPE): "close" | "open" — el
 *     relé de corte físico del medidor.
 *   - `command` (SERVER_SCOPE): atributo por el que Metrum despacha
 *     acciones (se observó el valor "updateCosem" en un medidor real).
 *
 * Lo que NO se confirmó todavía es el string exacto que hay que escribir en
 * `command` (o el método RPC) para disparar el corte/reconexión — escribir
 * un valor adivinado en un medidor de producción podría cortarle la luz a
 * un cliente real. Por eso el envío queda MOCKEADO por defecto: solo se
 * intenta el envío real si están configuradas TODAS estas env vars:
 *   - METRUM_METER_CONTROL_LIVE=true
 *   - METRUM_METER_DISCONNECT_COMMAND=<valor confirmado con Metrum>
 *   - METRUM_METER_RECONNECT_COMMAND=<valor confirmado con Metrum>
 */

export type MeterAction = 'disconnect' | 'reconnect';

export interface MeterCommandResult {
  status: 'mocked' | 'sent' | 'failed';
  latchStateAtSend: string | null;
  responsePayload: Record<string, unknown>;
  errorMessage: string | null;
}

const isLive = () => process.env.METRUM_METER_CONTROL_LIVE === 'true';

/** Lee el estado actual del latch (relé) de un medidor — solo lectura, siempre segura. */
export async function getMeterLatchState(metrumId: string): Promise<{ latchState: string | null; latchOutput: string | null; active: boolean | null } | null> {
  try {
    const token = await loginToMetrum();
    const vals = await getAttributeValues(token, metrumId, 'SERVER_SCOPE', ['latch_state', 'latch_output', 'active']);
    const byKey = new Map(vals.map((v) => [v.key, v.value]));
    return {
      latchState: (byKey.get('latch_state') as string) ?? null,
      latchOutput: (byKey.get('latch_output') as string) ?? null,
      active: (byKey.get('active') as boolean) ?? null,
    };
  } catch {
    return null;
  }
}

export async function sendMeterCommand(metrumId: string, action: MeterAction): Promise<MeterCommandResult> {
  const latch = await getMeterLatchState(metrumId);
  const latchStateAtSend = latch?.latchState ?? latch?.latchOutput ?? null;

  if (!isLive()) {
    return {
      status: 'mocked',
      latchStateAtSend,
      responsePayload: {
        mock: true,
        reason: 'command_not_confirmed',
        message: 'El string de comando exacto para corte/reconexión todavía no está confirmado con Metrum. Configura METRUM_METER_CONTROL_LIVE=true + METRUM_METER_DISCONNECT_COMMAND/METRUM_METER_RECONNECT_COMMAND para habilitar el envío real.',
        would_send: { metrumId, action },
      },
      errorMessage: null,
    };
  }

  const commandValue = action === 'disconnect'
    ? process.env.METRUM_METER_DISCONNECT_COMMAND
    : process.env.METRUM_METER_RECONNECT_COMMAND;
  if (!commandValue) {
    return {
      status: 'mocked',
      latchStateAtSend,
      responsePayload: { mock: true, reason: 'missing_command_env', would_send: { metrumId, action } },
      errorMessage: null,
    };
  }

  try {
    const token = await loginToMetrum();
    await setServerAttributes(token, metrumId, { command: commandValue });
    return {
      status: 'sent',
      latchStateAtSend,
      responsePayload: { command: commandValue },
      errorMessage: null,
    };
  } catch (err) {
    return {
      status: 'failed',
      latchStateAtSend,
      responsePayload: {},
      errorMessage: err instanceof Error ? err.message : 'Error desconocido',
    };
  }
}
