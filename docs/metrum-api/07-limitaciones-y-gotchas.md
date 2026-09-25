# Limitaciones y gotchas conocidos

Cosas que le costaron tiempo/investigación al equipo en el pasado — para que un skill (o una
persona) no las vuelva a descubrir por las malas.

## El atributo `active` no es confiable

En una investigación previa de esta misma app se observó que **0 de 81 medidores** mostraron
`active: true` en ningún momento, pese a que muchos de esos medidores sí estaban reportando
datos frescos a Metrum. Conclusión práctica: **no usar `devices.active`/`active` de Metrum
como única señal de "el equipo está funcionando"** — cruzar con `lastActivityTime` reciente
o con la existencia de timeseries recientes. Por esta razón `curtailment.ts` deliberadamente
**no filtra por `is_active`** al elegir dispositivos elegibles (ver
[`04-metricas-derivadas.md`](./04-metricas-derivadas.md)).

## El comando de corte/reconexión de medidor nunca se confirmó con Metrum

Se sabe que el mecanismo existe (`command` en `SERVER_SCOPE`, valor observado
`"updateCosem"` en un medidor real usado para OTRA acción) pero **no el string exacto** para
disparar corte/reconexión. `sendMeterCommand()` está mockeado por defecto y solo se activa
con 3 env vars explícitas que hoy no están seteadas. No asumir que este flujo "ya funciona"
solo porque el código y la UI existen — ver
[`05-control-remoto.md`](./05-control-remoto.md).

## No se puede auditar quién ejecutó un comando

`/api/rpc/persistent/...` y `/api/audit-logs/...` de ThingsBoard devuelven **404** con el
nivel de permiso del usuario tenant que usa esta app. Si se necesita esa trazabilidad, la
única fuente hoy es nuestra propia tabla `meter_control_commands`/`inverter_control_commands`
— Metrum no la provee a este nivel de acceso.

## Convención de signo de `BattPower` es opuesta entre Livoltek y DEYE

- **Livoltek**: `BattPower > 0` = batería descargando, `< 0` = cargando.
- **DEYE**: convención **opuesta** a Livoltek. Confirmado en vivo en Casa 74
  (`BattPower = -4190 W` con la batería cargando de día bajo sol, no descargando como
  sugeriría el signo positivo esperado por la convención Livoltek). Esto es lo que motiva
  `Pdc_DEY = powerAPg − BattPower` en vez de `+` (ver
  [`04-metricas-derivadas.md`](./04-metricas-derivadas.md)). Si se implementa algo nuevo que
  usa `BattPower` de un inversor DEYE, **no asumir la misma convención que Livoltek** — no
  hay forma de re-verificar el signo en DEYE contra una medición DC directa (DEYE no expone
  `powerAEgdc_LV`); si hay duda, volver a probar con `/api/debug/inspect-keys` contra un
  dispositivo real con estado conocido (ej. de noche vs. mediodía soleado con sol fuerte).

## Livoltek y DEYE tienen huecos de telemetría distintos y complementarios

- Livoltek no expone reactiva/cos φ, corrientes EPS por fase, ni estado BMS.
- DEYE no expone DC-por-string, cos φ, potencia reactiva, ni DC-equivalente calculado.

Ningún código debería asumir que una key existe para ambas marcas — siempre verificar la
marca (`devices.marca`) antes de elegir qué keys pedir, tal como hace `curtailment.ts`.

## Las keys `Ppv*`/`Vpv*`/`Ipv*`/`Pac`/`Vac`/etc. NO existen en esta flota

Estos son nombres estándar de la industria catalogados en `variables-dict.ts` "por si acaso"
(otra marca de inversor, o acceso directo a la API OEM bypaseando Metrum) — pero **ni
Livoltek ni DEYE los exponen hoy en Metrum**, verificado en el piloto real. No pedirlas
asumiendo que van a devolver datos; siempre confirmar con `GET .../keys/timeseries` primero.

## `EXCLUDED_METRUM_IDS` — equipos fantasma en Metrum

Existen entidades en Metrum (inversores Livoltek viejos ya reemplazados por DEYE, un medidor
solar duplicado) que siguen ahí pero no representan equipo activo. Están excluidas por
`metrum_id` hardcodeado en `devices/sync/route.ts`. Cualquier código que consulte Metrum
directo (sin pasar por la tabla `devices` ya filtrada) debe replicar este filtro o va a
contar equipos que ya no existen físicamente.

## Los valores de timeseries siempre vienen como string

La respuesta de `values/timeseries` da `{ ts: number, value: string }` — incluso para datos
numéricos. Todo el código hace `Number(value)`/`parseFloat(value)` explícito y valida
`Number.isFinite`. No asumir tipo numérico directo del JSON.

## Credenciales y datos sensibles

- `METRUM_USERNAME`/`METRUM_PASSWORD` viven solo en `.env.local` (gitignoreado vía `.env*`)
  — nunca deberían aparecer en un commit, log público, o output compartido fuera del equipo.
- El seed de `integration_config` (`00_schema.sql`) tiene un email histórico de usuario
  Metrum (`davider@gdo.com.co`) — es un dato real de una persona, tratarlo como
  histórico/sensible al citarlo, no como credencial activa confirmada sin verificar.
- Las credenciales de Deye Cloud (`DEYE_APP_ID`, `DEYE_APP_SECRET`,
  `DEYE_ACCOUNT_EMAIL`, `DEYE_ACCOUNT_PASSWORD`) están en Vercel env vars marcadas
  "Sensitive" — mismo criterio aplica.

## `endTs` es EXCLUSIVO en `/values/timeseries`

ThingsBoard trata `endTs` como abierto (no incluye `ts == endTs`). Los cierres diarios de
Metrum salen exactamente a las 05:00 UTC (= 00:00 COT); si se pide `endTs = 05:00:00.000`
del día, el snapshot de cierre **no aparece** en la respuesta. Solución: sumar al menos 1
hora al `endTs` cuando se quiere garantizar que un snapshot puntual conocido quede incluido.

## Timezone: construir siempre el timestamp del cierre diario con `'T05:00:00Z'`

El cierre diario "del día 15" en Metrum corresponde al snapshot tomado a las 05:00 UTC del
día 15, que es medianoche del día 15 en hora Colombia — pero conceptualmente representa el
cierre del consumo del día 14 en COT. Construir el día con `new Date(day)` sin especificar
UTC toma la zona horaria del servidor (no necesariamente UTC-0), lo cual puede desplazar el
snapshot fuera del rango consultado. Patrón seguro: siempre `new Date(day +
'T05:00:00Z').getTime()`.

## Paginación con `pageSize` bajo puede perder devices silenciosamente

Con `pageSize` chico (ej. 500) y sin iterar hasta `hasNext=false`, un tenant que crece por
encima de ese tamaño pierde los devices excedentes **sin ningún error** — la respuesta
simplemente viene incompleta. El cliente propio (`metrum-api.ts`) ya pagina correctamente
con `PAGE_SIZE=1000` + `MAX_PAGES=20` iterando `hasNext`, pero cualquier código nuevo que
llame a `entitiesQuery/find` directo debe replicar ese patrón, no asumir que una sola página
alcanza.

`totalElements`/`totalPages` pueden venir `null` en la primera página si las entidades no
están bien indexadas en el tenant — por eso el loop de paginación debe basarse siempre en
`hasNext` (confiable) y nunca en comparar contra `totalPages`.

## Contadores cumulativos que retroceden: guardar `null`, no `0`

Nunca se ha observado un rollover real de un contador `Cenergy*` en este tenant, pero si un
delta (`hoy − ayer`) da negativo, es señal de cambio de firmware/device o bug de Metrum. La
convención correcta es guardar `null` en la métrica derivada de ese día (no `0` — `0`
significa "verificado en cero", `null` significa "dato no confiable ese día") y registrar el
evento para revisión manual.

## `entityFields` vs. `latestValues`: no mezclar los `type`

En el payload de `entitiesQuery/find`, cada entrada de `latestValues` debe declarar bien su
`type`: `ENTITY_FIELD` (solo `name`/`type`/`label`/`customerId`/`customerTitle`),
`ATTRIBUTE` (SERVER_SCOPE/CLIENT_SCOPE/SHARED_SCOPE) o `TIME_SERIES` (telemetría). Si se
pide un campo con el `type` equivocado, Metrum lo ignora silenciosamente — la key
simplemente no aparece en la respuesta, sin error.

## Agregar en el servidor (`agg`+`interval`), no traer crudo y bucketear en cliente

Para promedios/máximos por hora en un rango largo (ej. 30 días), pedir directamente
`agg=AVG&interval=3600000` en vez de traer los puntos crudos (`NONE`) y agregar en el
cliente — Metrum devuelve del orden de `24 × días` puntos ya agregados, mucho más rápido y
liviano. Reglas: `agg` sin `interval` = un solo bucket global (1 punto); `interval` sin
`agg` distinto de `NONE` es error; `NONE` = puntos crudos limitados por `limit` (default
100, no 5000 — subir explícitamente si se necesita más).

## Discrepancias entre fuentes de documentación — no asumir un solo valor sin verificar en vivo

Al comparar el código actual, `variables-dict.ts`, y la documentación externa
(`Docs/diccionario_metrum.md`, `Docs/metrum-api-guide/`, PDFs oficiales del fabricante en
`Docs/API/`), aparecieron varias discrepancias reales que no se resolvieron — quien las
necesite debe volver a verificar en vivo (`/api/debug/inspect-keys`) contra un device real
antes de programar lógica que dependa del valor exacto:

- **`TLinvstate` (estado del inversor DEYE)**: `variables-dict.ts` lo documenta como string
  `"on"`/`"off"`; `Docs/diccionario_metrum.md` y `Docs/metrum-api-guide/variables.md` lo
  documentan como numérico `0`=apagado/`1`=encendido. El PDF oficial del fabricante
  documenta el atributo genérico `invstate` (no `TLinvstate`) como `{encendido, apagado}` en
  español. Tres codificaciones distintas para lo que probablemente es el mismo concepto.
- **`invrun`**: `variables-dict.ts` documenta `{normal, backup, fault, standby}`; el PDF
  oficial documenta el atributo genérico equivalente como `{encendido, apagado, apagando,
  falla}`. No se sabe si son el mismo campo con dos versiones de codificación, o campos
  distintos.
- **`latch_state`/`latch_output`**: nuestro código documentó (por inspección en vivo previa)
  los valores como `"close"`/`"open"` en inglés minúscula; el PDF oficial del fabricante
  documenta `{Cerrado, Abierto}` para `latch_state` y `{Energizado, Suspendido}` para
  `latch_output` — ver el detalle de por qué son atributos distintos en
  [`08-eventos-y-estado-medidor.md`](./08-eventos-y-estado-medidor.md).
- **Variables de batería DEYE con prefijo `TL`** (`TLBattV`, `TLBattI`, `TLBattPower`,
  `TLBattSOH`): `Docs/diccionario_metrum.md` y `Docs/metrum-api-guide/` las presentan como si
  ya estuvieran confirmadas/en uso; `variables-dict.ts` (la fuente más vigilada del propio
  código de esta app) las marca explícitamente como **"potencialmente disponibles y no
  probadas"** — solo `TLBattSOC` y `TLinvstate` están confirmadas contra un device real. Ante
  la duda, confiar en `variables-dict.ts` por ser la fuente que el equipo mantiene más de
  cerca, pero confirmar con `keys/timeseries` antes de depender de cualquiera de las otras.

Ninguna de estas se resolvió en esta revisión — quedan como preguntas abiertas, no como
hechos establecidos en ninguna dirección.

## Documentos viejos del repo pueden estar desactualizados

[`../METRUM_VARIABLES.md`](../METRUM_VARIABLES.md) tiene fecha de auditoría 2026-05-26 y
marca varias cosas como "❌ no capturado" que **ya se capturan hoy** (ej. todos los `flag*`
de alarma Livoltek — comparar contra `devices/sync/route.ts`, sección `FLAG_KEYS`, que sí
los guarda en `alarm_flags`). Si hay conflicto entre ese doc y el código actual, **el código
gana siempre**. Esta carpeta (`docs/metrum-api/`) se escribió releyendo el código real al
2026-09-22 precisamente para tener una versión consolidada y vigente.
