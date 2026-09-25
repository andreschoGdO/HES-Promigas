# Métricas derivadas — cómo se calculan (no son datos crudos de Metrum)

Todo lo de acá es **calculado por esta app** a partir de timeseries/atributos de Metrum. Si
un skill necesita reproducir uno de estos números, esta es la lógica real (no una
aproximación) — extraída del código fuente.

## Curtailment DC (`src/lib/curtailment.ts`)

Cuantifica cuánta generación solar se pierde porque la batería ya está llena y no se puede
exportar a la red (sistema "saturado").

### Constantes del integrador

```ts
SATURATION_SOC = 95        // % — batería casi llena
EXPORT_GUARD_W = 100       // W — margen para considerar "no está exportando"
DAYLIGHT_START_H = 6       // hora local (COT)
DAYLIGHT_END_H = 18
CONCURRENCY = 6            // devices procesados en paralelo
```

### Pipeline por dispositivo (`processDevice`)

1. **Detectar marca** por `devices.marca` (Livoltek/DEYE/unknown — si unknown, se descarta).
2. **Elegir la key de DC**:
   - Livoltek → `powerAEgdc_LV` (medición DC directa que expone el inversor).
   - DEYE → `powerAPg` (activa generada) más `BattPower`, combinadas después en `Pdc =
     powerAPg − BattPower` (convención DEYE: `BattPower>0`=descarga, `<0`=carga — **opuesta**
     a Livoltek, verificado en vivo).
   - Gate de exportación: `ExportGrid_LV` (Livoltek) o `ExportGrid_DY` (DEYE) — nombres
     distintos por marca, hay que usar el correcto.
3. **Fetch de timeseries**: granularidad fija **15 min**, `agg: 'AVG'`, `limit: 50000` —
   coincide con el ciclo real de reporte del Pulsar; usar promedios de 15 min (no horario)
   evita diluir ráfagas de saturación cortas; no usar raw para permitir rangos largos.
4. **P95 por hora del día**: sobre TODO el rango fetched (no solo el día evaluado) se calcula
   el percentil 95 de DC para cada una de las 24 horas — esto da un "techo" estadístico de lo
   que el sistema puede generar en esa hora, filtrando outliers hacia arriba.
5. **Envelope ajustado por irradiancia** (si hay dato de `solar_irradiance_cache` para la
   ciudad):
   ```
   envelope(hora) = P95_DC(hora) × [ GHI_real(fecha, hora) / P95_GHI(hora) ]
   ```
   Si no hay GHI disponible para esa hora/ciudad, se usa el P95_DC crudo sin ajustar.
6. **Gate de saturación** — un punto cuenta como "saturado" solo si simultáneamente:
   - `BattSOC ≥ 95`
   - `|ExportGrid| < 100W`
   - hora local entre 6 y 18
7. **Curtailment instantáneo** = `max(0, envelope − DC_real)`, solo mientras está saturado.
8. **Integración a energía**: cada muestra se multiplica por el `Δt` hasta la siguiente
   (capado a 16 minutos — 15 min de granularidad + 1 min de margen — para que huecos largos
   por dispositivo offline no inflen el resultado asumiendo saturación continua). Resultado
   en Joules → se divide por 3,600,000 para kWh.
9. **Agregación por casa-día**: se suman los kWh de todos los inversores activos de la casa
   para cada `record_date` (fecha local COT), y se persiste en `daily_curtailment_by_house`.

### Filtro de dispositivos elegibles

Solo requiere `marca` conocida (Livoltek/DEYE) + `metrum_id` + `casa` no nulos.
**Deliberadamente NO filtra por `is_active`**: en producción muchos inversores están
marcados `is_active=false` pero siguen reportando datos reales a Metrum (campo legacy poco
confiable — ver [`07-limitaciones-y-gotchas.md`](./07-limitaciones-y-gotchas.md)).

### Dónde se usa

- `/api/cron/compute-curtailment` — job que persiste en `daily_curtailment_by_house`.
- `/api/nar/curtailment` — usa la tabla como cache; si está vacía, recalcula en vivo con el
  mismo `computeCurtailmentByDay`.

## Métricas diarias por casa (cron diario)

Ver sección 1 de [`03-diccionario-variables.md`](./03-diccionario-variables.md) para las
fórmulas exactas de `generacion_wh`, `demanda_wh`, `yield_real`, `desempeno_pct`, etc. Todas
parten de la diferencia (`hoy − ayer`) de los contadores cumulativos `Cenergy*` (cierre
diario 00:00 COT), nunca de las variantes instantáneas (`energyAI`, `energyRI`, etc. — esas
son ventanas de 15 min, no acumulados, y mezclar ambas da resultados incorrectos).

## Variables instantáneas del lazo de 15 minutos (`instant_metrics`)

Calculadas por `/api/cron/instant-check` sobre los últimos 15 minutos de timeseries:

```
cos_phi_now = powerAI / √(powerAI² + powerRI²)
fase_imbalance_pct = |fase_mayor − fase_menor| / fase_mayor × 100
```

Guardadas junto con `current_a_max` (pico entre A/B/C), `batt_soc` (de `TLBattSOC` en DEYE),
`inv_state` (de `TLinvstate` o `active`), y `gateway_online`. Estas alimentan
`/api/alerts/evaluate` para reglas de tipo `instant` (distintas de las reglas `daily` que
corren sobre `daily_casa_metrics`).

## `sacrificio_ac_LIV` — costo en activa de comandar reactiva

Solo aplica a Livoltek (DEYE no expone `powerREg_LV`). Se activa únicamente cuando
`|powerREg_LV| > 200 var` (hay reactiva siendo comandada activamente). En esos momentos:

```
envelope_p(hora) = P95(powerAEg, hora) del rango visible
sacrificio_ac(t) = max(0, envelope_p(hora_t) − powerAEg(t))
```

Sirve para cuantificar, en W (o integrado en kWh), cuánta potencia activa se está "pagando"
por forzar el factor de potencia hacia un objetivo — relevante si en el futuro se activa
control remoto de `set_reactive_power` (ver [`05-control-remoto.md`](./05-control-remoto.md)).
