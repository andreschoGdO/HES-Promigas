# Integración API fabricantes inversores — Livoltek + DEYE

Documento de implementación para conectar SUNNY APP con las APIs OEM y enviar comandos
reales a los inversores (cos φ, Q, P_max, modo de operación). Hoy el tab **Control Manual
Inversor** registra comandos en `inverter_control_commands` con status `mocked` — esta
guía explica qué falta para que pasen a `success`.

> Estado: la infraestructura del lado nuestro está lista (endpoint, UI, auditoría, clamping).
> Solo faltan los **adaptadores específicos** por fabricante + **credenciales OEM**.

---

## 🎯 Qué se va a poder hacer cuando esté listo

Por cada uno de los 28 inversores (24 Livoltek + 4 DEYE):

| Acción | Param | Rango | Uso típico |
|---|---|---|---|
| `set_power_factor` | cos φ | 0.80 – 1.00 | Forzar fp ≥ 0.95 para evitar penalización CREG |
| `set_reactive_power` | Q (kvar) | −10 a +10 | Inyectar reactiva capacitiva para compensar inductiva |
| `set_active_power_limit` | P_max (kW) | 0 – 15 | Tope generación (curtailment cuando red satura) |
| `set_work_mode` | modo 0-5 | enum | Auto / Self-consumption / Selling First / Off-grid / Backup / PF Priority |

---

## 1️⃣ Credenciales OEM que hay que conseguir

### DEYE Cloud (https://developer.deyecloud.com/api)

Necesita registro como **developer**, NO basta con la cuenta del usuario final.

1. Crear cuenta en https://developer.deyecloud.com
2. Solicitar acceso a **"OEM API"** o **"Developer API"** (puede requerir aprobación manual de DEYE — algunos partners reportan 1-3 semanas)
3. Crear una "Application" en el dashboard
4. Obtener:
   - `DEYE_APP_ID`
   - `DEYE_CLIENT_ID`
   - `DEYE_CLIENT_SECRET`
   - `DEYE_REDIRECT_URI` (= `https://sunnyhes.vercel.app/api/inverter/deye/callback`)
5. **Cada usuario final** (dueño de casa) debe autorizar tu app vía OAuth:
   - Tu app le manda a `https://developer.deyecloud.com/oauth/authorize?...`
   - Acepta → vuelve a tu callback con un `code`
   - Tu app cambia el `code` por un `access_token` + `refresh_token` (válido ~30 días)

### Livoltek Portal API (https://api.livoltek-portal.com:8081/ess-api/index.html)

Menos pública. Pasos típicos:

1. Contactar a Livoltek (ventas comercial Colombia) y solicitar **API integration**
2. Firmar acuerdo de uso de API si lo piden
3. Obtener:
   - `LIVOLTEK_API_KEY` o `LIVOLTEK_USERNAME` + `LIVOLTEK_PASSWORD` (algunos integrators usan cuenta tipo service)
   - `LIVOLTEK_BASE_URL` = `https://api.livoltek-portal.com:8081`
4. Revisar el swagger en `/ess-api/index.html` para confirmar:
   - ¿Auth con header `Authorization: Bearer ...` o con `?token=...`?
   - ¿Hay endpoint dedicado a `setPowerFactor` o se hace vía Modbus register write?
   - ¿Permisos de WRITE están habilitados para tu cuenta?

> ⚠️ Importante: la cuenta de Metrum (`davider@gdo.com.co`) que usamos para LEER no
> necesariamente tiene permisos de WRITE. Probablemente hay que pedir una cuenta
> "control" separada.

---

## 2️⃣ Variables de entorno a agregar en Vercel

Una vez tengas las credenciales, agrégalas en
`https://vercel.com/gdo-s-projects/hes-promigas/settings/environment-variables`
**como tipo "Sensitive"**:

### Para DEYE
```
DEYE_API_BASE        = https://api.deyecloud.com
DEYE_APP_ID          = (de tu app developer)
DEYE_CLIENT_ID       = (de tu app developer)
DEYE_CLIENT_SECRET   = (de tu app developer)
DEYE_REDIRECT_URI    = https://sunnyhes.vercel.app/api/inverter/deye/callback
```

### Para Livoltek
```
LIVOLTEK_BASE_URL    = https://api.livoltek-portal.com:8081
LIVOLTEK_API_KEY     = (de Livoltek)
   o
LIVOLTEK_USERNAME    = (cuenta service)
LIVOLTEK_PASSWORD    = (cuenta service)
```

### Comunes (ya existen)
```
CRON_SECRET          = (ya está)
NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
```

Después de agregar las env vars, **redeploy** Vercel (`vercel --prod` o desde dashboard) para que las inyecte.

---

## 3️⃣ Endpoints relevantes de cada fabricante

### DEYE — mapping acción → endpoint (⚠️ verificar exactos en docs oficiales)

| Nuestra acción | DEYE endpoint esperado | Body |
|---|---|---|
| `set_power_factor` | `POST /v1.0/inverter/{sn}/setting/powerFactor` | `{ "value": 0.95 }` |
| `set_reactive_power` | `POST /v1.0/inverter/{sn}/setting/reactivePower` | `{ "value": 3500 }` (en var) |
| `set_active_power_limit` | `POST /v1.0/inverter/{sn}/setting/activePowerLimit` | `{ "value": 8000 }` (en W) |
| `set_work_mode` | `POST /v1.0/inverter/{sn}/setting/workMode` | `{ "mode": "selfConsumption" }` |
| (read state) | `GET /v1.0/inverter/{sn}/detail` | — |

**Auth header**: `Authorization: Bearer {access_token}` donde `{access_token}` se obtiene del flow OAuth.

**`{sn}`**: serial number del inversor — los DEYE en nuestra flota son `2412240050`, `2412240064`, `2412240071`, `2412240077`, etc. (= mismo que `devices.name`).

### Livoltek — mapping acción → endpoint (⚠️ verificar swagger)

| Nuestra acción | Livoltek endpoint esperado |
|---|---|
| `set_power_factor` | `POST /ess-api/v1/device/{sn}/parameter/power_factor` |
| `set_reactive_power` | `POST /ess-api/v1/device/{sn}/parameter/reactive_power` |
| `set_active_power_limit` | `POST /ess-api/v1/device/{sn}/parameter/active_power_limit` |
| `set_work_mode` | `POST /ess-api/v1/device/{sn}/parameter/work_mode` |
| (read state) | `GET /ess-api/v1/device/{sn}/realtime` |

**Auth header**: `Authorization: Bearer {token}` o `X-API-Key: {key}` (depende de Livoltek).

**`{sn}`**: los Livoltek son `HP310K2HWC290002` ... `HP315K2HWC290046`.

> 🚧 Estos endpoints son **suposiciones razonables** basadas en patrones REST comunes. Hay
> que abrir cada swagger y CONFIRMAR antes de implementar.

---

## 4️⃣ Implementación del adaptador

El endpoint `/api/inverter/command` ya está listo. Solo hay que reemplazar el bloque
`// TODO: implementar adaptadores reales` en
[`src/app/api/inverter/command/route.ts`](../src/app/api/inverter/command/route.ts) por
las llamadas reales.

### Estructura sugerida

Crear un módulo nuevo por fabricante:

```
src/lib/inverter-adapters/
   ├─ deye.ts
   ├─ livoltek.ts
   └─ index.ts          (router que decide cuál usar según devices.marca)
```

### `src/lib/inverter-adapters/deye.ts` — esqueleto

```ts
import 'server-only';

const BASE = process.env.DEYE_API_BASE ?? 'https://api.deyecloud.com';

interface DeyeTokens { access_token: string; refresh_token: string; expires_at: number; }

// Persiste tokens en Supabase para no re-autenticar cada call
async function getValidAccessToken(deviceSn: string): Promise<string> {
  // 1. Buscar token guardado en supabase (tabla oem_tokens — pendiente crear)
  // 2. Si expira en < 1 min, refrescar con DEYE_CLIENT_ID/SECRET + refresh_token
  // 3. Retornar el access_token
  throw new Error('Implementar lookup en tabla oem_tokens');
}

export async function deyeSetPowerFactor(deviceSn: string, value: number) {
  const token = await getValidAccessToken(deviceSn);
  const r = await fetch(`${BASE}/v1.0/inverter/${deviceSn}/setting/powerFactor`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ value }),
  });
  if (!r.ok) throw new Error(`DEYE ${r.status}: ${await r.text()}`);
  return r.json();
}

export async function deyeSetReactivePower(deviceSn: string, kvar: number) { /* ... */ }
export async function deyeSetActivePowerLimit(deviceSn: string, kW: number) { /* ... */ }
export async function deyeSetWorkMode(deviceSn: string, mode: number) { /* ... */ }
```

### `src/lib/inverter-adapters/livoltek.ts` — esqueleto

```ts
import 'server-only';

const BASE = process.env.LIVOLTEK_BASE_URL ?? 'https://api.livoltek-portal.com:8081';

async function getLivoltekToken(): Promise<string> {
  // Si Livoltek usa session token (igual que Metrum/ThingsBoard):
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: process.env.LIVOLTEK_USERNAME,
      password: process.env.LIVOLTEK_PASSWORD,
    }),
  });
  const { token } = await r.json();
  return token;
}

export async function livoltekSetPowerFactor(deviceSn: string, value: number) {
  const token = await getLivoltekToken();
  // ⚠️ endpoint exacto pendiente verificar en swagger
  const r = await fetch(`${BASE}/ess-api/v1/device/${deviceSn}/parameter/power_factor`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ value }),
  });
  if (!r.ok) throw new Error(`Livoltek ${r.status}: ${await r.text()}`);
  return r.json();
}

// ...rest similar
```

### `src/lib/inverter-adapters/index.ts` — router

```ts
import * as deye from './deye';
import * as livoltek from './livoltek';

export async function sendInverterCommand(
  marca: string,
  deviceSn: string,
  action: string,
  value: number,
) {
  const m = (marca ?? '').toUpperCase();
  if (m === 'DEYE') {
    if (action === 'set_power_factor')        return deye.deyeSetPowerFactor(deviceSn, value);
    if (action === 'set_reactive_power')      return deye.deyeSetReactivePower(deviceSn, value);
    if (action === 'set_active_power_limit')  return deye.deyeSetActivePowerLimit(deviceSn, value);
    if (action === 'set_work_mode')           return deye.deyeSetWorkMode(deviceSn, value);
  }
  if (m === 'LIVOLTEK') {
    if (action === 'set_power_factor')        return livoltek.livoltekSetPowerFactor(deviceSn, value);
    if (action === 'set_reactive_power')      return livoltek.livoltekSetReactivePower(deviceSn, value);
    if (action === 'set_active_power_limit')  return livoltek.livoltekSetActivePowerLimit(deviceSn, value);
    if (action === 'set_work_mode')           return livoltek.livoltekSetWorkMode(deviceSn, value);
  }
  throw new Error(`Marca ${marca} no soportada`);
}
```

### Integración en `/api/inverter/command/route.ts`

Reemplazar:

```ts
// TODO: implementar adaptadores reales cuando haya credenciales
status = 'failed';
errorMessage = 'Adaptador del fabricante aún no implementado (TODO).';
```

Por:

```ts
try {
  const result = await sendInverterCommand(dev.marca, dev.name, body.action, body.value);
  status = 'success';
  responsePayload = result;
} catch (e) {
  status = 'failed';
  errorMessage = e instanceof Error ? e.message : String(e);
}
```

Y agregar el import: `import { sendInverterCommand } from '@/lib/inverter-adapters';`

---

## 5️⃣ Tabla nueva en Supabase para tokens OAuth (solo DEYE)

Si DEYE requiere OAuth con refresh_token, necesitamos persistirlos:

```sql
create table oem_tokens (
  id uuid primary key default gen_random_uuid(),
  device_id uuid references devices(id) on delete cascade,
  inverter_sn text not null,
  manufacturer text not null,    -- 'DEYE' | 'LIVOLTEK'
  access_token text,
  refresh_token text,
  expires_at timestamptz,
  scope text,
  authorized_at timestamptz default now(),
  authorized_by text,
  unique (inverter_sn, manufacturer)
);
```

Y una nueva ruta `/api/inverter/deye/callback` que reciba el `code` y haga el exchange:

```ts
// GET /api/inverter/deye/callback?code=xxx&state=device_id
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  // POST a https://api.deyecloud.com/v1.0/oauth/token con grant_type=authorization_code
  // Guardar tokens en oem_tokens
  // Redirigir al dashboard
}
```

---

## 6️⃣ Plan de pruebas (orden estricto)

**No deployes el cambio a las 28 casas a la vez. Sigue este orden:**

1. **Sandbox / 1 inversor de prueba** — si DEYE/Livoltek tienen entorno sandbox, úsalo
2. **Lectura primero** — implementar solo el `GET .../detail` para confirmar que el auth funciona y que el SN del device existe en el cloud
3. **Comando READ-ONLY sin efecto** — algunas APIs tienen un endpoint `query` o `simulate` que no aplica el cambio. Probar con eso primero.
4. **Un solo inversor real** — elegir una casa "piloto" (ej. Piloto Promigas) y enviar un cos φ = 0.95
5. **Esperar 30 min**, verificar:
   - El inversor sigue conectado (no se cayó)
   - El meter rojo muestra fp más alto
   - No hay flags de alarma activos (`alarm_FSVER`, `alarm_FEM`, etc.)
6. **Roll out gradual** — 1 casa por día durante 1 semana antes de tocar las 28

---

## 7️⃣ Política de seguridad y rate limiting

Cuando esté el adaptador real:

- **Máximo 1 comando por inversor cada 15 min** (deadband + límite de cloud)
- **Máximo 5 comandos en cola** por hora globalmente
- **Confirmar lectura post-comando** — leer `cos_phi_now` después de 2 ciclos del lazo 15 min y verificar que cambió en la dirección esperada
- **Auto-rollback** si después de aplicar un cambio aparece flag de alarma → enviar comando inverso
- **Whitelist de inversores** que se pueden controlar (env var o columna `devices.control_enabled`)
- **Log inmutable** — los registros en `inverter_control_commands` no se pueden borrar (RLS policy)

---

## 8️⃣ Preguntas abiertas para los fabricantes

Cuando contactes a DEYE / Livoltek, pregúntales explícitamente:

### Para DEYE
1. ¿Cuáles endpoints aceptan WRITE para inversores ya comisionados (no de fábrica)?
2. ¿El usuario tiene que aceptar OAuth o el OEM puede operar todos sus inversores con una sola credencial?
3. ¿Rate limit por inversor y por cuenta?
4. ¿Hay sandbox?
5. ¿El cambio de `setPowerFactor` es persistente o se resetea en reinicio del inversor?
6. ¿Cuál es la latencia típica entre el POST y la aplicación real en el inversor?

### Para Livoltek
1. Mismas 6 preguntas
2. Adicional: ¿el portal API expone los mismos parámetros que la app Livoltek Pro Tool? (la app permite cambiar cos φ a nivel instalador)
3. ¿Cómo manejan que muchos inversores tengan el mismo gateway Pulsar? (probablemente cada inversor tiene su propio SN y el control va al SN, no al gateway)

---

## 9️⃣ Estimación de esfuerzo

| Fase | Esfuerzo | Bloqueante |
|---|---|---|
| Conseguir credenciales OEM DEYE | 1-3 semanas | Aprobación de DEYE |
| Conseguir credenciales OEM Livoltek | 2-6 semanas | Acuerdo comercial |
| Implementar adaptador DEYE | 1 día | Tener credenciales |
| Implementar adaptador Livoltek | 1 día | Tener credenciales + swagger leído |
| OAuth callback DEYE | 1/2 día | Saber el flow exacto |
| Tabla `oem_tokens` + lookup | 1/2 día | — |
| Pruebas con 1 inversor piloto | 1 semana | Aprobación cliente |
| Roll-out 28 casas | 1 semana | — |

**Total ~2 semanas de desarrollo + 4-8 semanas de gestión administrativa con fabricantes.**

---

## 🔟 TL;DR

1. **Habla con DEYE y Livoltek esta semana** para iniciar el trámite de credenciales OEM
2. **Pídeles el swagger exacto** y un ejemplo de petición que funcione (algunos te dan un Postman collection)
3. Cuando tengas credenciales, **agregar 5-7 env vars en Vercel** y **redeploy**
4. **Implementar los 2 adaptadores** (`src/lib/inverter-adapters/{deye,livoltek}.ts`) — código template arriba
5. **Reemplazar 3 líneas** en `/api/inverter/command/route.ts` para llamar al adapter
6. **Probar con 1 inversor piloto** durante 1 semana antes de tocar el resto
7. Eventualmente, cuando tengamos confianza, conectar este endpoint al lazo de control de 15 min para que sea automático
