# Eventos y estado avanzado de medidores/inversores

Todo este archivo viene de **documentación oficial del fabricante** (Metrum Soluciones
Inteligentes SAS, la plataforma se llama internamente **"ACCESO"**), no de ingeniería
inversa del código: `Docs/API/*.pdf` (PDFs confidenciales del proveedor, fuera de
`webapp/`, en la raíz del repo `HES-GdO/Docs/API/`). Nada de esto estaba en
`variables-dict.ts` ni en el resto de esta carpeta antes de esta revisión — es información
nueva que vale la pena que el código eventualmente adopte.

## Jerarquía oficial de entidades (más formal que "gateway→meter/inverter")

```
Departamento (activo)
  └─ Ciudad (activo)
       └─ Sector (activo)
            └─ Punto de Servicio = Gateway (dispositivo, 1:1 con el punto de servicio)
                 ├─ Medidor (dispositivo)
                 └─ Inversor (dispositivo)
```

Las entidades tipo **activo** (Departamento/Ciudad/Sector) solo tienen `name` y sirven para
agrupar visualización/control de acceso por roles — no tienen telemetría propia. Cada
entidad "activo" pertenece a una única entidad de nivel superior; puede tener múltiples de
nivel inferior.

## `event` / `metEvents` / `invEvents` — catálogo de eventos con código

Cada dispositivo reporta un timeseries `event` (o `metEvents`/`invEvents` según el
documento) cuyo `value` es un código corto de 2-4 letras. Se reporta **según ocurrencia**,
no en un ciclo fijo.

### Tabla 1 — Eventos del inversor

| Código | Evento |
|---|---|
| `wmc` | Cambio en el modo operativo del inversor |
| `goc` | Sobre corriente en la entrada de red |
| `gpo` | Desconexión o pérdida del suministro de red o de la señal de referencia |
| `bbf` | Falla en la batería |
| `guv` | Bajo voltaje en la entrada de red |
| `gof` | Frecuencia por encima del valor seguro en la entrada de red |
| `hsot` | Temperatura interna del inversor por encima del valor seguro |
| `igf` | Falla en la conexión a tierra |
| `ims` | Apagado manual del inversor |
| `gov` | Sobre voltaje en la entrada de la red |
| `mls` | Error interno de memoria del inversor |
| `hwtf` | Falla del test Hardware |
| `boc` | Sobre carga en el lado del Backup |
| `bsuf` | Falla por desbalance de cargas |

### Tabla 2 — Eventos del medidor

| Código | Evento | Código | Evento |
|---|---|---|---|
| `po` | Power Down | `nv1`/`nv2`/`nv3` | Voltage L1/L2/L3 normal |
| `pr` | Power Up | `rps` | Reverse phase sequence |
| `clko` | Clock adjusted (old date/time) | `mn` | Missing neutral |
| `clk` | Clock adjusted (new date/time) | `pa` | Phase asymmetry |
| `clki` | Clock invalid | `rvc` | Reverse current |
| `br` | Replace Battery | `lpc` | Load profile cleared |
| `blv` | Battery voltage low | `elc` | Event log cleared |
| `arc` | Alarm register cleared | `tmp` | Terminal cover removed |
| `nme` | NV memory error | `tmc` | Terminal cover closed |
| `ms` | Measurement system error | `sfd` | Strong DC field detected |
| `mcr` | Meter cover removed | `nsfd` | No strong DC field anymore |
| `mcc` | Meter cover closed | `cmp` | Change one or more parameters |
| `uv1`/`uv2`/`uv3` | Under voltage L1/L2/L3 | **`cs`** | **Remote disconnection** |
| `ov1`/`ov2`/`ov3` | Over voltage L1/L2/L3 | **`rc`** | **Remote connection** |
| `mv1`/`mv2`/`mv3` | Missing voltage L1/L2/L3 | **`drf`** | **Disconnect/Reconnect failure** |

**Directamente relevante para el gap de corte/reconexión** (ver
[`05-control-remoto.md`](./05-control-remoto.md)): aunque el string exacto del comando
`command` sigue sin confirmarse, **el resultado de cualquier intento SÍ queda registrado**
como evento `cs` (desconexión remota exitosa), `rc` (reconexión remota exitosa) o `drf`
(falló el intento de desconexión/reconexión) en el timeseries `event`/`metEvents` del
medidor. Esto da una forma de verificar post-hoc si un comando surtió efecto, incluso sin
saber de antemano qué string lo dispara — vale la pena consultar `event` después de
cualquier intento de control, mockeado o real.

## `FlagStaProf` — flag de estado del perfil de carga (interrupción de suministro)

Timeseries (no atributo) con exactamente 2 valores posibles:

- **`0`** = operación normal.
- **`128`** = el dispositivo está presentando una interrupción de energía.

Se reporta cada 15 minutos junto con `activityState`. Relacionado pero **no idéntico** al
atributo `meterFlag` (0/1, "Estado del perfil de carga") que aparece en la tabla de
atributos del medidor — probablemente `meterFlag` es una versión cacheada a nivel atributo
y `FlagStaProf` es el registro histórico en timeseries, pero esto no se confirmó
explícitamente en la documentación del fabricante.

**Es una señal directa y ya confirmada por el fabricante de "este medidor no tiene
suministro"** — más simple y más autoritativa que inferir el estado del servicio combinando
`latch_state`/`active`. Candidata fuerte para incorporar a `metrum-meter-control.ts` /
`meter-status` como lectura adicional.

## `activityState` — matiz de valores por tipo de dispositivo

- **Medidores e inversores**: `"succesful"` (sic, typo real del firmware — no es "successful"
  con doble s) o `"noResponse"`. Se reporta **cada 15 minutos**, indica conectividad con el
  Gateway (no con la plataforma directamente).
- **Gateway**: `"online"` / `"offline"`. Se reporta **solo cuando cambia de estado** (evento,
  no ciclo fijo) — si no hubo cambio de conectividad en el rango consultado, la respuesta
  para ese rango puede venir vacía. **Para el Gateway, siempre consultar el último valor sin
  fijar rango de tiempo**, no un rango histórico, o la respuesta puede salir nula aunque el
  gateway esté (y siempre haya estado) online.

## `latch_state` vs. `latch_output` — no son lo mismo (matiz nuevo vs. lo documentado en 05)

Documentación oficial del fabricante distingue dos atributos que nuestro código
(`metrum-meter-control.ts`) trata como equivalentes/intercambiables:

- **`latch_state`** — posición del **relé interno** del medidor. Valores: `{Cerrado,
  Abierto}`.
- **`latch_output`** — señal de voltaje censada en la **bornera de salida** del medidor (el
  estado real de suministro que percibe la instalación aguas abajo). Valores: `{Energizado,
  Suspendido}`.

En teoría deberían coincidir siempre (relé cerrado = energizado), pero al ser dos lecturas
físicas distintas (posición del relé vs. sensado real de voltaje en el borne), podrían
divergir si hay una falla mecánica del relé o un corte aguas arriba del medidor mismo. Vale
la pena que `getMeterLatchState()` reporte ambos valores por separado en vez de asumir que
son sinónimos (ya lo hace — el código ya lee `latch_state` y `latch_output` como campos
separados — pero esta es la explicación oficial de por qué existen los dos).

**Nota de nomenclatura**: nuestro código documentó los valores de `latch_state`/`latch_output`
como `"close"`/`"open"` (inglés, minúscula) basado en inspección en vivo de un medidor real;
el PDF oficial documenta `{Cerrado, Abierto}` / `{Energizado, Suspendido}` (español). Es
posible que la plataforma traduzca el valor mostrado en la UI web pero devuelva el valor en
inglés crudo por API (lo que observamos), o que varíe por versión/config del medidor — no
tomar ninguna de las dos fuentes como 100% definitiva sin volver a verificar en vivo con
`/api/debug/inspect-keys` antes de programar lógica que dependa del string exacto.

## `latch_ai` / `latch_ae` / `latch_ri` / `latch_re` — snapshot al ejecutar una acción de corte/reconexión

Cuatro timeseries adicionales (mismas unidades que `Cenergy*`: Wh/varh, registro acumulado)
que capturan el valor de los contadores de energía **en el momento exacto en que se ejecuta
una acción de corte o reconexión** sobre el medidor. Es, en la práctica, un recibo/comprobante
del estado energético al momento del comando — útil para auditoría de facturación cuando se
corta/reconecta un cliente a mitad de un ciclo. No confundir con los cierres diarios
`Cenergy*` (que son a las 00:00 fijas) ni con las instantáneas `energy*` (ventana de 15 min).

## Variables de ángulo de fase (medidor) — no documentadas en `variables-dict.ts`

Presentes en la respuesta real de `/values/timeseries` de un medidor (confirmado con un
ejemplo real del fabricante), pero ausentes de nuestro diccionario interno — candidatas a
agregar si se necesita análisis de calidad de energía más fino:

| Key | Descripción | Unidad |
|---|---|---|
| `au2u1` | Ángulo de desfase entre voltaje fase B y voltaje fase A | grados |
| `au3u1` | Ángulo de desfase entre voltaje fase C y voltaje fase A | grados |
| `ai1u1` | Ángulo de desfase entre corriente fase A y voltaje fase A | grados |
| `ai2u2` | Ángulo de desfase entre corriente fase B y voltaje fase B | grados |
| `ai3u3` | Ángulo de desfase entre corriente fase C y voltaje fase C | grados |

## Campos marcados por el fabricante como DEPRECADOS ("no tener en cuenta, se va a eliminar")

Confirmado en un ejemplo de respuesta real fechado 25-oct-2025, con anotación explícita del
fabricante junto a cada campo:

- `flagmedidor` — reemplazado conceptualmente por `FlagStaProf`/`meterFlag`.
- `DCts`, `DCenergyRI`, `DCenergyRE`, `DCenergyAI`, `DCenergyAE` — variantes con prefijo `DC`
  de los cierres diarios que aparecían en la telemetría de MEDIDORES (no confundir con
  `DCts` de INVERSOR Livoltek en `variables-dict.ts`, que es un campo distinto y sigue
  vigente — el `DCts` deprecado aquí es específico de medidores).

**No construir nada nuevo sobre estos campos** — úsense `CenergyAI/AE/RI/RE` (cierre diario,
vigente) y `FlagStaProf`/`meterFlag` (estado de perfil de carga, vigente) en su lugar.

## Modelos de medidor soportados oficialmente (`model`)

Enum completo del atributo `model`, más amplio que los 2 modelos (`dds23y-1p`,
`dtsy23-3p`) que había confirmado el código de esta app:

`star-1p`, `star-3p`, `star-3p-semi`, `starleg-1p`, `starleg-3p`, `starleg-3p-semi`,
`itron-ace6000-v4-3p-semi`, `dds23y-1p`, `dtsy23-3p`, `dds23y-1p-v2`, `idis-1p`, `idis-3p`,
`idis-3p-semi`. Todos protocolo DLMS/COSEM salvo que se indique lo contrario.

## Filtrar `entitiesQuery/find` por atributo (`keyFilters`) — patrón útil no usado hoy en el código

El código propio (`metrum-api.ts`) siempre pide TODOS los devices y filtra en memoria. La
API soporta filtrar server-side con `keyFilters`, evitando traer todo el tenant cuando solo
se necesita una casa:

```json
{
  "entityFilter": { "type": "entityType", "entityType": "DEVICE" },
  "keyFilters": [
    {
      "key": { "type": "SERVER_ATTRIBUTE", "key": "gateway" },
      "valueType": "STRING",
      "predicate": {
        "operation": "EQUAL",
        "value": { "defaultValue": "IN42420370", "dynamicValue": null },
        "type": "STRING"
      }
    }
  ],
  "entityFields": [...],
  "latestValues": [...],
  "pageLink": { "page": 0, "pageSize": 10, "sortOrder": {...} }
}
```

Atributos típicos para filtrar: `dept` (departamento), `city` (ciudad), `zone` (sector),
`gateway` (serial del punto de servicio/Pulsar padre). `operation` soporta `EQUAL`,
`STARTS_WITH`, etc. según el tipo de dato. Útil para un skill que solo necesita los
dispositivos de una casa puntual sin paginar todo el tenant.
