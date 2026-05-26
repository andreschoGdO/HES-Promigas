# Diccionario de variables Metrum (ThingsBoard)

Catálogo completo de lo que el conector de SUNNY APP extrae hoy de Metrum, agrupado por
tipo de dispositivo, con marcas de **cuáles capturamos y cuáles ignoramos**. Última
auditoría: 2026-05-26.

> Metrum corre sobre ThingsBoard. Cada dispositivo expone dos tipos de datos:
> - **Atributos** (`SERVER_SCOPE`): metadata estática/semi-estática del equipo (marca, modelo, casa, ubicación, parent gateway). Se leen con `/api/plugins/telemetry/DEVICE/{id}/values/attributes` o vía `entitiesQuery/find`.
> - **Timeseries** (`KEYS`): mediciones en el tiempo (corriente, energía, potencia). Se leen con `/api/plugins/telemetry/DEVICE/{id}/values/timeseries?keys=...`.

---

## 📡 Tipos de dispositivo en el sistema

28 casas × 4 dispositivos por casa = **112 dispositivos**.

| Tipo (`devices.type`) | Subtype (`devices.subtype`) | Cantidad | Naming pattern |
|---|---|---|---|
| `pulsar` | `gateway` | 28 | `IN42420XXX` (o `IN42420XXX(P)`) — modems Pulsar |
| `solar` | `meter_solar` | 28 | `2223005XXX` — Eastron, mide generación FV |
| `red` | `meter_red` | 28 | `2223005XXX` — Eastron, mide intercambio con red |
| `inverter` | `inverter` | 28 | `HP3XXK2HWC290XXX` (Livoltek) o `2412/2504XXXXXX` (DEYE) |

**No hay devices "battery" separados**: la información de batería está embebida en los
atributos y timeseries del inversor cuando este es híbrido con batería integrada (DEYE).
Los Livoltek HP3 con batería tendrían `BattSn` poblado, pero todos los Livoltek de la
flota actual tienen `BattSn: ""` (sin batería).

---

## 🛰️ Gateway / Pulsar (IN42420XXX)

### Atributos

| Key Metrum | Tipo | Capturado | Mapeo en BD | Descripción |
|---|---|---|---|---|
| `spcus` | string | ✅ | `devices.casa` / `devices.client` | Nombre de la casa: "Casa 2", "Casa 23p", "Piloto Promigas" |
| `spgwserie` | string | ✅ (como `cliente_id`) | `devices.cliente_id` | Serial del gateway = mismo que el name |
| `zone` | string | ✅ | `devices.location` | Conjunto residencial ("RESERVAS DE PANCE") |
| `city` | string | ✅ | `devices.city` | Ciudad ("CALI", "TURBACO") |
| `dept` | string | ❌ | _no se guarda_ | Departamento ("VALLE DEL CAUCA", "BOLIVAR") — **TODO** |
| `latDev` | string→num | ❌ | _no se guarda_ | Latitud GPS ("3.3197063") — **TODO** mapa |
| `lonDev` | string→num | ❌ | _no se guarda_ | Longitud GPS ("-76.5443757") — **TODO** mapa |
| `spdno` | string | ❌ | _no se guarda_ | Comercializador ("EMCALI") — **TODO** |
| `spcom` | string | ❌ | _no se guarda_ | Comercializador (alias) — **TODO** |
| `active` | bool | ✅ | `devices.is_active` | true = online |
| `lastActivityTime` | epoch ms | parcialmente | `devices.last_seen_at` | Última actividad |
| `lastConnectTime` | epoch ms | ❌ | _no se guarda_ | Último connect — **TODO** uptime real |
| `lastDisconnectTime` | epoch ms | ❌ | _no se guarda_ | Último disconnect — **TODO** alertas |
| `inactivityAlarmTime` | epoch ms | ❌ | _no se guarda_ | Trigger de alarma — **TODO** |
| `meter` | JSON string | ❌ | _no se guarda_ | **Importante**: lista los medidores hijos con credenciales (cipher, password, address). Solo informativo para auditar parentesco |
| `flagActivity` / `UIcolor*` | num | ❌ | _no se guarda_ | Flags internos del UI Metrum, no relevantes |
| `operation` | string | ❌ | _no se guarda_ | Último comando enviado ("getParameters") |

### Timeseries

El gateway **no produce timeseries propias** — actúa como router/agregador para los
3 dispositivos hijos. Solo el atributo `lastActivityTime` se actualiza con cada ping.

---

## ⚡ Medidor Solar (mettype=solar) y Medidor Red (mettype=red)

Ambos son Eastron DTSY23-3P trifásicos. Diferencia:
- **Solar** mide la generación del inversor → en una casa típica: `EAI` crece, `EAE` casi 0.
- **Red** mide intercambio con la red → `EAI` crece cuando se consume de la red, `EAE` crece cuando se exporta excedente.

### Atributos

| Key Metrum | Tipo | Capturado | Mapeo BD | Descripción |
|---|---|---|---|---|
| `mettype` | enum | ✅ | `devices.type` | "solar" o "red" |
| `model` | string | ✅ | `devices.modelo` | "dtsy23-3p" |
| `spcus` | string | ✅ | `devices.casa` | Nombre de la casa |
| `gateway` | string | ✅ | `devices.cliente_id` | Nombre del Pulsar padre |
| `zone`, `city`, `dept` | string | parcial | `location`, `city` | Igual al gateway |
| `address` | string | ❌ | _no se guarda_ | Dirección Modbus ("5620") — **TODO** debug |
| `ip`, `port` | string | ❌ | _no se guarda_ | Endpoint físico del medidor |
| `passwordAuthRead/Write`, `cipher`, `master` | string | ❌ | _no se guarda_ | Credenciales internas |
| `IU` | num | ❌ | _no se guarda_ | Constante TC corriente (10) |
| `VU` | num | ❌ | _no se guarda_ | Constante TT voltaje (120) |
| `profilesend` | string | ❌ | _no se guarda_ | Periodo de envío de profile |
| `active` | bool | ✅ | `devices.is_active` | Si Metrum recibe datos |
| `latch_*` (ai, ae, ri, re, state, output) | num/string | ❌ | _no se guarda_ | Snapshots de cierre del medidor (latch) — equivalentes a `Cenergy*` |
| `inactivityAlarmTime` | epoch ms | ❌ | _no se guarda_ | Trigger de alarma |
| `mapCategory` | num | ❌ | _no se guarda_ | UI map category |

### Timeseries (instantáneas y cumulativas)

| Key | Tipo | Frecuencia | Capturado | Descripción |
|---|---|---|---|---|
| `currentA` | A (float) | ~15 min | ✅ (vía `imax_a` en cron) | Corriente RMS fase A |
| `currentB` | A (float) | ~15 min | ✅ (vía `imax_a`) | Corriente RMS fase B |
| `currentC` | A (float) | ~15 min | ✅ (vía `imax_a`) | Corriente RMS fase C |
| `powerAI` | W | ~15 min | ❌ | Potencia activa importada instantánea — **TODO** monitoreo en vivo |
| `powerRI` | var | ~15 min | ❌ | Potencia reactiva importada instantánea — **TODO** fp en vivo |
| `energyAI` | Wh | ~15 min | ❌ | Energía activa importada cumulativa (instantánea) |
| `energyRI` | varh | ~15 min | ❌ | Energía reactiva importada cumulativa (instantánea) |
| `CenergyAI` | Wh | **diario 00:00 COT** | ✅ | **Cierre diario** energía activa importada — base del cierre diario |
| `CenergyAE` | Wh | **diario 00:00 COT** | ✅ | Cierre diario energía activa exportada |
| `CenergyRI` | varh | **diario 00:00 COT** | ✅ | Cierre diario energía reactiva importada (la que causa penalización CREG) |
| `CenergyRE` | varh | **diario 00:00 COT** | ✅ | Cierre diario energía reactiva exportada |
| `CenergyAIphA/B/C/S` | Wh | diario | ❌ | EAI por fase + suma — **solo en meter_red** para diagnóstico de desbalance |
| `CenergyAEphA/B/C/S` | Wh | diario | ❌ | EAE por fase + suma — solo en meter_red |

---

## ☀️ Inversor (HP3* Livoltek o 2412/2504* DEYE)

### Atributos comunes

| Key Metrum | Tipo | Capturado | Mapeo BD | Descripción |
|---|---|---|---|---|
| `spcus` | string | ✅ | `devices.casa` | Casa donde está el inversor |
| `gateway` | string | ✅ | `devices.cliente_id` | Pulsar padre |
| `zone`, `city`, `dept` | string | parcial | `location`, `city` | Ubicación |
| `active` | bool | ✅ | `devices.is_active` | Si recibe datos |
| `inactivityAlarmTime` | epoch ms | ❌ | _no se guarda_ | **TODO** alarmas |
| `mapCategory` | num | ❌ | _no se guarda_ | UI |

### Atributos específicos **Livoltek** (HP3-10KL2 / HP3-15KL2)

| Key | Tipo | Capturado | Mapeo BD | Descripción |
|---|---|---|---|---|
| `invbrand` | string | ✅ | `devices.marca` = "LIVOLTEK" | Marca del inversor |
| `invmodel` | string | ✅ | `devices.modelo` | Modelo ("LIVOTEK HP3-10KL2") |
| `invcap` | num | ✅ | `devices.potencia_kw` | Capacidad nominal kW (10 ó 15) |
| `invarray` | num | ❌ | _no se guarda_ | Número de paneles (5) — **TODO** para yield específico por panel |
| `invtype` | string | ❌ | _no se guarda_ | "Hibrido" / "On-Grid" — **TODO** filtros |
| `BattSn` | string | ❌ | _no se guarda_ | Serial batería (vacío en flota actual) |
| `command` | string | ❌ | _no se guarda_ | Último comando |
| `flagEMayor/EMenor/EAM/ECEO/EPSR/ETA/ESSI` | num | ❌ | _no se guarda_ | **ALARMAS de energía** — TODO crítico, ver sección Alertas |
| `flagFSVER/FSCER/FBVER/FAFER/FEM/FFT/FFDC/FFB/FFCT` | num | ❌ | _no se guarda_ | **ALARMAS de falla** — TODO crítico |
| `flagFFM`, `flagFLM`, `flagFG`, etc. | num | ❌ | _no se guarda_ | Flags adicionales |
| `UIcolorRojo/Amarillo/Naranja` | num | ❌ | _no se guarda_ | Estados de color UI (1 = activo) |
| `ts_mask_save`, `mask_save` | num/hex | ❌ | _no se guarda_ | Internos de Metrum |

### Atributos específicos **DEYE** (SUN-15K-SG01HP3 HV trifásico, etc.)

| Key | Tipo | Capturado | Mapeo BD | Descripción |
|---|---|---|---|---|
| `invbrand` | string | ❌ (inferido) | `devices.marca` = "DEYE" (vía pattern matching) | DEYE no setea `invbrand`, lo inferimos por nombre numérico |
| `invmodel` | string | ✅ | `devices.modelo` | "SUN-15K-SG01HP3 HV trifásico" |
| `invcap` | num | ✅ | `devices.potencia_kw` | Capacidad kW (algunos en null — bug Metrum) |
| `TLinvstate` | string | ❌ | _no se guarda_ | **"on" / "off"** — estado del inversor — **TODO** crítico |
| `TLBattSOC` | num 0-100 | ❌ | _no se guarda_ | **State of Charge batería %** — **TODO** crítico (DEYE tiene batería) |
| `TLpowerAE` | W | ❌ | _no se guarda_ | Potencia activa exportada instantánea |
| `TLenergyAE` | Wh | ❌ | _no se guarda_ | Energía AE acumulada instantánea |
| `BattSn` | string | ❌ | _no se guarda_ | Serial batería (DEYE tiene poblado, ej "2412240078M01") |
| `telemetrycreated` | bool | ❌ | _no se guarda_ | Si la entidad telemetría existe |
| `ts_mask_save`, `mask_save` | num/hex | ❌ | _no se guarda_ | Internos |
| `flagEMayor/EMenor` | num | ❌ | _no se guarda_ | Alarmas energía DEYE |

**🔋 Variables de batería potencialmente disponibles y no probadas** (pendiente verificar cuando se restaure el acceso a Metrum):

| Key esperada | Esperado | Por qué |
|---|---|---|
| `TLBattSOH` | num | State of Health % (degradación) |
| `TLBattV` | V | Voltaje del banco de batería |
| `TLBattI` | A | Corriente de batería (positiva = carga, negativa = descarga) |
| `TLBattT` | °C | Temperatura batería |
| `TLBattPower` | W | Potencia carga/descarga |
| `TLBattCycles` | num | Ciclos completos de carga |
| `TLBattEnergyIn` | Wh | Energía cumulativa cargada a batería |
| `TLBattEnergyOut` | Wh | Energía cumulativa descargada de batería |

> Para confirmar: hacer `GET /api/plugins/telemetry/DEVICE/{deye_id}/keys/timeseries` y filtrar
> resultados que empiecen con `TLBatt` o `Batt`. La documentación oficial DEYE indica que el
> inversor publica todos estos vía MQTT/Modbus, queda validar qué subset Metrum sí está
> exponiendo.

### Timeseries comunes (instantáneas y cumulativas)

| Key | Tipo | Frecuencia | Capturado | Descripción |
|---|---|---|---|---|
| `currentA` | A | ~15 min | ✅ (`imax_a`) | Corriente salida fase A |
| `currentB` | A | ~15 min | ✅ (`imax_a`) | Corriente salida fase B |
| `currentC` | A | ~15 min | ✅ (`imax_a`) | Corriente salida fase C |
| `CenergyAE` | Wh | **diario 00:00 COT** | ✅ | **Generación acumulada diaria** — base de `generacion_wh` |
| `energyID` | Wh | ~15 min | ❌ | Energía día actual instantánea — **TODO** dashboard en vivo |
| `energyIT` | Wh | ~15 min | ❌ | Energía total acumulada instantánea — **TODO** |

> Si el inversor tiene MPPT múltiples, Livoltek y DEYE suelen publicar también `pv1Voltage`,
> `pv1Current`, `pv2Voltage`, `pv2Current`, etc. **Pendiente probar** estas keys.

---

## 📊 Resumen por importancia

### Críticas y capturadas hoy

- Identificación: `name`, `spcus` → casa, `gateway` → padre
- Subtipo: `mettype` (solar/red)
- Ubicación: `zone`, `city`
- Estado: `active`, `lastActivityTime`
- Activos: `invbrand`, `invmodel`, `invcap`, `model`
- Cierres diarios: `CenergyAI/AE/RI/RE` (meters), `CenergyAE` (inverter)
- Corriente para Imax: `currentA/B/C`

### Críticas y **NO capturadas** (gaps importantes)

🚨 **Alarmas de inversor Livoltek**: `flagEMayor`, `flagEMenor`, `flagEAM`, `flagECEO`, `flagEPSR`, `flagETA`, `flagESSI`, `flagFSVER`, `flagFSCER`, `flagFEM`, `flagFFT`, `flagFFDC`, `flagFBVER`, `flagFAFER`, `flagFFCT`, `flagFFB`. Cada uno corresponde a un tipo de falla (sobrevoltaje, subvoltaje, sobre-temperatura, etc.). Sin esto el inversor puede estar en alarma y no nos damos cuenta.

🚨 **Estado en vivo DEYE**: `TLinvstate` (on/off), `TLBattSOC` (carga batería), `TLpowerAE` (potencia actual). Imprescindibles para monitoreo en tiempo real de inversores DEYE.

🟡 **Per-fase del medidor red**: `CenergyAIphA/B/C/S` — útil para detectar desbalance de fases que también puede llevar a penalización o trip del breaker.

🟡 **Potencia instantánea**: `powerAI`, `powerRI` en medidores → permite control de demanda en tiempo real (alerta si pico > breaker rating, ej 80 A).

🟢 **Metadata extra**: `dept`, `latDev`/`lonDev`, `spdno` → para mapa GPS y dashboards por departamento/comercializador.

---

## 🎯 Sugerencias para el roadmap

Ordenadas por impacto:

1. **Capturar todos los `flag*` de Livoltek e iguales en DEYE** y crear alertas tipo "Inversor en falla" — máximo impacto, alarma temprana de equipos
2. **Capturar `TLBattSOC`, `TLBattSOH`, `TLBattV`, `TLBattI`** de DEYE — visibilidad real del estado del banco
3. **Capturar `powerAI` instantáneo del meter rojo** — base para alertas de pico de demanda (ej "Casa 10 superando 80 A")
4. **Capturar `CenergyAIphA/B/C`** del meter rojo — detección de desbalance entre fases
5. **Capturar `latDev`/`lonDev`** del gateway — mapa interactivo del portafolio
