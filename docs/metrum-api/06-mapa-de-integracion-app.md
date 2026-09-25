# Mapa de integración — dónde vive cada cosa en el código

Todos los paths son relativos a `webapp/`.

## Cliente de bajo nivel

| Archivo | Qué hace |
|---|---|
| `src/lib/metrum-api.ts` | Cliente único de la REST API de Metrum/ThingsBoard — login, listar devices, timeseries, atributos, cierre diario. Ver [`01-auth-y-cliente.md`](./01-auth-y-cliente.md) |
| `src/lib/metrum-meter-control.ts` | Corte/reconexión de medidor (mockeado por defecto) |
| `src/lib/device-option.ts` | Interfaz compartida `DeviceOption` para selectores de UI |
| `src/lib/classify-device.ts` | Heurística de tipo de dispositivo por convención de nombre |
| `src/lib/variables-dict.ts` | Diccionario completo de variables — fuente de [`03-diccionario-variables.md`](./03-diccionario-variables.md) |
| `src/lib/alert-variables.ts` | Catálogo de variables normalizadas para el motor de alertas (`ALERT_VARIABLES`) |
| `src/lib/curtailment.ts` | Cálculo de curtailment DC — ver [`04-metricas-derivadas.md`](./04-metricas-derivadas.md) |
| `src/lib/deye-cloud.ts` | Adaptador separado a la API directa de DEYE (no pasa por Metrum) |

## Rutas API propias (wrappers finos sobre el cliente)

| Ruta | Qué expone |
|---|---|
| `src/app/api/metrum/devices/route.ts` | Lista dispositivos desde Metrum en vivo |
| `src/app/api/metrum/keys/route.ts` | Lista timeseries keys disponibles de una entidad puntual |
| `src/app/api/metrum/timeseries/route.ts` | Históricos de timeseries de una entidad |
| `src/app/api/metrum/meter-status/route.ts` | Lee `latch_state`/`latch_output` de un medidor (solo lectura) |
| `src/app/api/metrum/meter-command/route.ts` | Envía (o mockea) corte/reconexión de medidor |
| `src/app/api/devices/sync/route.ts` | Sincroniza Metrum → tabla `devices` (upsert por `metrum_id`) — ver [`02-dispositivos-y-jerarquia.md`](./02-dispositivos-y-jerarquia.md) |
| `src/app/api/debug/inspect-keys/route.ts` | Utilidad de debug para inspeccionar keys crudas de una entidad (usada para confirmar convenciones como el signo de `BattPower` en DEYE) |
| `src/app/api/inverter/command/route.ts` | Endpoint de control de inversor — hoy registra en `inverter_control_commands` con status `mocked`, pendiente de adaptador real (ver [`05-control-remoto.md`](./05-control-remoto.md)) |

## Cron jobs / sincronización periódica

| Ruta | Frecuencia | Qué hace |
|---|---|---|
| `src/app/api/cron/sync/route.ts` | 1×/día (06:00 UTC = 01:00 COT) | Orquesta: `devices/sync` → `houses/build` → `sync/all` (cierres diarios) → `sync/consumption` → cómputo de `daily_casa_metrics` → `alerts/evaluate` (reglas diarias) |
| `src/app/api/cron/instant-check/route.ts` | cada 15 min (GitHub Actions) | Lee `currentA/B/C`, `powerAI/RI`, `TLBattSOC`, `TLinvstate` de las últimas 2 ventanas de 15 min por casa; calcula `cos_phi_now`, `fase_imbalance_pct`; upsert en `instant_metrics`; dispara `alerts/evaluate` (reglas instantáneas). Auth: header `Authorization: Bearer {CRON_SECRET}` |
| `src/app/api/cron/compute-curtailment/route.ts` | periódico | Corre `computeCurtailmentByDay` y persiste en `daily_curtailment_by_house` |
| `src/app/api/sync/all/route.ts` | parte del cron diario | Cierres diarios (`Cenergy*`) por dispositivo |
| `src/app/api/sync/consumption/route.ts` | parte del cron diario | Consumo diario derivado |
| `src/app/api/houses/build/route.ts` | parte del cron diario | Construye/actualiza `client_houses` agrupando `devices` |

## Tablas Supabase relevantes

| Tabla | Rol |
|---|---|
| `devices` | Cache local del árbol de entidades Metrum (1 fila por `metrum_id`). Extendida por muchas migraciones: `alarm_flags` (04), voltaje (08), `deye_device_sn`/`deye_station_id` (53) |
| `client_houses` | Agrupación de `devices` por casa/cliente |
| `daily_energy_closures` | Cierres diarios de energía (de `00_schema.sql`) |
| `daily_consumption` / `daily_casa_metrics` | Agregados diarios calculados — base de [`03-diccionario-variables.md`](./03-diccionario-variables.md) sección 1 |
| `instant_metrics` | Muestras del lazo de 15 min (migración 04) |
| `daily_curtailment_by_house` | Cache de curtailment por casa-día (usada por `/api/nar/curtailment`) |
| `alert_rules` | Reglas de alerta seedeadas, con `scope` (all / casa específica) y umbrales — ver `04_alarms.sql`, `08_voltage.sql` |
| `meter_control_commands` | Auditoría de todo intento de corte/reconexión (migración 63) |
| `inverter_control_commands` | Auditoría de intentos de control de inversor |
| `integration_config` | Config de integración — seed incluye `metrum_api_url` y un email histórico de usuario Metrum (`00_schema.sql`) |
| `solar_irradiance_cache` | Cache de GHI por ciudad/fecha/hora desde Open-Meteo, usado en `envelope_dc_*` y curtailment |

## Componentes UI

| Componente | Rol |
|---|---|
| `src/components/MeterControlPanel.tsx` | UI de corte/reconexión de medidor — lee `latch_state` en vivo, confirma con modal antes de enviar, muestra historial de `meter-command` |
| (control de inversor) | Buscar por referencias a `/api/inverter/command` — no hay un `InverterControlPanel.tsx` dedicado confirmado en esta pasada; verificar en el código actual antes de asumir su existencia |

## Documentos previos en `webapp/docs/` (complementarios, no reemplazados)

- [`../METRUM_VARIABLES.md`](../METRUM_VARIABLES.md) — auditoría de qué se captura vs. no en
  la sync a Supabase (2026-05-26, algo desactualizado: los `flag*` de alarma SÍ se capturan
  hoy, ver `devices/sync/route.ts`).
- [`../INTEGRACION_INVERSORES_API.md`](../INTEGRACION_INVERSORES_API.md) — guía de
  implementación paso a paso para activar control real de inversores.
- [`../INSTANTANEAS_Y_CONTROL.md`](../INSTANTANEAS_Y_CONTROL.md) — diseño del lazo de 15 min
  (ya implementado, este doc es el "por qué" original).
- [`../PROYECTO_OVERVIEW.md`](../PROYECTO_OVERVIEW.md) — contexto general del proyecto, no
  específico de Metrum.
- `docs/superpowers/specs/2026-07-23-deye-cloud-api-design.md` — investigación detallada de
  Deye Cloud (auth, data center, qué se probó).
