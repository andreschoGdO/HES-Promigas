# SUNNY APP — Overview del sistema (HES Promigas)

> **Documento vivo.** Este archivo es el mapa de referencia de todo el sistema:
> qué módulos existen, qué archivos los implementan, qué tablas de Supabase
> tocan y qué reglas de negocio no son obvias leyendo el código a la ligera.
>
> **Actualízalo cuando:** agregues un módulo/página nueva, cambies el schema de
> una tabla o de las actas (`visit-schemas.ts`), agregues/quites un endpoint de
> API, o cambies una regla de negocio de las listadas en "no obvias". Si haces
> un cambio y no sabés si aplica, mejor agregar una línea de más que dejar el
> doc desactualizado.
>
> Última actualización: 2026-07-14.

---

## 1. Qué es

**SUNNY APP** (HES Promigas) es el sistema interno de gestión de instalaciones
solares residenciales con batería en Colombia (Cali, Barranquilla, Cartagena,
Turbaco, etc.). Cubre todo el ciclo: dimensionamiento comercial → alistamiento
de inventario → instalación física en sitio → puesta en marcha → monitoreo de
telemetría en vivo → facturación → reportes.

- **Stack**: Next.js (App Router) + TypeScript + Supabase (Postgres + Auth +
  Storage), desplegado en Vercel. Ver [`DEPLOY.md`](../DEPLOY.md).
- **Fuente de telemetría**: plataforma **Metrum** (ThingsBoard whitelabel),
  con gateways Pulsar por casa y medidores/inversores Livoltek o DEYE.
- **Esquema de BD**: `webapp/migrations/*.sql`, numeradas `00`→`53`, aplicadas
  a mano en el SQL Editor de Supabase (sin ORM/migration runner formal — todo
  `create table if not exists`, es idempotente).
- **Base de código**: `webapp/src/app/**` (páginas + API routes), `webapp/src/lib/**`
  (lógica compartida), `webapp/src/components/**` (componentes compartidos,
  ej. `CrmModule.tsx`).

---

## 2. Mapa de módulos

| Módulo | Ruta UI | Propósito | Archivo(s) clave |
|---|---|---|---|
| Visitas / Actas | `/visitas` | Actas de campo (previa/instalación/emergencia/normalización), fotos, PDF | `src/app/visitas/page.tsx`, `src/lib/visit-schemas.ts`, `src/lib/visit-pdf.ts` |
| Inventario | `/inventario` | WMS: equipos serializados, consumibles, bodegas, reservas, transferencias | `src/app/inventario/page.tsx`, `src/app/api/inventory/**` |
| Operaciones (CRM) | `/operaciones` | Pipeline kanban de construcción: dimensionado → alistamiento → instalación → operativo → legalización | `src/components/CrmModule.tsx`, `src/lib/crm-stages.ts`, `src/app/api/crm/**` |
| Facturación | `/facturacion` | Costos por proyecto, contrato comercial, freeze de valores | `src/app/facturacion/page.tsx`, `src/app/api/facturacion/**` |
| Dash (ejecutivo) | `/dash` | Reporte semanal de avance de construcción (PDF/PPTX) | `src/app/dash/page.tsx`, `src/app/api/dash/report/route.ts` |
| Dashboard (técnico) | `/dashboard` | Telemetría en vivo por casa/dispositivo, cierre diario, curtailment | `src/app/dashboard/page.tsx` (~3k líneas) |
| Reportes | `/reportes` | 6 exportes CSV: ejecutivo, operación diaria, reactiva CREG, alertas, inventario, pipeline | `src/app/reportes/page.tsx`, `src/app/api/reports/route.ts` |
| Planner | `/planner` | Task management interno (kanban/gantt/calendario/mapa) | `src/app/planner/page.tsx`, `src/app/api/planner/tasks/**` |
| Gestión de equipos | `/gestion-equipos` | Control manual de inversores (cos φ, Q, límite P) | `src/app/gestion-equipos/page.tsx`, `src/app/api/inverter/**`, `src/lib/deye-cloud.ts` |
| Configuración | `/configuracion` | Conexión Metrum, visibilidad de sidebar, catálogo de endpoints | `src/app/configuracion/page.tsx`, `src/app/api/settings/**` |
| Usuarios | `/usuarios` | Allowlist de contratistas (habilitar/deshabilitar acceso) | `src/app/usuarios/page.tsx`, `src/app/api/users/allowlist` |
| Cuenta | `/cuenta` | Self-service: ver datos propios, cambiar contraseña | `src/app/cuenta/page.tsx` |

---

## 3. Flujo end-to-end de una casa

```
houses/build (agrupa devices Metrum por gateway)
        │
        ▼
crm_projects nace en "dimensionado" (Operaciones)
        │  al pasar a "alistamiento": autoReserveInventoryForProject()
        │  reserva por categoría+bodega (inventory_reservations)
        ▼
Visita PREVIA (field_visits, visit_type=previa) → aprueba/rechaza sitio
        │
        ▼
Etapa "instalación" en CRM
        │
        ▼
Visita de INSTALACIÓN (field_visits, visit_type=instalacion)
   captura seriales reales (inv_serials/panel_serials/batt_serials en form_data)
        │
        ▼
CRM transición "instalación → operativo": readSerialsFromActa() lee esa acta,
   cumple la reserva con seriales reales, crea facturacion_records
        │
        ▼
Dashboard técnico + Dash ejecutivo + Reportes + Alertas/NAR (monitoreo continuo)
```

Las visitas de **emergencia** y **normalización** son independientes de este
flujo lineal — se disparan ad hoc sobre una casa ya operativa.

---

## 4. Módulos en detalle

### 4.1 Visitas / Actas de campo (`/visitas`)

Registro móvil de actas técnicas con formularios dinámicos por tipo y
generación de PDF con la plantilla oficial PROMIGAS.

- `src/lib/visit-schemas.ts` — catálogo de campos por `VisitType`
  (`'previa' | 'instalacion' | 'emergencia' | 'normalizacion'`), organizado en
  `VisitSection[]` → `VisitField[]`. Tipo especial `serial_list` (con
  `qtyKey`, `qtyFallback`, `serialFamily: 'inverter'|'battery'|'panel'`) genera
  N inputs de serial según otra cantidad del formulario.
- `src/app/visitas/page.tsx` — UI de listado/formulario/detalle. Para el tipo
  **instalación**, los campos de identificación de la visita (Casa, técnico,
  contratista, GPS) están fusionados dentro de la sección "I. Identificación
  de la instalación" del schema en vez de vivir en un panel aparte — ver
  `identityFields`/`casaField`/`technicianField`/`gpsField` y el flag
  `isInstalacionIdent` en el render. Para los demás tipos de acta sí hay un
  panel fijo "Identificación de la visita" separado.
- `src/lib/visit-pdf.ts` — genera el PDF client-side con `jsPDF` +
  `jspdf-autotable` (header con `formCode` tipo `FO:Prefactibilidad`, GPS con
  link a Google Maps, tablas por sección, grid de fotos). Omite del loop
  genérico las secciones "registro fotográfico", "observaciones" y
  "aprobación" porque se dibujan aparte con layout especial.
- `src/lib/inventory-visit-link.ts` — puente hacia Inventario.
- API: `src/app/api/visits/route.ts` (GET/POST), `[id]/route.ts`
  (GET/PATCH/DELETE), `[id]/photos/route.ts`.
- Migraciones: `06_visits.sql`, `34_field_visits_contratista.sql`.

**Tablas**: `field_visits` (`visit_type, house_id, casa, technician_name,
technician_email, contratista, visit_date, visit_time, status
'draft'|'completed'|'cancelled', form_data jsonb, lat, lng, created_by,
completed_at`), `field_visit_photos` (`visit_id, storage_path, description`,
bucket privado `visit-photos`, signed URLs de 1h).

**No obvio**:
1. Rol `user` (contratista) solo ve/edita sus propias visitas
   (`created_by = email`); admins ven todo (`enforceOwnership()`).
2. `created_by` se fuerza desde la sesión del servidor, nunca del body.
3. Al pasar `status → completed` se dispara `linkVisitToInventory()` una sola
   vez (detecta la transición); si falla, no bloquea el guardado de la visita.
4. INSERT de `contratista` tiene fallback: si la columna no existe aún
   (migración no aplicada), reintenta sin ella.

### 4.2 Inventario (`/inventario`)

WMS para equipos serializados (inversores, paneles, baterías, gateways,
medidores) y consumibles, con bodegas, reservas por proyecto/visita,
transferencias y log de movimientos.

- `src/app/inventario/page.tsx` (~4k líneas) — vistas de items, categorías,
  bodegas, reservas, transferencias, consumibles en una sola página.
- API: `src/app/api/inventory/{items,items/bulk,items/bulk-transfer,
  items/decommission,items/return,items/swap,categories,consumables,
  locations,movements,panorama,reservations,reservations/[id]/items,
  reservations/[id]/consumables,stats,transfers,transfers/[id],warehouses}`.
- Migraciones: `07_inventory.sql`, `09_wms.sql`, `27_warehouses.sql`,
  `28_transfers.sql`, `23_reservation_consumables.sql`,
  `25_reverse_logistics.sql`, `36_inventario_reset_seed.sql`,
  `37_inventario_items_serializados.sql`,
  `44_reservation_lines_por_cantidad.sql`, `45_transfers_states_extendido.sql`.

**Tablas**: `inventory_categories` (`family:
'inverter'|'battery'|'panel'|'gateway'|'meter'|'cable'|'breaker'|'tool'|'other'`),
`inventory_items` (`serial_number` único, `status:
'in_stock'|'reserved'|'installed'|'in_repair'|'rma'|'decommissioned'|'lost'`,
`current_house_id`, `warehouse_id`, `warranty_expires_at`), `inventory_consumables`
(`stock_quantity, min_threshold`), `inventory_movements` (log inmutable,
`type: receive|install|uninstall|transfer|repair_start|repair_end|rma_send|
rma_return|decommission|adjust_quantity|reserve|unreserve|transfer_out|
transfer_in`), `inventory_locations`, `warehouses` (`type:
central|cuadrilla|vehiculo|taller|transito|proveedor|otro`),
`inventory_reservations` (`status: draft|confirmed|fulfilled|cancelled`),
`inventory_reservation_lines` (modelo actual: reserva por
`category_id × warehouse_id × qty`, mig. 44), `inventory_reservation_items`
(modelo viejo, por serial específico — legacy), `inventory_transfers` (+
`_items`, `_consumables`).

**No obvio**:
1. Desde la migración 44 ya **no** se apartan seriales específicos al
   reservar: se reserva por cantidad+categoría+bodega; los seriales reales
   solo se conocen cuando la acta de instalación los aporta.
2. Todos los updates de estado usan **update condicional**
   (`.eq('status', esperado)`) como guard anti-race: 0 filas afectadas =
   alguien más ya cambió el estado, se omite silenciosamente. Patrón repetido
   en `items/route.ts`, `reservations/route.ts`, `inventory-visit-link.ts`.
3. Al crear una transferencia, los items pasan a `reserved` de inmediato (no
   `draft`); si algún item no está `in_stock` en origen, se rechaza *todo* el
   lote (todo o nada).
4. Selects con joins opcionales tienen fallback: si Supabase reporta
   tabla/columna faltante o "schema cache", reintentan con SELECT reducido
   (compatibilidad si una migración no se aplicó en ese ambiente).
5. Cancelar una reserva `confirmed` restituye stock (items → `in_stock`,
   consumibles suman de vuelta a `stock_quantity`).

### 4.3 Operaciones / CRM (`/operaciones`)

Pipeline kanban de construcción post-venta. `operaciones/page.tsx` es un
wrapper delgado sobre el componente compartido `CrmModule.tsx`
(`module="operations"`).

- `src/lib/crm-stages.ts` — `OPERATIONS_STAGES` (metadata de columnas del
  kanban) y `TRANSITIONS: TransitionDef[]` (acción, etapa origen/destino,
  campos requeridos, dirección `backward` opcional).
- `src/app/api/crm/projects/[id]/transition/route.ts` (~1300 líneas, el
  endpoint más denso del proyecto) — motor de transición de etapas.
- Otros: `projects/route.ts` (list/create), `[id]/route.ts`, `[id]/cancel`,
  `bulk`, `sync-coords`, `stage-fields`.
- Migraciones: `10_crm.sql`, `11_stage_fields.sql`, `29_new_crm_stages.sql`,
  `47_remove_logistica_inversa_stage.sql`.

**Tabla `crm_projects`**: `code` autogenerado `PROJ-YYYY-NNNN` (trigger SQL),
`current_module: sales|engineering|operations|closed`, `operations_stage:
pending|dimensionado|alistamiento|instalacion|operativo|legalizacion|
desistido|sin_renovacion|completado` (`logistica_inversa` retirada en mig.
47), `diseno_*_categoria_id` (FK `inventory_categories`), **`visita_previa_id`
/ `visita_instalacion_id`** (FK `field_visits` — acá se conecta con Visitas),
`reservation_id` (FK `inventory_reservations`), `house_id`, `tags[]`,
`custom_data jsonb`. Auxiliar: `crm_project_events` (audit log).

**No obvio**:
1. Cada transición es una acción explícita validada server-side contra el
   estado actual en BD; el UPDATE final lleva guard optimista
   (`.eq('operations_stage', ...)`) — 0 filas = 409 "modificado por otra
   operación".
2. `dimensionado → alistamiento` dispara
   `autoReserveInventoryForProject()`: valida las 3 categorías de diseño,
   resuelve bodega por ciudad (`warehouseCodeForCity`, mapeo hardcodeado
   Cali/Barranquilla/Cartagena) y reserva stock *antes* de mover la etapa; si
   falla, tagea el proyecto (`'sin modelos'|'sin stock'|'sin reserva'`).
3. `instalacion → operativo` exige `readSerialsFromActa()`: busca la última
   visita `visit_type='instalacion'` ligada (por `visita_instalacion_id`,
   luego `house_id`, luego texto `casa`) y extrae los seriales de
   `form_data`. Sin seriales, la transición se bloquea (409). **Este es el
   punto exacto donde Visitas alimenta al CRM.**
4. Al marcar `operativo` se auto-crea `facturacion_records`; al iniciar
   `instalacion` se auto-crea una tarea en `planner_tasks` (idempotente por
   tag `'instalacion-auto'`).
5. No existe transición "operativo → cerrado": los proyectos exitosos quedan
   en `operativo` indefinidamente; solo se cierran por `desistido` o
   `sin_renovacion`. Las transiciones `backward` cancelan la reserva activa y
   liberan items a `in_stock`.

### 4.4 Facturación (`/facturacion`)

Tabla financiera consolidada por proyecto con flujo de "freeze" para fijar
valores antes de facturar.

- `src/app/facturacion/page.tsx` — tabla editable (ubicación, cliente, plan,
  diseño, técnico, costos equipos, servicios, contrato, cierre, cobros
  manuales, documentación).
- API: `route.ts` (GET arma fila mezclando `crm_projects` +
  `inventory_items/categories` + `facturacion_records`; PATCH upsert),
  `freeze/route.ts` (POST/DELETE), `import/route.ts` (CSV masivo),
  `events/route.ts` (audit log).

**Tablas**: `facturacion_records` (`costo_inversor, costo_bateria,
costo_control_box, costo_top_cover, costo_panel_solar,
costo_medidor_solar/generacion, costo_modem, mano_de_obra, capex,
capex_venta, usd_wp, contract_*, revenue_billed_cop, balance_due_cop,
frozen_at, frozen_by`), `facturacion_events` (`event_type:
cost_change|text_change|freeze|unfreeze|snapshot_from_inventory|import`),
`facturacion_upgrades` (swaps post-instalación).

**No obvio**:
1. Costos "derivados" (no capturados a mano) se calculan en vivo desde
   `inventory_items` instalados en la casa; el override manual del usuario
   siempre prevalece.
2. **Freeze** materializa el snapshot permanentemente — después, cambios en
   precios de inventario ya no afectan el registro. **Unfreeze no revierte
   valores**, solo limpia el flag.
3. El import CSV matchea proyectos por `(ciudad, conjunto, casa)` en
   minúsculas; 0 matches = `notFound`, ≥2 = `ambiguous`; rechaza sobreescribir
   un proyecto congelado salvo `freeze_after=true`.
4. `capex` = override manual, o si no existe, suma de los 10 costos de
   componentes/servicios (evita doble conteo en la UI).

### 4.5 Dash ejecutivo (`/dash`) vs Dashboard técnico (`/dashboard`)

Nombres parecidos, módulos **distintos**:

- **`/dash`** — reporte semanal exportable (PDF/PPTX) de avance de
  construcción para stakeholders: KPIs acumulados, USD/Wp, legalizaciones
  AGPE, postventa/garantías, logística de bodega. Arma todo desde
  `src/app/api/dash/report/route.ts` mezclando `crm_projects`,
  `facturacion_records`, `inventory_items/categories`, `warehouses`,
  `inventory_movements`, `app_settings`.
- **`/dashboard`** — consola operativa en vivo (~3k líneas): selector de
  dispositivos Metrum, series de tiempo, diccionario de variables
  (`variables-dict.ts`), pestaña NAR embebida, "Cierre Diario" por casa
  (generación/importación/excedentes/yield), variables derivadas de
  curtailment/envelope por marca.

**No obvio**:
1. En `/dash`, "programadas" incluye TODAS las casas con fecha en el rango
   (incluso ya instaladas), para que el ratio "X de Y" refleje cumplimiento
   de plan, no solo pendientes.
2. "Stand-by" en `/dash` se deriva dinámicamente: `updated_at` de la etapa
   actual supera un umbral por etapa (`app_settings.dash_standby_dias`).
3. En `/dashboard`, DEYE y Livoltek usan convención de signo **opuesta** para
   `BattPower`: Livoltek `Pdc = AC + BattPower`, DEYE `Pdc = AC − BattPower`
   (verificado empíricamente en Casa 74 — cuidado si se agregan más marcas).

### 4.6 Reportes (`/reportes`)

6 tipos de exportes CSV vía `src/app/api/reports/route.ts?type=`: ejecutivo,
operación diaria (`daily_casa_metrics`), reactiva CREG
(`daily_energy_closures`, regla CREG 015-2018), alertas (`alert_events`),
inventario (snapshot), pipeline CRM (snapshot).

**No obvio**: "Inventario" y "Pipeline" ignoran el filtro de período (son
snapshot del estado actual). La vista previa limita a 500 filas; el CSV
descarga el total.

### 4.7 Planner (`/planner`)

Task management interno (no específico de instalación de casas), 5 vistas
(kanban/lista/gantt/calendario/mapa). Tabla `planner_tasks` (`urgency:
low|medium|high|critical`, `status: todo|in_progress|done|blocked`,
`project_id` opcional hacia `crm_projects`).

**No obvio**: al pasar a `done` se setea `completed_at` automáticamente; al
reasignar `assigned_to` se dispara email fire-and-forget solo si cambió.
Import CSV bulk acepta alias en español ("urgente"→critical,
"pendiente"→todo).

### 4.8 NAR / Curtailment (dentro de `/dashboard` + `src/app/api/nar/**`)

- `curtailment/route.ts` — energía "perdida" por saturación de batería
  (inversor limita DC porque la batería está llena y no se puede exportar).
- `ranking/route.ts` — ranking de casas por volumen de alertas.
- Lógica compartida en `src/lib/curtailment.ts` y cron
  `compute-curtailment/route.ts`.

**No obvio**:
1. Saturación = `BattSOC ≥ 95%` AND `|ExportGrid| < 100W` AND horario diurno
   06:00–18:00 COT. Fuera de eso, curtailment = 0 aunque haya gap entre
   envelope y DC real.
2. Envelope = P95 histórico de potencia DC por hora, ajustado por ratio de
   irradiancia (GHI) actual vs P95 histórico de GHI (descuenta nubosidad).
   Curtailment estimado = `max(0, envelope − DC_real)`.
3. Cache-then-compute: lee primero `daily_curtailment_by_house`; si
   cobertura <50% del rango (o `force=1`), recalcula contra Metrum + GHI y
   persiste (upsert `casa,record_date`). Rango máx. 92 días.
4. "Recomendación" en el ranking = heurística: misma `rule_id` dispara ≥3
   veces para la misma casa en el rango.

### 4.9 Integración Metrum / dispositivos / Gestión de equipos

- `src/lib/metrum-api.ts` — cliente del ThingsBoard whitelabel
  (`monitoreo-metrum.com`): `loginToMetrum`, `getDevices`,
  `getTimeseriesKeys/getTimeseries`, `getDailyClosure`.
- `src/app/api/devices/sync/route.ts` — trae de Metrum, mapea atributos →
  columnas `devices`, `upsert(onConflict: metrum_id)`. Distingue marca por
  patrón de nombre: Livoltek `HP*`, DEYE `^(24|25)\d{8}$`. Mantiene blacklist
  hardcodeada `EXCLUDED_METRUM_IDS`.
- `src/app/api/houses/build/route.ts` — agrupa `devices` por `cliente_id`
  (serial del gateway Pulsar padre) y hace upsert en `client_houses` +
  `classifySubtype()` (`meter_solar|meter_red|gateway|inverter`).
- Cron horario `src/app/api/cron/sync/route.ts` (Vercel Cron, `maxDuration=300`):
  `devices/sync → houses/build → sync/all → sync/consumption →
  computeAndStoreCasaMetrics() → alerts/evaluate`. Modo `quick=1` salta pasos
  pesados (límite Vercel Hobby 60s). Auditoría en `cron_runs`.
- Cron cada 15 min `cron/instant-check/route.ts` (GitHub Actions +
  `CRON_SECRET`) → `instant_metrics` + `alerts/evaluate?source=instant`.
- **Gestión de equipos** (`/gestion-equipos`) — `InverterControlPanel` envía
  comandos a `src/app/api/inverter/command/route.ts`, que clampa valores,
  enruta por `devices.marca` a `src/lib/deye-cloud.ts` (DEYE) o deja TODO
  para Livoltek, y siempre persiste en `inverter_control_commands`
  (`status: sent|failed|mocked`).
- `src/lib/deye-cloud.ts` — **esqueleto sin HTTP real todavía**: siempre
  retorna `unavailable/not_implemented` (o `no_credentials`/`no_device_sn`).
  Columnas `devices.deye_device_sn` / `deye_station_id` ya existen (mig. 53)
  pero no hay tabla `oem_tokens` para el OAuth de DEYE. Diseño completo en
  [`docs/INTEGRACION_INVERSORES_API.md`](INTEGRACION_INVERSORES_API.md).

**No obvio**: si `devices.cliente_id` no está poblado (falla de sync), ese
device se ignora silenciosamente del agrupamiento de casas — no error, solo
queda sin `house_id`.

### 4.10 Auth y roles

- `src/middleware.ts` (runtime Node, excluye `/api/*` de su matcher — cada
  API maneja su propio 401): refresca sesión Supabase SSR → si es ruta
  pública deja pasar → sin sesión redirige a `/login` → resuelve rol
  (`getRoleFromEmail()`) → si rol `user`, valida `canAccess()` contra
  allowlist (si falla: registra `pending`, `signOut()`, redirige con
  `error=pending|disabled`) → valida `isPathAllowedForRole()`.
- `src/lib/user-role.ts`: `ADMIN_DOMAINS = ['@gdo.com.co','@promigas.com',
  '@promigas.com.co']` → rol `admin` (acceso total). `OPERATIVO_EMAILS`
  (lista hardcodeada, 2 correos `@surtigas.co`) → rol `operativo`
  (`/operaciones, /inventario, /visitas, /cuenta`). Cualquier otro dominio →
  rol `user` (`/visitas, /cuenta` solamente).
- **Login = email + password** (migrado desde magic-link OTP, ver
  [`DEPLOY.md`](../DEPLOY.md) §4). Admins se crean a mano en el Dashboard de
  Supabase. Allowlist de contratistas: tabla `user_allowlist`, lib
  `src/lib/user-allowlist.ts`, CRUD admin-only en
  `src/app/api/users/allowlist/route.ts`.
- Dev: `DISABLE_AUTH=1` en `.env.local` desactiva todo el middleware — nunca
  en producción.

### 4.11 Configuración / Usuarios / Cuenta

Todos los settings genéricos viven en la tabla key-value `app_settings`
(`upsert(onConflict:'key')`):

- `api/settings/dash` — `meta_anual_casas`, `standby_dias` (umbral por
  etapa), `solucion_umbrales`.
- `api/settings/granular-views` — vistas de gráficos guardadas (globales).
- `api/settings/sidebar-visibility` — visibilidad de módulos del menú,
  **aplica a todos los usuarios** (no es por-usuario).

`configuracion/page.tsx` también trae `ApiDocsCard`: catálogo hardcodeado
`ENDPOINTS_INTERNAL` que documenta los endpoints internos — es documentación
viva embebida en la UI (mantenerlo también si agregás endpoints nuevos).

### 4.12 Casas (`client_houses`)

Ver §4.9 (`houses/build`). Tabla `client_houses` (`cliente_id` único = serial
del gateway, `casa`, `location`, `city`) es la entidad central: casi todas
las tablas operativas (`daily_consumption`, `daily_casa_metrics`,
`instant_metrics`, `field_visits`, `daily_curtailment_by_house`) referencian
`house_id → client_houses(id)`.

---

## 5. Catálogo de tablas (Supabase)

| Tabla | Migración | Qué guarda |
|---|---|---|
| `devices` | 00, 01, 04, 53 | Caché de dispositivos Metrum (gateway/medidor/inversor) |
| `client_houses` | 01 | Viviendas con sistema solar instalado |
| `daily_energy_closures` | 00 | Cierre diario por device (`CenergyAI/AE/RI/RE`) |
| `daily_consumption` | 01 | Consumo diario agregado por casa |
| `daily_casa_metrics` | 02 | Métricas pre-computadas por casa/día (usa Dashboard/Dash) |
| `cron_runs` | 02 | Auditoría de ejecuciones de cron |
| `alert_rules` / `alert_events` | 03 | Reglas de alerta configurables y eventos disparados |
| `instant_metrics` | 04, 08 | Snapshot cada 15 min por casa |
| `inverter_control_commands` | 05 | Auditoría de comandos manuales a inversores |
| `field_visits` / `field_visit_photos` | 06 | Actas de visita de campo + fotos |
| `inventory_categories/_items/_consumables/_movements` | 07 | WMS-lite: catálogo, unidades, consumibles, log |
| `inventory_locations`, `_reservations(+_lines/_items/_consumables)`, `_transfers(+_items/_consumables)` | 09, 23, 28, 44 | Reservas y transferencias de inventario |
| `crm_projects` / `crm_project_events` | 10 | Pipeline de proyectos (Ventas/Ingeniería/Operaciones) |
| `crm_stage_fields` | 11 | Campos requeridos por etapa del CRM |
| `planner_tasks` | 15, 17 | Tareas del módulo Planner |
| `app_settings` | 16 | Key-value global de configuración |
| `facturacion_records/_events/_upgrades` | 18, 19, 25 | Facturación, freeze, upgrades post-instalación |
| `warehouses` | 27 | Bodegas físicas |
| `solar_irradiance_cache` | 32 | Cache de GHI (irradiancia) para curtailment |
| `daily_curtailment_by_house` | 33 | Curtailment DC diario por casa |
| `user_allowlist` | 35 | Allowlist de contratistas |

---

## 6. Patrones de arquitectura recurrentes

- **Sin ORM**: todo SQL crudo vía Supabase JS client, migraciones idempotentes
  (`create table if not exists`) numeradas y aplicadas a mano.
- **Guard anti-race con update condicional**: mutaciones de estado usan
  `.eq('status', valorEsperado)` y tratan "0 filas afectadas" como "ya lo
  cambió otra operación" en vez de error — patrón repetido en Inventario y
  CRM.
- **Fallback de compatibilidad de schema**: varios selects con joins
  opcionales reintentan con columnas reducidas si Supabase reporta
  tabla/columna inexistente, para no romper en ambientes con migraciones
  pendientes.
- **`form_data jsonb` como schema flexible**: tanto `field_visits.form_data`
  como `crm_projects.custom_data` usan JSON libre validado en código
  (`visit-schemas.ts`, `crm-stages.ts`) en vez de columnas rígidas — permite
  agregar campos sin migración, a costa de no tener constraints de BD.
- **Cron en cascada + modo `quick`**: el sync horario encadena varios pasos
  pesados; existe un modo rápido para no exceder el límite de 60s de Vercel
  Hobby cuando se dispara manualmente.

---

## 7. Cómo mantener este documento

Cuando hagas un cambio de código que afecte lo descrito acá:

1. Si tocaste `visit-schemas.ts` (secciones/campos de actas) → actualiza
   §4.1.
2. Si agregaste una tabla o columna importante → agrégala a §5 y, si aplica,
   al módulo correspondiente en §4.
3. Si agregaste un módulo/página nueva → agrégalo a §2 (mapa) y crea una
   subsección en §4.
4. Si cambiaste una regla de negocio de las listadas en "No obvio" → corrige
   esa línea puntual, no reescribas toda la sección.
5. Actualiza la fecha de "Última actualización" al final del bloque de intro.
