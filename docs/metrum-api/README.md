# Metrum API — Carpeta de referencia para skills

Todo lo que este proyecto (SUNNY APP / HES-GdO) sabe hoy sobre la integración con
**Metrum** (`https://monitoreo-metrum.com`), el backend de monitoreo IoT de todas las
casas solares/BESS del piloto. Pensada para que un **skill de Claude Code** (o cualquier
agente) la use como contexto autocontenido, sin tener que releer el código fuente cada vez.

> Metrum es un **whitelabel de ThingsBoard** (plataforma IoT open-source, Apache 2.0). Todo
> lo que aplica a la REST API de ThingsBoard aplica aquí 1:1 — mismos endpoints, mismo
> modelo de auth JWT, mismos conceptos de "entity", "attribute scope" y "timeseries".

## Cómo usar esta carpeta

Cada archivo es independiente y cubre una capa distinta. Lee en este orden si es la
primera vez, o salta directo al archivo que necesites:

| Archivo | Qué contiene |
|---|---|
| [`01-auth-y-cliente.md`](./01-auth-y-cliente.md) | Cómo autenticarse, endpoints REST base, el cliente ya implementado (`metrum-api.ts`), credenciales |
| [`02-dispositivos-y-jerarquia.md`](./02-dispositivos-y-jerarquia.md) | Jerarquía gateway→medidores/inversores, convenciones de nombre, cómo se sincroniza a Supabase |
| [`03-diccionario-variables.md`](./03-diccionario-variables.md) | Catálogo de atributos y timeseries keys por tipo de dispositivo — qué significa cada uno |
| [`04-metricas-derivadas.md`](./04-metricas-derivadas.md) | Fórmulas de todo lo que la app calcula ENCIMA de Metrum (no son datos crudos) |
| [`05-control-remoto.md`](./05-control-remoto.md) | Corte/reconexión de medidor, control de inversor (DEYE Cloud, Livoltek) — qué funciona y qué es mock |
| [`06-mapa-de-integracion-app.md`](./06-mapa-de-integracion-app.md) | Dónde vive cada cosa en el código: rutas API, cron jobs, tablas, componentes UI |
| [`07-limitaciones-y-gotchas.md`](./07-limitaciones-y-gotchas.md) | Lo que NO funciona, lo que no se pudo confirmar, quirks conocidos de Metrum, y discrepancias sin resolver entre fuentes |
| [`08-eventos-y-estado-medidor.md`](./08-eventos-y-estado-medidor.md) | Eventos codificados (`cs`/`rc`/`drf`/...), `FlagStaProf`, `latch_state` vs `latch_output`, jerarquía oficial de entidades — todo de documentación oficial del fabricante |
| `CREDENCIALES.local.md` | Credenciales reales (Metrum + DEYE) en texto plano — **gitignoreado a propósito, nunca se commitea**. Solo existe en tu copia local del repo |

## Fuentes externas relacionadas (fuera de `webapp/`, en la raíz del repo `HES-GdO/Docs/`)

Al revisar la carpeta general `Docs/` (no `webapp/docs/`) aparecieron varias fuentes de
Metrum que ya existían antes de esta carpeta, escritas en otro momento/sesión. Se cruzaron
contra esta carpeta y se incorporó lo que aportaba información nueva (particularmente en
[`08-eventos-y-estado-medidor.md`](./08-eventos-y-estado-medidor.md) y en las discrepancias
documentadas en [`07-limitaciones-y-gotchas.md`](./07-limitaciones-y-gotchas.md)). No se
duplicó su contenido completo — quedan como material fuente, con estos matices:

| Fuente | Qué es | Estado |
|---|---|---|
| `HES-GdO/Docs/API/*.pdf` | **Documentación OFICIAL del fabricante** (Metrum Soluciones Inteligentes SAS) — guía de integración, catálogo de eventos, ejemplos de consulta reales. Marca "CONFIDENCIAL" | La fuente más autoritativa que existe sobre el contrato de la API — úsala primero ante cualquier duda de contrato |
| `HES-GdO/Docs/diccionario_metrum.md` | Diccionario de variables alterno, buena calidad, pero con algunas afirmaciones (ej. keys `TL*` de batería DEYE "confirmadas") que `variables-dict.ts` marca como no probadas | Cruzar contra `variables-dict.ts` antes de confiar en una key puntual — ver discrepancias en `07-limitaciones-y-gotchas.md` |
| `HES-GdO/Docs/metrum-api-guide/` | Guía **portable** (README + credentials/endpoints/variables/gotchas.md + sample-client.ts) escrita para poder integrar Metrum rápido en OTRA app, fuera de este proyecto | Buena para reuso fuera de HES-GdO; su `credentials.md` tiene un password **desactualizado** — ver `CREDENCIALES.local.md` |
| `HES-GdO/Docs/Equipos/` | Manuales/datasheets de los equipos físicos: inversores DEYE/Livoltek, batería DEYE HV, medidor STAR, módem Pulsar 4, Pylontech | Material de hardware, no de API — útil para specs físicas (rangos de voltaje, dimensiones, protocolo) que complementan lo que se ve por Metrum |

**Verificado en esta revisión (2026-09-22)**: de tres contraseñas de Metrum encontradas en
el repo, solo la de `.env.local` funciona hoy (probado con un login real) — las de
`Docs/API/Credenciales API.txt` y `Docs/metrum-api-guide/` están desactualizadas. Detalle en
[`CREDENCIALES.local.md`](./CREDENCIALES.local.md).

## Resumen de 30 segundos

- **Qué es Metrum**: plataforma de monitoreo (ThingsBoard whitelabel) donde cada casa del
  piloto solar tiene 4 dispositivos: 1 gateway Pulsar (`IN...`), 1 medidor de generación
  solar, 1 medidor de intercambio con red, 1 inversor (Livoltek o DEYE).
- **Cómo se lee**: login JWT → `entitiesQuery/find` para listar dispositivos y atributos →
  `values/timeseries` para históricos → `values/attributes/{SCOPE}` para metadata puntual.
- **Cómo se escribe**: `attributes/SERVER_SCOPE` para setear atributos (usado hoy solo para
  intentar comandos de corte/reconexión de medidor — MOCKEADO, ver
  [`05-control-remoto.md`](./05-control-remoto.md)).
- **Qué NO se pudo confirmar nunca con Metrum**: el string exacto de comando para
  corte/reconexión remota del medidor, y quién ejecutó un comando (el API de audit-logs da
  404 con el usuario actual).
- **Relación con Deye Cloud**: es una integración **separada y distinta** (API propia del
  fabricante DEYE, no pasa por Metrum), usada solo para *leer* estaciones/dispositivos DEYE
  en paralelo. El control de inversor por API de fabricante (DEYE/Livoltek) sigue sin
  credenciales — ver [`05-control-remoto.md`](./05-control-remoto.md).

## Fuente de esta carpeta

Todo el contenido está verificado contra el código real del repo (no memoria/suposición),
principalmente:

- `webapp/src/lib/metrum-api.ts`, `metrum-meter-control.ts`, `device-option.ts`,
  `variables-dict.ts`, `classify-device.ts`, `deye-cloud.ts`, `curtailment.ts`,
  `alert-variables.ts`
- `webapp/src/app/api/metrum/**`, `webapp/src/app/api/devices/sync/route.ts`,
  `webapp/src/app/api/cron/**`
- `webapp/migrations/00_schema.sql`, `04_alarms.sql`, `08_voltage.sql`, `53_deye_device_link.sql`
- Docs previos del repo: [`../METRUM_VARIABLES.md`](../METRUM_VARIABLES.md),
  [`../INTEGRACION_INVERSORES_API.md`](../INTEGRACION_INVERSORES_API.md),
  [`../INSTANTANEAS_Y_CONTROL.md`](../INSTANTANEAS_Y_CONTROL.md) — esos tres documentos son
  más antiguos (auditoría 2026-05-26) y algunas cosas que marcan como "❌ no capturado" ya
  se capturan hoy (ej. los `flag*` de alarma, ver `devices/sync/route.ts`). Esta carpeta
  nueva es la versión consolidada y actualizada; los tres viejos quedan como material de
  detalle/histórico, no se borraron.

Última verificación de este contenido contra el código: **2026-09-22**.
