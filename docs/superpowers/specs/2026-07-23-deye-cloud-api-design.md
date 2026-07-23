# Integración Deye Cloud API — lectura implementada, control pendiente

Fecha: 2026-07-23
Estado: Lectura implementada y verificada en vivo. Control (escritura) pendiente de confirmar permiso.

## Contexto

`src/lib/deye-cloud.ts` era un esqueleto puro (ninguna función hacía HTTP, todo
devolvía `not_implemented`), con endpoints y modelo de auth **adivinados sin
verificar** (OAuth2 client_credentials — estaba mal). El usuario pidió revisar
la documentación real de Deye Cloud y probar con credenciales reales.

Se investigó contra:
- `https://developer.deyecloud.com/api` (Swagger — es una SPA renderizada con
  JS, no da nada por HTML/WebFetch directo).
- El repo oficial de sample code: `github.com/DeyeCloudDevelopers/deye-openapi-client-sample-code`
  (Python, con un archivo por endpoint — esta fue la fuente real de todo lo
  que sigue).
- Pruebas en vivo contra la cuenta real (`davider@gdo.com.co`, data center
  "AMEA" según el portal) con appId/appSecret que el usuario generó.

## 1. Auth — verificado en vivo

**No es OAuth2 client_credentials.** Es:

```
POST {baseUrl}/account/token?appId={appId}
Body: { appSecret, email, password: sha256_hex(password), companyId: "0" }
```

Responde un JWT (`accessToken`) de larga duración (~60 días, `expiresIn` en
segundos) + `refreshToken`. Se manda como `Authorization: bearer <token>` en
cada llamada posterior.

## 2. Data center — AMEA no tiene subdominio propio

El portal muestra "Data Center: AMEA" para la cuenta, pero **no existe**
ningún subdominio `amea*-developer.deyecloud.com` (confirmado por DNS — no
resuelve ninguna variante probada). En la práctica, esta cuenta AMEA
**autentica contra el cluster US1** (`https://us1-developer.deyecloud.com/v1.0`).
El JWT devuelto trae `"mdc":"am"` adentro (marca el data center real), pero
la URL física de la API es la de US.

`eu1-developer.deyecloud.com/v1.0` también existe y responde (probado con
`account/info` sin token → error esperado), por si en el futuro se agrega una
cuenta EU — **no asumir US1 a ciegas para todas las cuentas**, probar cada
una.

`DEYE_BASE_URL` quedó como env var configurable justamente por esto.

## 3. Endpoints — catálogo completo verificado

Lectura (implementados en `deye-cloud.ts`, probados en vivo):

| Función | Endpoint | Nota |
|---|---|---|
| `getDeyeToken()` | `POST /account/token` | cacheado en memoria ~1h |
| `listStations()` | `POST /station/list` | body `{page, size}` |
| `getStationDevices(stationIds)` | `POST /station/device` | body `{page, size, stationIds: number[]}` — **ojo:** array, no un solo id |
| `getDeviceLatest(deviceSns)` | `POST /device/latest` | body `{deviceList: string[]}`, máx 10 por lote |

`/device/list` (lista TODOS los devices de la cuenta) devolvió
`"auth invalid token"` con el mismo token que sí funciona en los demás
endpoints — la doc de la muestra dice "Fetch device list for **business
members**", así que probablemente requiere una cuenta de organización, no
personal (`companyId=0`). No es necesario para nuestro caso: ya sabemos el
`deviceSn` de cada inversor por el mapeo con Metrum, así que `station/device`
alcanza.

Escritura (documentados, **ninguno implementado todavía**):

| Función | Endpoint | Body |
|---|---|---|
| Modo de trabajo | `POST /order/sys/workMode/update` | `{deviceSn, workMode: SELLING_FIRST\|ZERO_EXPORT_TO_LOAD\|ZERO_EXPORT_TO_CT}` |
| Límite de potencia | `POST /order/sys/power/update` | `{deviceSn, powerType: MAX_SELL_POWER\|MAX_SOLAR_POWER, value}` |
| Carga de batería on/off | `POST /order/battery/modeControl` | `{deviceSn, batteryModeType: GRID_CHARGE, action: on\|off}` |
| Corriente batería | `POST /order/battery/parameter/update` | `{deviceSn, paramterType: MAX_CHARGE_CURRENT\|MAX_DISCHARGE_CURRENT, value}` |
| Tipo de batería | `POST /order/battery/type/update` | `{deviceSn, batteryType: BATT_V\|BATT_SOC\|LI\|NO_BATTERY}` |
| Venta de excedentes | `POST /order/sys/solarSell/control` | `{deviceSn, action: on\|off}` |
| Horario TOU | `POST /order/sys/tou/update` | `{deviceSn, timeUseSettingItems: [...]}` (array de 6 franjas) |
| Patrón de energía | `POST /order/sys/energyPattern/update` | `{deviceSn, energyPattern: BATTERY_FIRST\|LOAD_FIRST}` |
| Peak shaving de red | `POST /order/gridPeakShaving/control` | `{deviceSn, action: on\|off, power}` |
| **Estrategia dinámica** (agrupa varios de arriba) | `POST /strategy/dynamicControl` | combina workMode + TOU + solarSell + gridCharge en un solo request — **es un update parcial**, cualquier parámetro no enviado conserva su valor anterior |
| Modbus crudo | `POST /order/customControl` | `{deviceSn, content: <hex Modbus + CRC>, timeoutSeconds}` — requiere mapa de registros Deye (no obtenido) |
| Estado de un comando | `GET /order/{orderId}` | los comandos son asíncronos — pollear hasta `status:666` (éxito) |

## 4. Gap importante: cos φ / Q reactiva no están en la API pública

El panel de "Gestión de equipos" (`InverterControlPanel`,
`/api/inverter/command`) tiene 4 `DeyeAction`: `set_power_factor`,
`set_reactive_power`, `set_active_power_limit`, `set_work_mode`. De estos:

- `set_work_mode` → mapea directo a `/order/sys/workMode/update`.
- `set_active_power_limit` → semántica parecida a `/order/sys/power/update`
  (MAX_SELL_POWER/MAX_SOLAR_POWER) pero no es 1:1 — revisar antes de mapear.
- `set_power_factor` / `set_reactive_power` → **sin endpoint documentado**.
  Solo sería posible vía `/order/customControl` (Modbus crudo) conociendo el
  registro exacto — el mapa de registros de Deye no está en ninguno de los
  dos links que pasó el usuario ni en el repo de sample code. Requeriría
  pedirlo a `cloudservice@deye.com.cn`.

## 5. Permiso de control — sin confirmar

El screenshot de la App en el portal mostraba `Access Control: Station
Monitoring, Device Monitoring` — **nada de "Device Control"/"Order"**. No se
llegó a confirmar si la App puede efectivamente enviar comandos de escritura:
el clasificador de seguridad del entorno bloqueó el intento de prueba (un
POST a `/order/sys/workMode/update` con un valor inválido a propósito, para
distinguir error de permiso vs error de validación sin tocar el inversor
real). Pendiente de decidir con el usuario cómo confirmar esto — no se
implementó nada de escritura mientras tanto (`sendDeyeCommand` sigue
retornando `unavailable/not_implemented`).

## 6. Lo que se dejó funcionando (este ciclo)

- `src/lib/deye-cloud.ts` reescrito: auth real + `listStations` +
  `getStationDevices` + `getDeviceLatest`, probados en vivo contra la cuenta
  real. `sendDeyeCommand` sigue sin implementar (ver §5).
- Migración `53_deye_device_link.sql` (agrega `devices.deye_device_sn` /
  `deye_station_id`) **nunca se había aplicado a la base real** — se aplicó
  en este ciclo.
- Se encontró 1 casa real conectada a esta App: **Casa 18 - Porton de la
  Rivera** (`devices.id = df378713-c8c6-40c7-8522-cb485d67c396`, deviceSn
  `2412240075`, stationId `198565`) — coincide con el proyecto CRM
  `PORTÓN DE LA RIVERA-18`. Se hizo el backfill de `deye_device_sn`/
  `deye_station_id` para ese device.
- Env vars nuevas (`.env.local`, no commiteadas): `DEYE_BASE_URL`,
  `DEYE_APP_ID`, `DEYE_APP_SECRET`, `DEYE_ACCOUNT_EMAIL`,
  `DEYE_ACCOUNT_PASSWORD`. Faltan agregarse en Vercel para producción.

## 7. Pendiente para retomar

1. Confirmar si la App tiene permiso de control (Access Control en el portal,
   o probar el POST con un valor inválido bajo supervisión del usuario).
2. Decidir qué hacer con `set_power_factor`/`set_reactive_power` (pedir mapa
   de registros Modbus a Deye, o sacarlos del panel si no hay forma de
   soportarlos).
3. Si se confirma permiso: implementar `sendDeyeCommand` de verdad, mapeando
   `set_work_mode` y `set_active_power_limit` a sus endpoints reales, y
   pollear `GET /order/{orderId}` hasta status 666 antes de devolver `sent`.
4. Agregar las 5 env vars nuevas a Vercel (Project → Environment Variables).
5. Ninguna otra casa está conectada a esta App todavía — cuando se conecten
   más inversores DEYE, hay que repetir el backfill de `deye_device_sn`/
   `deye_station_id` (a mano, o armar un endpoint que cruce por nombre/serial
   contra `station/device` de todas las estaciones visibles).
