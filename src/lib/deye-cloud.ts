/**
 * Adaptador de Deye Cloud API (https://developer.deyecloud.com/api).
 *
 * ESTADO: LECTURA real e implementada y verificada en vivo (2026-07-23)
 * contra la cuenta AMEA de davider@gdo.com.co. ESCRITURA (control de
 * inversor) sigue sin implementar — no se confirmó que la App tenga
 * permiso de control habilitado (el portal solo mostraba "Station
 * Monitoring, Device Monitoring" en Access Control). Ver
 * docs/superpowers/specs/2026-07-23-deye-cloud-api-design.md para el
 * detalle completo de la investigación y qué falta para prender control.
 *
 * ── Auth ──
 * NO es OAuth2 client_credentials (el comentario viejo de este archivo
 * estaba mal, era una suposición sin verificar). Es:
 *   POST {BASE_URL}/account/token?appId={appId}
 *   Body: { appSecret, email, password: sha256_hex(password), companyId }
 * Devuelve un JWT de larga duración (~60 días) + refreshToken.
 *
 * ── Data center ──
 * La cuenta AMEA de gdo.com.co autentica contra el cluster **US1**
 * (`https://us1-developer.deyecloud.com/v1.0`), aunque el token trae
 * `mdc:"am"` adentro marcando el data center real. No existe un
 * subdominio "amea*-developer.deyecloud.com" — se confirmó por DNS que
 * ninguna variante resuelve. Si se agrega una cuenta EU en el futuro,
 * puede que SÍ use eu1-developer.deyecloud.com — no asumir US1 a ciegas.
 *
 * ENV requeridas (Vercel → Project → Env Vars):
 *   DEYE_APP_ID          – App ID del developer portal.
 *   DEYE_APP_SECRET       – App Secret.
 *   DEYE_ACCOUNT_EMAIL    – email de la cuenta Deye Cloud (no es API key).
 *   DEYE_ACCOUNT_PASSWORD – password en texto plano; se hashea acá (sha256).
 *   DEYE_BASE_URL         – opcional; default 'https://us1-developer.deyecloud.com/v1.0'.
 *
 * Mapeo de dispositivos:
 *   Cada `devices.id` local necesita su `devices.deye_device_sn` (y
 *   `devices.deye_station_id` para listar por estación). Sin
 *   deye_device_sn, sendDeyeCommand retorna `unavailable`.
 */

import { createHash } from 'crypto';

const BASE_URL = process.env.DEYE_BASE_URL ?? 'https://us1-developer.deyecloud.com/v1.0';

function haveAccountCredentials(): boolean {
  return Boolean(
    process.env.DEYE_APP_ID && process.env.DEYE_APP_SECRET &&
    process.env.DEYE_ACCOUNT_EMAIL && process.env.DEYE_ACCOUNT_PASSWORD,
  );
}

// ─── Token cache en memoria (proceso único de Vercel functions) ───
let cachedToken: { token: string; expiresAt: number } | null = null;

interface TokenResponse {
  success: boolean;
  code: string;
  msg: string;
  accessToken?: string;
  expiresIn?: string;
}

async function fetchFreshToken(): Promise<{ token: string } | { error: string }> {
  const appId = process.env.DEYE_APP_ID!;
  const appSecret = process.env.DEYE_APP_SECRET!;
  const email = process.env.DEYE_ACCOUNT_EMAIL!;
  const password = process.env.DEYE_ACCOUNT_PASSWORD!;
  const passwordHash = createHash('sha256').update(password, 'utf8').digest('hex');

  try {
    const r = await fetch(`${BASE_URL}/account/token?appId=${encodeURIComponent(appId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appSecret, email, companyId: '0', password: passwordHash }),
    });
    const j = (await r.json()) as TokenResponse;
    if (!j.success || !j.accessToken) return { error: `${j.code ?? '?'}: ${j.msg ?? 'sin accessToken'}` };
    return { token: j.accessToken };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'network error' };
  }
}

/** Devuelve un token válido, reusando el cacheado si no está por expirar. */
export async function getDeyeToken(): Promise<{ token: string } | { error: string }> {
  if (!haveAccountCredentials()) return { error: 'no_credentials' };
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return { token: cachedToken.token };
  }
  const result = await fetchFreshToken();
  if ('error' in result) return result;
  // expiresIn no viene en este resultado reducido — se refresca cada
  // invocación fría de todos modos (funciones serverless), así que un TTL
  // conservador de 1h en memoria alcanza; evita loguearse en cada llamada
  // dentro del mismo request/proceso.
  cachedToken = { token: result.token, expiresAt: Date.now() + 60 * 60 * 1000 };
  return result;
}

async function deyeFetch<T>(path: string, body: Record<string, unknown>): Promise<T | { error: string }> {
  const tokenResult = await getDeyeToken();
  if ('error' in tokenResult) return { error: tokenResult.error };
  try {
    const r = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `bearer ${tokenResult.token}` },
      body: JSON.stringify(body),
    });
    const j = await r.json();
    if (j.success === false) return { error: `${j.code ?? '?'}: ${j.msg ?? 'error'}` };
    return j as T;
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'network error' };
  }
}

export interface DeyeStation {
  id: number;
  name: string;
  connectionStatus: string;
  generationPower: number | null;
  batterySOC: number | null;
  installedCapacity: number | null;
}

/** Lista las estaciones (plantas) visibles para esta cuenta/App. */
export async function listStations(page = 1, size = 20): Promise<{ stations: DeyeStation[]; total: number } | { error: string }> {
  const res = await deyeFetch<{ stationList: DeyeStation[]; total: number }>('/station/list', { page, size });
  if ('error' in res) return res;
  return { stations: res.stationList ?? [], total: res.total ?? 0 };
}

export interface DeyeDeviceListItem {
  deviceSn: string;
  deviceId: number;
  deviceType: 'INVERTER' | 'BATTERY' | 'COLLECTOR' | string;
  connectStatus: number;
  stationId: number;
}

/** Lista los devices (inversor/batería/collector) de una o más estaciones. */
export async function getStationDevices(stationIds: number[], page = 1, size = 20): Promise<{ devices: DeyeDeviceListItem[]; total: number } | { error: string }> {
  const res = await deyeFetch<{ deviceListItems: DeyeDeviceListItem[]; total: number }>('/station/device', { page, size, stationIds });
  if ('error' in res) return res;
  return { devices: res.deviceListItems ?? [], total: res.total ?? 0 };
}

export interface DeyeDataPoint { key: string; value: string; unit?: string }
export interface DeyeDeviceLatest {
  deviceSn: string;
  deviceType: string;
  deviceState: number;
  collectionTime: number;
  dataList: DeyeDataPoint[];
}

/** Telemetría más reciente de hasta 10 devices por lote. */
export async function getDeviceLatest(deviceSns: string[]): Promise<{ devices: DeyeDeviceLatest[] } | { error: string }> {
  if (deviceSns.length === 0) return { devices: [] };
  if (deviceSns.length > 10) return { error: 'máximo 10 deviceSn por lote (límite de la API)' };
  const res = await deyeFetch<{ deviceDataList: DeyeDeviceLatest[] }>('/device/latest', { deviceList: deviceSns });
  if ('error' in res) return res;
  return { devices: res.deviceDataList ?? [] };
}

// ─────────────────────────────────────────────────────────────────
// Control (escritura) — NO implementado. Ver spec para el detalle de
// qué endpoint real usaría cada action y por qué no coinciden 1:1 con
// las 4 actions que ya existen en /api/inverter/command:
//
//   set_work_mode          → POST /order/sys/workMode/update (mapeo directo, listo para activar)
//   set_active_power_limit → POST /order/sys/power/update (powerType MAX_SELL_POWER|MAX_SOLAR_POWER —
//                             semántica distinta a "límite % de potencia activa", revisar antes de mapear)
//   set_power_factor       → SIN endpoint documentado en la API pública. Requeriría
//                             /order/customControl (Modbus crudo) + mapa de registros de Deye (no obtenido).
//   set_reactive_power     → mismo caso que power_factor, sin endpoint documentado.
//
// Antes de implementar sendDeyeCommand de verdad falta:
//   1. Confirmar en el portal que la App tiene "Device Control"/"Order" habilitado
//      en Access Control (hoy solo tenía Station Monitoring + Device Monitoring).
//   2. Decidir qué hacer con power_factor/reactive_power (pedir el mapa de
//      registros Modbus a cloudservice@deye.com.cn, o sacarlos del panel).
// ─────────────────────────────────────────────────────────────────

export type DeyeAction =
  | 'set_power_factor'
  | 'set_reactive_power'
  | 'set_active_power_limit'
  | 'set_work_mode';

export interface DeyeCommandInput {
  deviceSn: string;
  stationId?: string | null;
  action: DeyeAction;
  value: number;
}

export type DeyeCommandResult =
  | { status: 'sent'; payload: Record<string, unknown> }
  | { status: 'failed'; error: string }
  | { status: 'unavailable'; reason: 'no_credentials' | 'no_device_sn' | 'not_implemented' };

export async function sendDeyeCommand(input: DeyeCommandInput): Promise<DeyeCommandResult> {
  if (!haveAccountCredentials()) return { status: 'unavailable', reason: 'no_credentials' };
  if (!input.deviceSn) return { status: 'unavailable', reason: 'no_device_sn' };
  return { status: 'unavailable', reason: 'not_implemented' };
}
