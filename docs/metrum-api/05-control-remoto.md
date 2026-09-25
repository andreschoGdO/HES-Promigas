# Control remoto — medidores e inversores

Resumen ejecutivo: **la lectura funciona en producción para todo**. La **escritura**
(comandos reales) está en distintos grados de "casi listo" para cada sistema, pero en
ninguno se ha confirmado un comando real aplicado con éxito contra un equipo. Todo lo de
este archivo debe tratarse como "infraestructura lista, falta la última milla de
confirmación con el fabricante/proveedor".

## 1. Corte / reconexión remota de medidor (vía Metrum)

**Archivo**: `src/lib/metrum-meter-control.ts` (98 líneas) · **UI**:
`src/components/MeterControlPanel.tsx` · **API app**: `/api/metrum/meter-command`,
`/api/metrum/meter-status`.

### Lo que SÍ se confirmó en vivo (inspección real de un medidor de producción)

Los medidores (`devices.type='meter'`, protocolo **DLMS/COSEM**, modelos `dds23y-1p`
monofásico / `dtsy23-3p` trifásico) exponen en `SERVER_SCOPE`:

- `latch_state` / `latch_output`: `"close"` | `"open"` — el estado real del relé físico de
  corte. **Lectura siempre segura** (`getMeterLatchState()`).
- `command`: atributo por el cual Metrum despacha acciones al medidor. Se observó el valor
  `"updateCosem"` en un medidor real (o sea, el mecanismo de despacho existe y se usa para
  algo — pero no confirma qué valor específico dispara corte vs. reconexión).

### Lo que NO se confirmó (el gap real)

**El string exacto** (o el método RPC correcto) que hay que escribir en `command` para
disparar corte/reconexión remota. Escribir un valor adivinado contra un medidor de
producción podría cortarle la luz a un cliente real sin que sepamos si es reversible al
instante.

### Por eso: mockeado por defecto

`sendMeterCommand(metrumId, action)` con `action: 'disconnect' | 'reconnect'`:

1. Siempre lee primero el `latch_state` actual (real, no mock).
2. Si `METRUM_METER_CONTROL_LIVE !== 'true'` → devuelve `status: 'mocked'`, registra la
   intención (`would_send: { metrumId, action }`) pero **no llama a Metrum para escribir**.
3. Si está en modo live pero falta `METRUM_METER_DISCONNECT_COMMAND` /
   `METRUM_METER_RECONNECT_COMMAND` → sigue mockeado (`reason: 'missing_command_env'`).
4. Solo si las 3 env vars están seteadas, hace `setServerAttributes(token, metrumId, {
   command: commandValue })` de verdad → `status: 'sent'` (éxito de la llamada HTTP, **no**
   confirmación de que el relé cambió) o `status: 'failed'`.

Env vars: `METRUM_METER_CONTROL_LIVE`, `METRUM_METER_DISCONNECT_COMMAND`,
`METRUM_METER_RECONNECT_COMMAND` — ninguna está seteada en el entorno actual, por diseño,
hasta que se confirme el comando con Metrum.

### Auditoría — lo que se puede y no se puede saber después de un comando

- Todo intento (mockeado o real) queda registrado en `meter_control_commands` (migración
  63), incluyendo `latchStateAtSend`.
- `/api/rpc/persistent/...` y `/api/audit-logs/...` de ThingsBoard devuelven **404** con el
  nivel de permiso del usuario tenant actual → **no se puede** determinar desde el API de
  Metrum quién ejecutó un comando o si hay un log server-side del cambio de `command`.
- Alarmas reales observadas en el tenant, distintas entre sí:
  - **"Falla en la Conexión/Reconexión remota del suministro"** (MAJOR) — fallo de handshake
    al intentar el comando.
  - **"Desconexión remota del suministro"** (MAJOR) — el relé realmente se abrió.

### Cómo verificar el resultado de un intento, aunque el comando siga sin confirmar

Documentación oficial del fabricante (ver
[`08-eventos-y-estado-medidor.md`](./08-eventos-y-estado-medidor.md)) confirma que **todo
intento de corte/reconexión remota queda registrado como evento** en el timeseries
`event`/`metEvents` del medidor, con código:

- `cs` = Remote disconnection (desconexión remota exitosa)
- `rc` = Remote connection (reconexión remota exitosa)
- `drf` = Disconnect/Reconnect failure (el intento falló)

Y el timeseries `FlagStaProf` reporta `0` (normal) o `128` (interrupción de suministro) cada
15 min. Esto significa que, **aunque el string exacto del comando siga sin confirmarse**, sí
es posible verificar después de cualquier intento (mockeado no aplica, solo real) si
efectivamente surtió efecto — consultando `event`/`FlagStaProf` del medidor tras el intento,
en vez de depender solo de `latch_state`. Vale la pena incorporar esa verificación a
`sendMeterCommand()` cuando se retome el trabajo de confirmar el comando real.

### Próximo paso si se retoma esto

Contactar a Metrum/soporte de ThingsBoard de ese tenant y pedir explícitamente: el valor
exacto (o los valores) que va en `command` para abrir/cerrar el latch de un `dds23y-1p` /
`dtsy23-3p`, y si hay un RPC dedicado (`/api/rpc/twoway/{deviceId}` es el patrón estándar de
ThingsBoard para comandos device-to-cloud con confirmación — confirmado que la cuenta actual
NO tiene autorización para usarlo contra este tenant).

## 2. Control de inversores — API directa del fabricante (NO vía Metrum)

Importante: esto es un sistema **totalmente separado** de Metrum. Metrum es solo lectura
para inversores; para escribir parámetros (cos φ, potencia reactiva, límite de potencia
activa, modo de operación) hace falta hablar directo con la nube del fabricante.

Estado general: **infraestructura de la app lista** (endpoint `/api/inverter/command`, tabla
de auditoría `inverter_control_commands`, UI, clamping de rangos) — **faltan credenciales y
adaptadores confirmados** por fabricante. Guía completa y con más detalle operativo/
administrativo en [`../INTEGRACION_INVERSORES_API.md`](../INTEGRACION_INVERSORES_API.md);
acá el resumen técnico actualizado.

### Acciones previstas (4, clamped por rango)

| Acción | Parámetro | Rango |
|---|---|---|
| `set_power_factor` | cos φ | 0.80 – 1.00 |
| `set_reactive_power` | Q (kvar) | −10 a +10 |
| `set_active_power_limit` | P_max (kW) | 0 – 15 |
| `set_work_mode` | modo | Auto / Self-consumption / Selling First / Off-grid / Backup / PF Priority |

### DEYE Cloud (`src/lib/deye-cloud.ts`) — el más avanzado de los dos

**Lectura**: implementada y **verificada en vivo (2026-07-23)** contra la cuenta AMEA de
`davider@gdo.com.co`.

- **Auth real** (el comentario viejo sobre OAuth2 client_credentials estaba mal — era
  suposición sin verificar):
  ```
  POST {BASE_URL}/account/token?appId={appId}
  Body: { appSecret, email, companyId: "0", password: sha256_hex(password) }
  ```
  Devuelve JWT de ~60 días + `refreshToken`. Token se cachea en memoria de proceso 1h
  (conservador; las funciones serverless de todos modos se reinician frecuentemente).
- **Data center**: la cuenta AMEA autentica contra el cluster **US1**
  (`https://us1-developer.deyecloud.com/v1.0`), aunque el JWT trae `mdc:"am"` marcando el
  data center real internamente. **No existe** un subdominio `amea*-developer.deyecloud.com`
  (confirmado por DNS). Si se agrega una cuenta EU en el futuro, no asumir US1 a ciegas —
  probar `eu1-developer.deyecloud.com`.
- Env vars: `DEYE_APP_ID`, `DEYE_APP_SECRET`, `DEYE_ACCOUNT_EMAIL`, `DEYE_ACCOUNT_PASSWORD`
  (plano, se hashea en el cliente), `DEYE_BASE_URL` (opcional).
- Funciones de lectura implementadas: `listStations()`, `getStationDevices(stationIds)`,
  `getDeviceLatest(deviceSns)` (máx. 10 SN por lote — límite de la API).
- Mapeo a nuestra BD: cada `devices.id` necesita `devices.deye_device_sn` y
  `devices.deye_station_id` llenados **manualmente** (migración `53_deye_device_link.sql`) —
  no hay auto-discovery que cruce el inversor de Metrum con su equivalente en Deye Cloud.

**Casa real ya vinculada**: hay exactamente **1 casa** con el backfill hecho —
**Casa 18 - Porton de la Rivera** (`devices.id =
df378713-c8c6-40c7-8522-cb485d67c396`, `deye_device_sn = 2412240075`, `deye_station_id =
198565`), que coincide con el proyecto CRM `PORTÓN DE LA RIVERA-18`. Ninguna otra casa DEYE
tiene todavía `deye_device_sn`/`deye_station_id` llenos — si se conectan más, hay que repetir
el backfill a mano (o armar un endpoint que cruce por nombre/serial contra `station/device`
de todas las estaciones visibles).

**`/device/list` (listar TODOS los devices de la cuenta) NO funciona** con estas
credenciales — devuelve `"auth invalid token"` aunque el mismo token funciona en los demás
endpoints. La doc de la muestra dice que ese endpoint es "for **business members**",
probablemente requiere cuenta de organización en vez de personal (`companyId=0`). No es un
problema real para este proyecto: el `deviceSn` de cada inversor ya se conoce vía el cruce
manual con Metrum, así que `station/device` alcanza.

**Escritura (control)**: `sendDeyeCommand()` existe como firma de tipos pero **siempre
retorna `{ status: 'unavailable', reason: 'not_implemented' }`**. No se implementó porque:

1. El portal Deye Cloud solo mostraba **"Station Monitoring, Device Monitoring"** en Access
   Control de la App — no se confirmó que tenga permiso de **"Device Control"/"Order"**
   habilitado. Se intentó distinguir error-de-permiso vs. error-de-validación con un POST a
   `/order/sys/workMode/update` con un valor inválido a propósito (sin tocar el inversor
   real), pero el clasificador de seguridad del entorno bloqueó ese intento de prueba —
   sigue sin confirmar.
2. De las 4 `DeyeAction` previstas en `/api/inverter/command`, solo 2 tienen mapeo directo
   documentado en la API pública:
   - `set_work_mode` → `POST /order/sys/workMode/update` — listo para activar si se habilita
     permiso de control.
   - `set_active_power_limit` → `POST /order/sys/power/update` (`powerType:
     MAX_SELL_POWER|MAX_SOLAR_POWER`) — semántica **distinta** a "límite % de potencia
     activa", hay que revisar el mapeo antes de usarlo tal cual.
   - `set_power_factor` y `set_reactive_power` → **sin endpoint documentado** en la API
     pública. Requeriría `/order/customControl` (Modbus crudo) + el mapa de registros Modbus
     de DEYE, que no se ha obtenido (contactar `cloudservice@deye.com.cn`).

### Catálogo completo de endpoints de escritura DEYE (documentados, ninguno implementado)

Fuente: `github.com/DeyeCloudDevelopers/deye-openapi-client-sample-code` (repo oficial de
muestra, no el swagger público — ese es una SPA que no se puede leer por fetch directo).

| Acción | Endpoint | Body |
|---|---|---|
| Modo de trabajo | `POST /order/sys/workMode/update` | `{deviceSn, workMode: SELLING_FIRST\|ZERO_EXPORT_TO_LOAD\|ZERO_EXPORT_TO_CT}` |
| Límite de potencia | `POST /order/sys/power/update` | `{deviceSn, powerType: MAX_SELL_POWER\|MAX_SOLAR_POWER, value}` |
| Carga de batería on/off | `POST /order/battery/modeControl` | `{deviceSn, batteryModeType: GRID_CHARGE, action: on\|off}` |
| Corriente máx. de batería | `POST /order/battery/parameter/update` | `{deviceSn, paramterType: MAX_CHARGE_CURRENT\|MAX_DISCHARGE_CURRENT, value}` |
| Tipo de batería | `POST /order/battery/type/update` | `{deviceSn, batteryType: BATT_V\|BATT_SOC\|LI\|NO_BATTERY}` |
| Venta de excedentes | `POST /order/sys/solarSell/control` | `{deviceSn, action: on\|off}` |
| Horario TOU (time-of-use) | `POST /order/sys/tou/update` | `{deviceSn, timeUseSettingItems: [...]}` (array de 6 franjas) |
| Patrón de energía | `POST /order/sys/energyPattern/update` | `{deviceSn, energyPattern: BATTERY_FIRST\|LOAD_FIRST}` |
| Peak shaving de red | `POST /order/gridPeakShaving/control` | `{deviceSn, action: on\|off, power}` |
| **Estrategia dinámica** (agrupa varios) | `POST /strategy/dynamicControl` | combina workMode + TOU + solarSell + gridCharge en un solo request — **es un update parcial**, cualquier parámetro no enviado conserva su valor anterior |
| Modbus crudo | `POST /order/customControl` | `{deviceSn, content: <hex Modbus + CRC>, timeoutSeconds}` — requiere mapa de registros DEYE (no obtenido) |
| Estado de un comando | `GET /order/{orderId}` | **los comandos son asíncronos** — hay que pollear este endpoint hasta `status: 666` (éxito) antes de reportar el comando como aplicado |

Investigación completa del diseño (proceso, fuentes consultadas, hallazgos paso a paso):
`docs/superpowers/specs/2026-07-23-deye-cloud-api-design.md`.

### Livoltek Portal API (`https://api.livoltek-portal.com:8081/ess-api/index.html`)

**Nada implementado todavía** — ni lectura ni escritura. Menos pública que DEYE:

- Requiere contactar directamente a Livoltek (ventas/soporte Colombia) para solicitar
  "API integration"; posible acuerdo de uso a firmar.
- Los endpoints listados en `INTEGRACION_INVERSORES_API.md`
  (`/ess-api/v1/device/{sn}/parameter/power_factor`, etc.) son **suposiciones razonables**
  basadas en patrones REST comunes — **no confirmadas contra el swagger real**. Hay que
  abrir `https://api.livoltek-portal.com:8081/ess-api/index.html` y verificar antes de
  implementar cualquier cosa.
- Riesgo ya identificado: la cuenta de Metrum (`davider@gdo.com.co`) que se usa para LEER
  probablemente **no** tiene permisos de escritura — habría que pedir una cuenta "control"
  separada, tanto para Livoltek como posiblemente para DEYE.

### Plan de pruebas si se retoma la implementación (orden estricto, de `INTEGRACION_INVERSORES_API.md`)

1. Sandbox si el fabricante lo ofrece.
2. Implementar y probar solo lectura (`GET .../detail`) primero, para confirmar auth y que
   el SN existe en el cloud del fabricante.
3. Si hay un endpoint "simulate"/"query" sin efecto real, probar ahí antes de tocar un
   equipo.
4. Un solo inversor piloto real (ej. "Piloto Promigas"), un solo comando (ej. cos φ = 0.95).
5. Esperar ~30 min, verificar: el inversor sigue conectado, el medidor rojo refleja el fp
   más alto, no aparecieron flags de alarma (`alarm_FSVER`, `alarm_FEM`, etc.).
6. Rollout gradual — 1 casa/día durante 1 semana antes de tocar toda la flota.

Política de seguridad prevista una vez haya adaptador real: máx. 1 comando por inversor
cada 15 min, máx. 5 comandos en cola por hora globalmente, confirmar lectura post-comando en
el siguiente ciclo del lazo de 15 min, auto-rollback si aparece alarma tras el cambio, log
inmutable de `inverter_control_commands` (RLS que impide borrar).
