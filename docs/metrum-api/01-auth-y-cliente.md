# Autenticación y cliente API

## Metrum = whitelabel de ThingsBoard (producto llamado "ACCESO")

Base URL: `https://monitoreo-metrum.com`. El nombre comercial que usa el fabricante (Metrum
Soluciones Inteligentes SAS, Cali) para la plataforma en su propia documentación es
**"ACCESO – Sistema de Información para el monitoreo de Activos Energéticos"** — "Metrum" es
el nombre de la empresa, "ACCESO" el del producto. En el código y en el resto de esta
carpeta seguimos llamándolo "Metrum" porque así se conoce internamente en este proyecto.

Todo el API sigue exactamente las convenciones REST de **Apache ThingsBoard** (open source,
documentado en https://thingsboard.io/docs/reference/rest-api/). Si algo no está claro acá,
la doc oficial de ThingsBoard resuelve la duda porque Metrum no le agrega ni le cambia nada
a nivel de contrato HTTP.

### Jerarquía oficial de entidades

El fabricante documenta una jerarquía más formal que "gateway→medidor/inversor" (detalle
completo en [`08-eventos-y-estado-medidor.md`](./08-eventos-y-estado-medidor.md)):
`Departamento → Ciudad → Sector → Punto de Servicio (= Gateway, 1:1) → {Medidor, Inversor}`.
Los tres niveles superiores son entidades "activo" (solo `name`, agrupan para
visualización/permisos); no tienen telemetría propia.

## Login

```
POST /api/auth/login
Content-Type: application/json

{ "username": "...", "password": "..." }
```

Devuelve `{ "token": "...", "refreshToken": "..." }`. El `token` es un JWT que se manda como
`Authorization: Bearer {token}` en **todas** las llamadas subsiguientes. No hay sesión de
cookie — es 100% stateless por header.

**Credenciales**: viven en `METRUM_USERNAME` / `METRUM_PASSWORD` en `.env.local`
(gitignoreado vía `.env*`, nunca se commitean) — copia de trabajo con valores reales
verificados en vivo en [`CREDENCIALES.local.md`](./CREDENCIALES.local.md) (también
gitignoreado). `davider@gdo.com.co` es el usuario actual y activo, confirmado por login real
el 2026-09-22 — no es solo un dato histórico de seed.

**Vida útil del JWT**: ~2 horas (`token`), refreshToken ~1 semana. El código de esta app no
implementa refresh — hace login de nuevo en cada invocación de función serverless (cron,
ruta API), lo cual es barato y evita lidiar con el endpoint de refresh. Si se construye un
proceso persistente (no serverless) que llame a Metrum repetidamente, cachear el JWT en
memoria ~110 min (margen bajo las 2h reales) y solo re-loguear al vencer — **loguearse en
cada request individual puede disparar un 429** (rate limit de `/api/auth/login`; a veces
Metrum devuelve un 401 engañoso en su lugar). Endpoint de refresh existe
(`POST /api/auth/token` con `{ refreshToken }`) pero no se usa en este proyecto — como
Metrum reinicia el servicio seguido, re-login directo es más confiable que mantener vivo un
refresh token.

**Alternativa más simple a `entitiesQuery/find`**: `GET /api/tenant/devices?pageSize=…`
devuelve el listado de devices sin `latestValues` (solo metadata básica) — útil si no hace
falta telemetría/atributos en la misma llamada, evita el payload grande del POST.

**RPC bidireccional**: `POST /api/plugins/rpc/twoway/{deviceId}` existe en el protocolo
ThingsBoard estándar pero **la cuenta actual no tiene autorización** para usarlo contra este
tenant (confirmado, no solo suposición) — coincide con el 404 ya documentado de
`/api/rpc/persistent/...` más abajo.

## Endpoints usados hoy por esta app

### Buscar/listar dispositivos (entidades)

```
POST /api/entitiesQuery/find
Authorization: Bearer {token}
Content-Type: application/json

{
  "entityFilter": { "type": "entityType", "entityType": "DEVICE" },
  "keyFilters": [],
  "entityFields": [{ "type": "ENTITY_FIELD", "key": "name" }, ...],
  "latestValues": [{ "type": "ATTRIBUTE", "key": "spcus" }, ...],  // lista larga, ver abajo
  "pageLink": { "pageSize": 1000, "page": 0, "sortOrder": {...} }
}
```

Paginado: hay que iterar `page` mientras `hasNext === true`. El cliente propio
(`getDevices`) usa `PAGE_SIZE = 1000` y un tope de seguridad `MAX_PAGES = 20` (o sea, nunca
trae más de 20,000 entidades — de sobra para el tamaño actual del piloto, ~30-120
dispositivos).

`latestValues` es la forma de pedir, en la misma respuesta, el último valor de N atributos
sin tener que hacer una llamada aparte por cada entidad. El cliente propio pide un `allAttrs`
grande y fijo (ver [`03-diccionario-variables.md`](./03-diccionario-variables.md) para el
significado de cada key) que cubre: tipo/subtipo, casa/cliente, gateway padre, ubicación,
proveedor, estado de conexión, datos de inversor Livoltek y DEYE, flags de alarma, y colores
de UI de Metrum.

### Claves de timeseries disponibles para una entidad

```
GET /api/plugins/telemetry/DEVICE/{entityId}/keys/timeseries
Authorization: Bearer {token}
```

Devuelve `string[]` con los nombres de las keys que esa entidad puntual tiene disponibles
(no todas las entidades del mismo "tipo" tienen exactamente las mismas keys — varía por
firmware/versión del equipo). **Siempre verificar acá antes de asumir que una key existe**
para un device específico (hay un comentario explícito en `migrations/08_voltage.sql` que
recuerda esto para `voltageA/B/C`).

### Valores históricos de timeseries

```
GET /api/plugins/telemetry/DEVICE/{entityId}/values/timeseries
    ?keys=key1,key2,...
    &startTs={epoch_ms}
    &endTs={epoch_ms}
    &agg=AVG|SUM|MIN|MAX|COUNT|NONE
    &interval={ms}
    &limit={n}
Authorization: Bearer {token}
```

Respuesta: `{ [key]: [{ ts: number, value: string }] }`. `value` viene siempre como
**string**, incluso para números — hay que `Number(...)`/`parseFloat(...)` explícitamente
(patrón usado en todo el código, ver `curtailment.ts`).

- Sin `agg`/`interval`: devuelve puntos crudos tal como Metrum los guardó.
- Con `agg` + `interval`: agrega en buckets de ese tamaño (ej. `interval: 15*60*1000, agg:
  'AVG'` = promedio cada 15 minutos — patrón estándar usado en `curtailment.ts` y
  `instant-check`).
- `limit`: tope de puntos devueltos; usar valores generosos (`50000`) para rangos largos con
  agregación fina.

### Valor de atributos (metadata puntual, no serie de tiempo)

```
GET /api/plugins/telemetry/DEVICE/{entityId}/values/attributes/{SCOPE}?keys=key1,key2
Authorization: Bearer {token}
```

`SCOPE` es uno de:
- `SERVER_SCOPE` — atributos que solo el servidor/backend puede escribir (usado para
  comandos y metadata administrativa).
- `SHARED_SCOPE` — atributos compartidos servidor↔dispositivo (config que baja al equipo).
- `CLIENT_SCOPE` — atributos que el dispositivo mismo reporta hacia arriba.

### Escribir atributos

```
POST /api/plugins/telemetry/DEVICE/{entityId}/attributes/SERVER_SCOPE
Authorization: Bearer {token}
Content-Type: application/json

{ "key1": "value1", "key2": "value2" }
```

Único uso real hoy: intentar despachar un comando de corte/reconexión de medidor (ver
[`05-control-remoto.md`](./05-control-remoto.md)) — y ese flujo está **mockeado por
defecto**, no se ha confirmado en producción contra un medidor real.

### Cierre diario de energía (closure)

Wrapper de conveniencia sobre `values/timeseries` con las 4 keys fijas de cierre diario:

```
keys = CenergyAI, CenergyAE, CenergyRI, CenergyRE
```

(energía activa importada/exportada, reactiva importada/exportada — snapshot que Metrum
guarda una vez al día a las 00:00 COT). Ver
[`03-diccionario-variables.md`](./03-diccionario-variables.md) para el detalle de cada una.

## El cliente ya implementado: `src/lib/metrum-api.ts`

No hace falta reimplementar nada de lo anterior — este archivo (201 líneas) ya expone
funciones tipadas para cada operación:

```ts
loginToMetrum(username?, password?): Promise<string>              // → token
getDevices(token): Promise<...>                                   // entitiesQuery/find paginado
getTimeseriesKeys(token, entityId): Promise<string[]>
getTimeseries(token, entityId, keys, startTs, endTs, opts?): Promise<Record<string, Array<{ts, value}>>>
getAttributeValues(token, entityId, scope, keys): Promise<...>
setServerAttributes(token, entityId, attrs): Promise<...>
getDailyClosure(token, entityId, startTs, endTs): Promise<...>    // wrapper de Cenergy*
```

Cualquier código nuevo (o un skill que necesite pegarle a Metrum) debería usar este cliente
en vez de reimplementar `fetch` crudo, salvo que necesite un endpoint que el cliente no
cubre todavía (ej. `/api/alarm/...` — ver más abajo).

## Endpoints de alarmas (conocidos, no wrapeados en el cliente propio)

Establecidos en investigación previa de esta misma sesión de trabajo, no reverificados en
esta pasada:

```
GET /api/alarm/DEVICE/{entityId}          — alarmas de un dispositivo
GET /api/alarm/info/{alarmId}             — detalle de una alarma puntual
POST /api/alarm/{alarmId}/comment         — comentar una alarma
GET /api/alarms                           — alarmas a nivel tenant (todas)
```

Tipos de alarma reales observados en el tenant: **"Falla en la Conexión/Reconexión remota
del suministro"** (MAJOR — fallo de handshake al intentar el comando) vs. **"Desconexión
remota del suministro"** (MAJOR — el relé realmente se abrió). Son alarmas distintas, no
confundir una con otra al interpretar el historial.

`/api/rpc/persistent/...` y `/api/audit-logs/...` devuelven **404** con el nivel de permiso
del usuario tenant actual — no se puede determinar quién ejecutó un comando desde nuestro
acceso actual. Ver [`07-limitaciones-y-gotchas.md`](./07-limitaciones-y-gotchas.md).
