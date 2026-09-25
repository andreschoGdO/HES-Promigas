# Diccionario de variables

Fuente completa y autoritativa: `webapp/src/lib/variables-dict.ts` (1082 líneas, exporta
`VARIABLES: VariableMeta[]` con `{ key, label, unit, description, source, category }`). Este
archivo es un **resumen navegable** de esa fuente — para el texto completo de cualquier
descripción, buscar la `key` ahí. También complementa
[`../METRUM_VARIABLES.md`](../METRUM_VARIABLES.md) (foco en qué se captura vs. no en la
sync a Supabase) y [`../INSTANTANEAS_Y_CONTROL.md`](../INSTANTANEAS_Y_CONTROL.md) (foco en
frecuencia de refresco).

`source` de cada variable es uno de:
- **`metrum`** — key/atributo real que Metrum expone tal cual.
- **`derived`** — la app la calcula a partir de una o más keys de Metrum.
- **`closure`** — viene del cierre diario (`Cenergy*`).

## 1. Métricas diarias por casa (tabla `daily_casa_metrics`, todas `derived`)

| Key | Unidad | Fórmula / significado |
|---|---|---|
| `generacion_wh` | Wh | Δ `CenergyAE` del inversor (hoy − ayer) |
| `importacion_wh` | Wh | Δ `CenergyAI` del medidor rojo |
| `excedentes_wh` | Wh | Δ `CenergyAE` del medidor rojo |
| `demanda_wh` | Wh | `generacion_wh + importacion_wh − excedentes_wh` |
| `gen_dem_pct` | % | `generacion_wh / demanda_wh × 100` — autosuficiencia |
| `exc_gen_pct` | % | `excedentes_wh / generacion_wh × 100` — qué tanto de lo generado se exportó |
| `imp_dem_pct` | % | `importacion_wh / demanda_wh × 100` — complemento de autosuficiencia |
| `yield_real` | kWh/kWp | `generacion_wh / potencia_kw`. Referencia teórica Cali: **4.5 kWh/kWp/día** |
| `desempeno_pct` | % | Performance Ratio = `yield_real / 4.5 × 100`. >80% excelente, <60% intervenir |
| `imax_a` | A | Máximo del día entre `currentA/B/C` de inversor y medidor rojo |
| `potencia_kw` | kWp | Σ `invcap` de los inversores de la casa |

## 2. Medidores (STAR DDSY23S/DTSY23S) — `metrum`/`closure`

Cada casa tiene **medidor solar** (`mettype=solar`, mide salida del sistema solar) y
**medidor rojo** (`mettype=red`, mide intercambio con la red).

| Key | Unidad | Tipo | Significado |
|---|---|---|---|
| `CenergyAI` | Wh | closure | Energía activa importada, cierre diario 00:00 COT (odómetro) |
| `CenergyAE` | Wh | closure | Energía activa exportada, cierre diario. En medidor solar = generación |
| `CenergyRI` | varh | closure | Reactiva inductiva cumulativa — la que penaliza CREG si >50% de `CenergyAI` |
| `CenergyRE` | varh | closure | Reactiva capacitiva cumulativa — no penaliza |
| `energyAI` | Wh | metrum | Importada del último intervalo (~15 min) — **ventana, no acumulado**, no usar para totales diarios |
| `energyRI` | varh | metrum | Reactiva inductiva del último intervalo |
| `currentA/B/C` | A | metrum | Corriente instantánea por fase (~15 min) |
| `powerAI` | W | metrum | Potencia activa instantánea (import en medidor rojo, generación AC en medidor solar) |
| `powerRI` | var | metrum | Potencia reactiva instantánea |

## 3. Inversor Livoltek (HP3-*) — sufijo `_LV` = fabricante Livoltek, NO "low voltage"

**No expone** potencia/voltaje/corriente DC por string (`Ppv*`, `Vpv*` no existen en la
telemetría real de Livoltek pese a estar catalogados como "genéricos" — ver sección 6).

| Key | Unidad | Significado |
|---|---|---|
| `powerAEg` | W | Potencia activa hacia red — más cercano a "AC output" |
| `powerAPg` | W | Potencia activa generada total = PV + aporte batería (usado en fórmulas `Pdc_*`) |
| `powerAE` | W | Potencia activa exportada (post pérdidas internas) |
| `powerAEgdc_LV` | W | **Potencia DC equivalente** calculada por el inversor — mejor aproximación a "desde paneles" sin medición real por string |
| `powerREg_LV` | var | Potencia reactiva del inversor — variable objetivo de `set_reactive_power` |
| `powerPFg_LV` | — | cos φ instantáneo (-1 a +1). CREG exige ≥0.9 |
| `currentA/B/C` | A | Corriente AC general (combinada) |
| `curGridA/B/C` | A | Corriente en puerto **Grid** (hacia/desde red) |
| `curEpsA/B/C_LV` | A | Corriente en puerto **EPS/Backup** (cargas críticas) |
| `voltageA/B/C` | V | Voltaje AC general |
| `voltGridA/B/C` | V | Voltaje en puerto Grid (nominal ~120V en 120/208) |
| `voltEpsA/B/C` | V | Voltaje en puerto EPS — cuando forma isla, es el voltaje SINTETIZADO por el inversor |
| `frequency` | Hz | Frecuencia Grid (nominal Colombia 60±0.5) |
| `freqEps` | Hz | Frecuencia en puerto EPS/Backup |
| `energyED`/`energyET` | Wh | Exportada día / total acumulado |
| `energyID`/`energyIT` | Wh | Importada día / total acumulado |
| `energyPD` | Wh | **Generación PV del día** (DC, antes de conversión) — mejor métrica "cuánto generaron los paneles hoy" |
| `energyLD`/`energyLT` | Wh | Consumo de cargas día / total |
| `ExportGrid_LV` | W | Potencia exportada a red ahora — 0 = todo va a autoconsumo/batería |
| `LoadPower_LV` | W | Potencia a cargas — demanda real instantánea |
| `BattPower` | W | Potencia neta batería. **Convención Livoltek: positivo=descarga, negativo=carga** |
| `BattCur`, `BattVolt`, `BattSOC`, `BattSOH`, `BattTemp` | A/V/%/%/°C | Telemetría de batería (HV típico 150-500V) |
| `BattStateOp_LV` | — | `charging`/`discharging`/`idle`/`standby` (puede desfasarse del signo de `BattCur`) |
| `BattState_LV` | — | `online`/`offline` — comunicación con el BMS |
| `BattCapAH_LV`, `BattCharges_LV` | Ah, # | Capacidad nominal, ciclos acumulados (LiFePO4 ~6000 ciclos a 80% SOH) |
| `invstate` | — | `on`/`off` del inversor |
| `invrun` | — | `normal`/`backup`(isla)/`fault`/`standby` |
| `activityState` | — | `succesful` (sic, typo real del firmware) = telemetría llegando bien al Pulsar |
| `MeterState_LV` | — | `online`/`offline` de los CT clamps internos |
| `platts`, `DCts` | ms | Timestamps de plataforma / último cierre diario |

## 4. Inversor DEYE (SUN-*-SG01HP3 / SUN-6K-SG04LP3) — sufijo `_DY`

Comparte la mayoría de keys genéricas de la sección 3 (`powerAEg`, `currentA/B/C`,
`voltageA/B/C`, `frequency`, `energyPD`, `BattSOC`, `invstate`, etc.) con las mismas
descripciones. **DEYE NO expone**: cos φ / reactiva (`powerREg_LV`, `powerPFg_LV` no
existen), potencia DC equivalente (`powerAEgdc_LV` no existe — por eso `Pdc_DEY` es la
única forma de ver DC), corrientes EPS por fase, ni estado operativo BMS detallado.

| Key | Unidad | Significado |
|---|---|---|
| `BattCapAH_DY`, `BattCharges_DY` | Ah, # | Equivalentes DEYE de los `_LV` |
| `ExportGrid_DY` | W | Equivalente DEYE de `ExportGrid_LV` |
| `LoadPower_DY` | W | Equivalente DEYE de `LoadPower_LV` |
| `MeterState_DY` | — | `ct` (normal, CT clamps leyendo) / `offline` — **nombres distintos** a `MeterState_LV` (`online`/`offline`) |
| `TLinvstate` | — | Estado on/off del inversor DEYE |
| `TLBattSOC` | % | SOC de batería DEYE — ciclar recomendado entre ~20% y ~90% |

## 5. Keys calculadas por la app (`derived`, no vienen de Metrum)

Estas dependen de la telemetría de la sección 3/4 más el cache de irradiancia
(`solar_irradiance_cache`, poblado desde Open-Meteo para 10 ciudades: Cali, Bogotá,
Medellín, Barranquilla, Cartagena, Bucaramanga, Pereira, Manizales, Ibagué, Cúcuta).

| Key | Unidad | Marca | Fórmula |
|---|---|---|---|
| `Pdc_LIV` | W | Livoltek | `powerAPg + BattPower` (convención: BattPower>0=carga, <0=descarga — **verificar el signo graficando contra `powerAEgdc_LV`**) |
| `Pdc_DEY` | W | DEYE | `powerAPg − BattPower` — convención DEYE **opuesta** a Livoltek (verificado en vivo: `BattPower=-4190W` en Casa 74 con batería cargando de día) — única forma de ver DC en DEYE |
| `envelope_dc_LIV` | W | Livoltek | `P95(powerAEgdc_LV, hora) × [GHI_real(t) / P95(GHI, hora)]` — "techo solar" ajustado por irradiancia real |
| `envelope_dc_LIV_est` / `envelope_dc_DEY` | W | ambas | Igual que `envelope_dc_LIV` pero usando `Pdc_LIV`/`Pdc_DEY` como base (para DEYE es la única opción) |
| `curtailment_dc_LIV` / `curtailment_dc_DEY` | W | respectiva | `max(0, envelope − DC_real)`, solo activo si `BattSOC≥95` AND `\|ExportGrid\|<100W` AND hora local 6-18 |
| `curtailment_kwh_LIV` / `curtailment_kwh_DEY` | kWh | respectiva | Integral acumulada del curtailment instantáneo en el rango visible |
| `sacrificio_ac_LIV` | W | Livoltek | `max(0, envelope(powerAEg) − powerAEg)` cuando `\|powerREg_LV\|>200var` — activa "sacrificada" por estar entregando reactiva cerca del límite de potencia aparente del inversor |

Ver la fórmula operativa completa (con gates, cap de huecos, persistencia) en
[`04-metricas-derivadas.md`](./04-metricas-derivadas.md), que documenta la implementación
real en `src/lib/curtailment.ts`.

## 6. Keys genéricas de inversor **NO expuestas por Livoltek ni DEYE en Metrum** (verificado en piloto)

Catalogadas igual porque (a) son nombres estándar de la industria, útiles si se integra otra
marca (Huawei, Sungrow, Fronius...), y (b) podrían aparecer vía API OEM directa
bypaseando Metrum:

`Ppv1`, `Ppv2`, `Ppv3`, `Ppv` (potencia DC por string / total), `pvPower` (alias DEYE),
`Vpv1/2/3`, `Ipv1/2/3` (voltaje/corriente DC por string), `Pac`, `Sac`, `Qac`, `Vac`, `Iac`,
`Freq`, `cosPhi`, `Tinv` (lado AC genérico), `Pbat`, `Pcharge`, `Pdischarge`, `Vbat`, `Ibat`,
`Tbat`, `BattCycles` (batería genérica), `gridPower`, `loadPower`, `genPower` (flujos DEYE
Hybrid explícitos, potencialmente disponibles pero no confirmados en esta flota).

**No asumir que estas keys existen** para un `entityId` sin antes verificar con `GET
.../keys/timeseries` (sección [`01-auth-y-cliente.md`](./01-auth-y-cliente.md)).

## 7. Atributos de metadata del inversor (`SERVER_SCOPE`, no timeseries)

| Key | Significado |
|---|---|
| `invbrand` | `LIVOLTEK` o `DEYE` — DEYE casi nunca lo setea, se infiere por nombre |
| `invmodel` | Ej. `HP3-10KL2`, `SUN-15K-SG01HP3` |
| `invcap` | Potencia nominal kW (placa, no real) |
| `invarray` | Número de paneles conectados |
| `invtype` | `Hibrido` / `On-Grid` / `Off-Grid` |
| `BattSn` | Serial de la batería conectada |

## 8. Atributos generales (ubicación, identificación) — todos `metrum`

| Key | Significado |
|---|---|
| `spcus` | Nombre casa/cliente (`"Casa 2"`, `"Casa 23p"`, `"Piloto Promigas"`) |
| `gateway` | Nombre del Pulsar padre (`IN*`) |
| `mettype` | `red` / `solar` — subtipo de medidor |
| `active` | Online/offline — **ver limitaciones, poco confiable en la práctica** |
| `zone` | Conjunto residencial (`"RESERVAS DE PANCE"`) |
| `city`, `dept` | Ciudad, departamento (piloto = Cali, Valle del Cauca) |
| `latDev`, `lonDev` | GPS — solo en el gateway Pulsar, no por inversor individual |

## Variables usadas en el motor de alertas (`alert_rules` / `src/lib/alert-variables.ts`)

Catálogo aparte, orientado a umbrales operativos (no 1:1 con las keys de Metrum — son
variables ya calculadas y normalizadas). Categorías: `solar`, `reactiva`, `demanda`,
`bateria`, `alarma_inversor`, `conexion`. Frecuencias: `diario`, `mensual`, `15min`,
`instantaneo`.

Umbrales de referencia ya seedeados (contexto normativo colombiano):
- **Corriente**: alerta a 70A (87.5% del rating típico 80A), crítico a 80A.
- **cos φ / factor de potencia**: CREG exige ≥0.9; ratio reactiva/activa mensual penaliza si >50%.
- **Voltaje**: rango sano 108-140V (±~10-12% de nominal 120V/127V según RETIE/NTC1340); desbalance NEMA <3% recomendado, >5% daña cargas trifásicas.
- **Frecuencia**: nominal 60Hz±0.5; <59Hz = falla mayor de red.
- **SOC batería**: <15% = sin respaldo ante corte; min/max en 24h fuera de [20%,80%] = la batería no está ciclando bien.
- **Gateway offline**: >30 min = casa "muda" (según `METRUM_VARIABLES.md`) / regla seed usa >15 min como umbral de alerta.

Las 15 flags de alarma de inversor (`alarm_FSVER`, `FSCER`, `FBVER`, `FFT`, `ETA`, `FFDC`,
`FEM`, `FFB`, `FFCT`, `FAFER`, `UIcolorRojo/Amarillo/Naranja`, `TLinvstate_off`, `EMayor`,
`EMenor`) están descritas 1:1 en `alert-variables.ts` — cada una corresponde a un `flag*` de
Metrum listado en `alarm_flags` (jsonb) de la tabla `devices` (ver
[`02-dispositivos-y-jerarquia.md`](./02-dispositivos-y-jerarquia.md)).
