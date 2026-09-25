# Dispositivos y jerarquía

## Estructura por casa

Cada casa del piloto tiene (típicamente) **4 dispositivos** en Metrum:

```
Gateway Pulsar (IN42420XXX)          ← "router" lógico, agrupa lo demás, sin timeseries propia
  ├─ Medidor solar   (mettype=solar) ← mide generación del inversor
  ├─ Medidor red     (mettype=red)   ← mide intercambio con la red (import/export)
  └─ Inversor        (HP* o 8 dígitos numéricos) ← Livoltek o DEYE
```

No hay dispositivo "batería" separado: cuando el inversor es híbrido con batería integrada
(caso DEYE), la info de batería viene embebida en los atributos/timeseries del propio
inversor (`TLBattSOC`, `BattPower`, etc.). Los Livoltek HP3 de la flota actual no tienen
batería (`BattSn` vacío).

## Convenciones de nombre (cómo se identifica el tipo sin atributo explícito)

De `src/lib/classify-device.ts` (25 líneas, función `classifyDevice()`):

| Patrón de `name` | Tipo inferido |
|---|---|
| `^IN\d+` | Gateway Pulsar |
| `^HP` (case-insensitive) | Inversor **Livoltek** |
| `^(24\|25)\d{8}$` (8 dígitos, empieza con año 24 o 25) | Inversor **DEYE** |
| Numérico que empieza `2223005...` | Medidor Eastron (solar o red — distinguir por `mettype`, NO por el nombre) |

Importante: los medidores Eastron y los inversores DEYE son AMBOS numéricos — la única
forma confiable de no confundirlos es que los DEYE son de 8 dígitos y empiezan por `24`/`25`
(año de fabricación), mientras los medidores Eastron son de 10 dígitos y empiezan por
`2223005`.

## Cómo se sincroniza a Supabase (cache local)

`devices` es una tabla que actúa como **cache local del árbol de entidades de Metrum**,
para no tener que pegarle a `entitiesQuery/find` en cada request de la app. Se llena/actualiza
vía:

```
GET /api/devices/sync   (src/app/api/devices/sync/route.ts)
```

Lógica de esa ruta (relevante para entender qué campos de Metrum sí terminan en la BD y
cómo se derivan):

- `metrum_id` = `entityId.id` de ThingsBoard — **la clave de upsert** (`onConflict:
  'metrum_id'`), nunca cambia aunque cambien otros atributos.
- `type`: prioriza el atributo real `mettype`; si no existe, infiere por nombre
  (`classifyDevice`-like heurística inline: `IN\d+` → `pulsar`, patrón inversor → `inverter`,
  cualquier otra cosa → `pulsar` como fallback, asumiendo que en este inventario todo lo que
  no es inversor ni medidor es gateway).
- `casa`/`client`: del atributo `spcus` (ej. `"Casa 2"`, `"Casa 23p"`, `"Piloto Promigas"`).
- `cliente_id`: prioriza atributos tipo `customerId`/`casa_id`, si no existen cae al nombre
  del gateway padre (`gateway`/`spgwserie`) — el Pulsar actúa como agrupador lógico.
- `marca`: atributo `invbrand` si existe (Livoltek lo setea: `"LIVOLTEK"`); si no existe y el
  nombre matchea patrón de inversor, se infiere: `HP*` → `LIVOLTEK`, numérico de 8+ dígitos →
  `DEYE`. **DEYE no setea `invbrand` en Metrum** — siempre se infiere por nombre.
- `alarm_flags` (jsonb): captura TODAS las flags de alarma conocidas (lista completa en
  [`03-diccionario-variables.md`](./03-diccionario-variables.md)) más `TLinvstate` (estado
  on/off del inversor DEYE, normalizado a minúsculas + un booleano derivado
  `TLinvstate_off`) y `TLBattSOC` (SOC de batería DEYE, si es numérico válido).
- `is_active`: del atributo `active` — **ver limitaciones**, este campo es poco confiable.

### Lista negra de entidades excluidas (`EXCLUDED_METRUM_IDS`)

El sync tiene un `Set` hardcodeado de `metrum_id`s que existen en Metrum pero **no
representan equipo activo hoy** (inversores Livoltek viejos reemplazados por DEYE, un
medidor solar duplicado). Si se escribe código nuevo que lista dispositivos directo desde
Metrum (sin pasar por la tabla `devices`), hay que replicar este filtro o se van a contar
equipos fantasma. La lista vive solo en `devices/sync/route.ts` — no está en ninguna tabla
de config, es puramente código con comentarios explicando cada exclusión.

## `client_houses` — agrupación por casa/cliente

Tabla aparte que agrupa los `devices` por casa/cliente para las vistas de dashboard
(construida por `/api/houses/build`, no leída en detalle en esta pasada — revisar ese
archivo si un skill necesita el mapeo exacto `casa → house_id`).

## Livoltek vs. DEYE — diferencias operativas clave

| | **Livoltek** (HP3 series) | **DEYE** (SUN-*-SG01HP3 / SUN-6K-SG04LP3) |
|---|---|---|
| Naming | `HP310K2HW...` (10kW), `HP315K2HW...` (15kW). Sufijo `_LV` en keys = "Livoltek", **NO** "low voltage" | Serial numérico 8 dígitos con prefijo de año (`24`/`25`). Sufijo `_DY` en keys |
| DC por string | **No expone** `Ppv1/Ppv2/Vpv1` etc. — hay que inferir DC vía balance de energía | Similarmente limitado según variable; DC se infiere igual vía `powerAPg ± BattPower` |
| cos φ / potencia reactiva | Expone (usado en `sacrificio_ac_LIV`) | **No expone** cos φ ni potencia reactiva por variable directa |
| BMS / estado batería operacional | No aplica (sin batería en la flota actual) | **No expone** estado operacional detallado del BMS, solo SOC (`TLBattSOC`) |
| Corrientes EPS por fase | — | **No expone** corrientes EPS por fase |
| Convención de signo `BattPower` | — | **Positivo = descarga, negativo = carga** (verificado en vivo vía `/api/debug/inspect-keys` en Casa 74: `BattPower = -4190 W` con batería cargando de día) — es la convención OPUESTA a lo que uno asumiría intuitivamente |

Ambas limitaciones (Livoltek sin DC-por-string, DEYE sin cos φ) son la razón de que existan
las métricas derivadas `Pdc_LIV`/`Pdc_DEY` — ver
[`04-metricas-derivadas.md`](./04-metricas-derivadas.md).

## Deye Cloud — una integración PARALELA y distinta (no confundir con Metrum)

`src/lib/deye-cloud.ts` es un adaptador aparte que habla directo con la **API propia del
fabricante DEYE** (`https://developer.deyecloud.com`), no con Metrum/ThingsBoard. Se usa
para leer estaciones/dispositivos DEYE con más detalle del que Metrum expone. Ver
[`05-control-remoto.md`](./05-control-remoto.md) para el estado completo (auth, qué está
implementado, qué falta).

Vínculo con `devices`: requiere llenar manualmente `devices.deye_device_sn` y
`devices.deye_station_id` (migración `53_deye_device_link.sql`) — no hay auto-discovery que
cruce el inversor de Metrum con su equivalente en Deye Cloud, es un mapeo manual por casa.
