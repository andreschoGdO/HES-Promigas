/**
 * Adaptador de Deye Cloud API (https://developer.deyecloud.com/api).
 *
 * ESTADO: ESQUELETO. Este archivo declara la superficie que expondrá el
 * adapter cuando se activen las credenciales OEM. Ninguna función hace
 * HTTP todavía — todas devuelven `unavailable` si no hay ENV, y `todo`
 * cuando sí hay ENV pero el body real no está escrito.
 *
 * ENV requeridas (Vercel → Project → Env Vars) para prender el adapter:
 *   DEYE_APP_ID       – App ID emitido por Deye (developer console).
 *   DEYE_APP_SECRET   – App Secret.
 *   DEYE_BASE_URL     – opcional; default 'https://eu1-developer.deyecloud.com'.
 *
 * Mapeo de dispositivos:
 *   Cada `devices.id` local necesita su `devices.deye_device_sn` y (opcional)
 *   `devices.deye_station_id`. Sin esos campos, ni siquiera intentamos llamar
 *   a la API — `sendDeyeCommand` retorna `unavailable`.
 *
 * Rate limit / auditoría:
 *   El caller (`/api/inverter/command`) ya persiste el comando en
 *   `inverter_control_commands`. Aquí NO se hace log adicional.
 */

export type DeyeAction =
  | 'set_power_factor'
  | 'set_reactive_power'
  | 'set_active_power_limit'
  | 'set_work_mode';

export interface DeyeCommandInput {
  deviceSn: string;
  stationId?: string | null;
  action: DeyeAction;
  /** Valor en la unidad natural del action (cos_phi, kvar, kW, mode_code). */
  value: number;
}

export type DeyeCommandResult =
  | { status: 'sent'; payload: Record<string, unknown> }
  | { status: 'failed'; error: string }
  | { status: 'unavailable'; reason: 'no_credentials' | 'no_device_sn' | 'not_implemented' };

const BASE_URL = process.env.DEYE_BASE_URL ?? 'https://eu1-developer.deyecloud.com';

function haveCredentials(): boolean {
  return Boolean(process.env.DEYE_APP_ID && process.env.DEYE_APP_SECRET);
}

/**
 * Obtiene un access token de Deye Cloud (OAuth2 client_credentials).
 *
 * Endpoint típico: POST {BASE_URL}/v1.0/account/token
 * Body: { appId, appSecret, grantType: 'client_credentials' }
 * Response: { data: { access_token, expires_in } }
 *
 * TODO: cachear el token en memoria hasta expiración - 60 s. Para un único
 * proceso node en Vercel esto basta; si movemos a workers múltiples, mover
 * la caché a Supabase o KV.
 */
export async function getDeyeToken(): Promise<{ token: string } | { error: string }> {
  if (!haveCredentials()) return { error: 'no_credentials' };
  // TODO: implementar fetch real.
  // const r = await fetch(`${BASE_URL}/v1.0/account/token`, { … });
  // const j = await r.json();
  // return { token: j.data.access_token };
  return { error: 'not_implemented' };
}

/**
 * Envía un comando de control a un inversor Deye a través del Cloud.
 *
 * Endpoint típico (revisar contra la doc actual):
 *   POST {BASE_URL}/v1.0/order/control
 * Body:
 *   { deviceSn, code: <mapeo por action>, value }
 * Response:
 *   { code: 'success', msg, requestId, data: { orderNo } }
 */
export async function sendDeyeCommand(input: DeyeCommandInput): Promise<DeyeCommandResult> {
  if (!haveCredentials()) return { status: 'unavailable', reason: 'no_credentials' };
  if (!input.deviceSn) return { status: 'unavailable', reason: 'no_device_sn' };
  // TODO: implementar cuando lleguen las credenciales.
  //   1. token = getDeyeToken()
  //   2. codeMap[action] → código Deye (p.ej. 'set_active_power_regulation', 'set_pf', …)
  //   3. POST /v1.0/order/control con { deviceSn, code, value } y Authorization: Bearer <token>
  //   4. Mapear response.code === 'success' → { status: 'sent', payload }; else → { status: 'failed', error }
  void BASE_URL;
  return { status: 'unavailable', reason: 'not_implemented' };
}
