# Importar proyectos "Contrato firmado" desde ActiveCampaign (TopLeads)

Fecha: 2026-07-21
Estado: Aprobado en brainstorming, implementando directo (ver hilo de chat).

## Contexto

El CRM de ventas de la empresa corre sobre **ActiveCampaign** (cuenta `sunnypromigas`,
dominio `activehosted.com`). Cada vez que un negocio (deal) llega a la etapa **"Contrato
firmado"** (pipeline "Ventas", `group=1`, `stage id=47`), hoy llega un correo manual con el
resumen del cliente y el dimensionamiento. Se quiere automatizar la creación del proyecto en
`crm_projects` (etapa Dimensionado) directamente desde esos datos.

Se investigó en vivo contra la API real (credenciales del usuario, solo lecturas):
- El endpoint MCP (`activehosted.com/api/agents/mcp/http`) exige OAuth2 con scopes de
  `org/project/team/event` — no es lo que necesitamos y no vale la pena perseguirlo.
- La **API REST clásica v3** (`https://sunnypromigas.api-us1.com/api/3/*` +
  header `Api-Token`) funciona directo con un token estático, sin OAuth.
- El deal trae casi todo el dimensionamiento como **custom fields estructurados**
  (`dealCustomFieldData` + diccionario en `dealCustomFieldMeta`) — no hace falta parsear
  texto de ningún correo.
- `contractor_name` / `cronograma_fecha_inicio` / `installation_date` (fin) NO existen en
  ActiveCampaign — se llenan a mano después, y el gate que ya existe en la transición
  Dimensionado→Alistamiento (`checkCronogramaPresent`, agregado en este mismo ciclo de
  trabajo) impide que el proyecto avance sin ellos. Esto es intencional: no bloquea la
  importación, solo bloquea que avance sin cronograma.

## Decisión de mecanismo: cron diario, no webhook

`/api/3/webhooks` existe y no tiene nada registrado — se podría usar para un push
instantáneo, pero el formato exacto del payload de eventos de "deal" no está verificado y
registrar un webhook es una acción con efecto en la cuenta real de ActiveCampaign. Se opta
por un **cron diario** (mismo patrón que `/api/cron/sync` y `/api/cron/compute-curtailment`,
ya en `vercel.json` — Vercel Hobby solo permite 1 corrida/día por cron de cualquier forma) que:
1. Lista deals con `stage=47`.
2. Para cada uno, si su `ac_deal_id` ya existe en `crm_projects`, lo salta (idempotente).
3. Si no existe, trae `dealCustomFieldData` + contacto + owner, mapea a columnas de
   `crm_projects`, y crea el proyecto en Dimensionado.
4. Guarda un resumen en `cron_runs` (igual que los demás crons).

Sin webhook por ahora. Se puede agregar después como fast-path si hace falta velocidad.

## Modelo de datos (migración 55)

```sql
alter table crm_projects add column if not exists ac_deal_id text;
create unique index if not exists idx_crm_projects_ac_deal_id
  on crm_projects (ac_deal_id) where ac_deal_id is not null;
```

## Mapeo de campos (deal AC → crm_projects)

| Origen AC | Campo/tipo | Destino |
|---|---|---|
| `deal.title` | texto (ya viene armado: "CONJUNTO-N (CLIENTE-CEDULA)") | `title` |
| `deal.owner` → `/api/3/users/{id}` | `firstName + lastName` | `diseno_aprobado_por` (Responsable) |
| `deal.contact` → `/api/3/contacts/{id}` | `firstName + lastName`, `email`, `phone` | `client_name`, `client_email`, `client_phone` |
| customField 2 (text) | Número de Casa | `casa_numero` |
| customField 10 (text) | Nombre unidad residencial | `conjunto` |
| customField 11 (text) | Dirección | `client_address` |
| customField 60 (radio) | Estrato | `estrato` (decodificado vía `dealCustomFieldOptions`) |
| customField 61 (radio) | Ciudad Cobertura | `client_city` (decodificado) |
| customField 91 (number) | Cantidad de Paneles | `diseno_paneles` |
| customField 93 (number) | Potencia Solar (kWp) | `diseno_kwp` |
| customField 96 (radio) | Inversores - Marca | `diseno_inversor_marca` (decodificado) |
| customField 94 (multiselect) | Baterías - Marca | `diseno_bateria_marca` (decodificado) |
| customField 79 (number) | Baterías - Cantidad | `diseno_baterias_cantidad` |
| customField 95 (number) | Almacenamiento Batería (kWh) | `diseno_bateria_capacidad_kwh` |
| customField 87 / 98 (number) | Consumo Promedio / Dimensionamiento | `invoice_kwh_mensual` (el primero no nulo) |
| Resumen compuesto | marca/modelo panel + inversor + baterías en texto libre | `diseno_notes` (formato "Paneles X · Inversor Y · Baterías Z", igual al placeholder ya usado en el formulario manual) |

Campos `radio`/`dropdown`/`multiselect` (Estrato, Ciudad, marcas) se resuelven contra
`/api/3/dealCustomFieldOptions?filters[customFieldId]=N` (se cachea el diccionario de
opciones por campo durante la corrida del cron, un solo fetch por campo). Si un campo no se
puede resolver (opción borrada, formato inesperado), se deja `null` en vez de fallar toda la
importación — igual que el resto del código de este repo (fallbacks silenciosos, no
bloqueantes) — y no impide que la card se cree.

`contractor_name`, `contractor_email`, `cronograma_fecha_inicio`, `installation_date`
quedan sin llenar — el proyecto se crea igual (no está en `checkCronogramaPresent`, que solo
bloquea la transición a Alistamiento, no la creación).

## Endpoint y config

- `src/lib/activecampaign.ts` — cliente delgado (`listDealsByStage`, `getDealCustomFieldData`,
  `getContact`, `getUser`, `getFieldOptions` con cache en memoria por invocación).
- `src/app/api/cron/import-activecampaign/route.ts` — GET, mismo patrón de auth que los
  demás crons (`Authorization: Bearer CRON_SECRET` o `x-trigger: manual`), pagina deals de
  a 100, hace upsert de proyectos nuevos, devuelve `{ imported, skipped, errors }`.
- Nueva entrada en `vercel.json`: `{ "path": "/api/cron/import-activecampaign", "schedule": "0 8 * * *" }`.
- Env vars nuevas: `ACTIVECAMPAIGN_API_URL`, `ACTIVECAMPAIGN_API_TOKEN` (no se commitean —
  van en `.env.local` y en Vercel).

## Errores y casos borde

- Deal sin contacto o sin owner: se crea igual, con `client_name`/`diseno_aprobado_por` null.
- Deal ya importado (`ac_deal_id` existe): se saltea, no se actualiza (evita pisar ediciones
  manuales hechas después de importar).
- Falla de red/rate-limit de ActiveCampaign a mitad de corrida: se corta esa corrida, lo ya
  importado queda commiteado (no es transaccional entre deals), el resto se reintenta en la
  corrida del día siguiente porque siguen sin `ac_deal_id`.
- No se borra ni se mueve nada en ActiveCampaign — el cron es de solo lectura hacia AC.
