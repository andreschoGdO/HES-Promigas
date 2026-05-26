# Variables instantáneas y diseño del lazo de control

Este documento explica **qué se puede monitorear en tiempo real (≤ 15 min)** desde Metrum
y propone una arquitectura de cron + reglas para detectar problemas operativos como:

- Penalización CREG por reactiva acumulada
- Sobrepaso de límites del medidor (ej. 80 A)
- Inversor caído o en alarma
- Batería con SoC peligrosamente bajo (DEYE)
- Desbalance de fases

> Acompaña a [`METRUM_VARIABLES.md`](./METRUM_VARIABLES.md) — ese doc tiene el catálogo completo
> de keys. Este se enfoca en cuáles **son instantáneas y útiles para alarmar**.

---

## ⏱️ Frecuencia real de cada variable en Metrum

Esta es la verdad de fondo. **No importa con qué frecuencia llamemos a Metrum, los datos
se refrescan a su propio ritmo**:

| Variable | Refresco real | Por qué |
|---|---|---|
| `CenergyAI/AE/RI/RE` (cierres diarios) | **1 vez/día** a las 00:00 COT (05:00 UTC) | Snapshot oficial que Metrum guarda como "lectura del día" |
| `energyAI`, `energyRI` (cumulativas instantáneas) | **cada ~15 min** | Pulsar reporta cada ciclo |
| `currentA/B/C` (corriente RMS por fase) | **cada ~15 min** | Mismo ciclo Pulsar |
| `powerAI` (potencia activa W) | **cada ~15 min** | Mismo ciclo |
| `powerRI` (potencia reactiva var) | **cada ~15 min** | Mismo ciclo |
| `TLBattSOC`, `TLinvstate` (estado DEYE) | **cada ~15 min** | Inversor publica vía MQTT |
| `active`, `lastActivityTime` (estado conexión) | **cada ping** del Pulsar (~5 min) | Heartbeat del gateway |
| `flag*` (alarmas Livoltek) | **al cambiar** (event-driven) | Solo se actualiza cuando dispara/limpia |
| `invbrand`, `invmodel`, `invcap` (metadata) | **estático** | Solo cambia si re-comisionan equipo |

**Conclusión operativa**: monitorear cada 15 min tiene sentido para corriente, potencia,
estado de inversor/batería y alarmas. Para energía cumulativa diaria, una vez al día basta.

---

## 🔧 Qué se puede vigilar en tiempo real

### Capa 1 — Eléctrica (medidor red, cada 15 min)

| Variable | Para qué sirve | Umbral típico residencial |
|---|---|---|
| `currentA/B/C` | Detectar pico que se acerca al rating del breaker | 80 A trifásico → alarma a 70 A (87.5%) |
| `powerAI` | Demanda activa actual en W | 50 kW (residencial alto) → alarma a 45 kW |
| `powerRI` | Reactiva inductiva instantánea | fp = P / √(P²+Q²) — alarma si fp < 0.9 |
| Δ `energyRI` / Δ `energyAI` (15 min) | Ratio reactiva/activa **rolling** | Si > 50% sostenido → ya estás causando penalización CREG |
| Diferencia entre fases | Desbalance — daña neutros y trips intempestivos | > 30% entre fases → alarma |

### Capa 2 — Inversor (cada 15 min)

| Variable | Para qué sirve | Acción |
|---|---|---|
| `TLinvstate` (DEYE) | "off" inesperado | Push notificación inmediata, técnico a la casa |
| Livoltek `flag*` alarmas | Sobre-temperatura, sobre-voltaje DC, isla, etc. | Cada flag tiene severidad propia |
| `currentA/B/C` (inverter) | Salida real del inversor | Si está en 0 con sol → falla; si está en max sostenido → derate o saturación |
| `TLBattSOC` (DEYE) | Carga batería | < 15% en horas sin sol → no podrá soportar corte de red |

### Capa 3 — Gateway (cada ping ~5 min)

| Variable | Para qué |
|---|---|
| `active = false` | Pulsar offline → toda la casa "muda" |
| `lastDisconnectTime` reciente | Caída del 4G / corte energía → SLA del servicio |
| `inactivityAlarmTime` | Trigger del threshold que ya tiene Metrum |

### Capa 4 — Energía acumulada (1 vez/día, a las 01:00 COT)

| Variable | Para qué |
|---|---|
| `CenergyAI/AE/RI/RE` cierres | Cálculo oficial de facturación / penalización CREG mensual |
| `CenergyAE` del inversor | Yield real diario |
| Aggregación mensual de reactiva | Proyección de penalización del mes (lo que ya tienes en el tab CREG) |

---

## 🏗️ Arquitectura propuesta del lazo de control

### Estado actual (1 cron diario)

```
06:00 UTC (= 01:00 COT) ───┐
                            │
                            ▼
                  /api/cron/sync (Vercel Cron)
                            │
                            ├─ devices/sync   (10s)
                            ├─ houses/build   (5s)
                            ├─ sync/all       (60s)  ← cierres diarios
                            ├─ sync/consumption (90s) ← consumo diario
                            ├─ casa metrics compute (5s)
                            └─ alerts/evaluate (2s)  ← solo reglas DIARIAS
```

### Estado propuesto (2 crons paralelos)

```
06:00 UTC ────────────────────┐                  *​/15 * * * * (cada 15 min)
                              │                          │
                              ▼                          ▼
                  /api/cron/sync            /api/cron/instant-check
                              │                          │
                              ├─ devices/sync            ├─ Para cada casa activa:
                              ├─ houses/build            │  ├─ Fetch currentA/B/C
                              ├─ sync/all                │  ├─ Fetch powerAI, powerRI
                              ├─ sync/consumption        │  ├─ Fetch TLBattSOC (DEYE)
                              ├─ casa metrics compute    │  └─ Fetch TLinvstate (DEYE)
                              └─ alerts/evaluate (daily) ├─ Upsert en `instant_metrics`
                                                          └─ alerts/evaluate (instant)
```

**Tablas adicionales:**

```sql
create table instant_metrics (
  id uuid primary key default gen_random_uuid(),
  house_id uuid references client_houses(id),
  casa text,
  recorded_at timestamptz not null,        -- timestamp del sample Metrum
  -- meter rojo
  current_a_max numeric,                   -- max(currentA, B, C) actual
  power_active_w numeric,                  -- powerAI último valor
  power_reactive_var numeric,              -- powerRI último valor
  cos_phi_now numeric,                     -- P/√(P²+Q²)
  fase_max_imbalance_pct numeric,          -- |max-min| / max × 100
  -- inversor
  inv_state text,                          -- TLinvstate ("on"/"off") o derivado de active
  inv_current_a_max numeric,
  batt_soc numeric,                        -- TLBattSOC (DEYE)
  -- gateway
  gateway_online boolean,
  created_at timestamptz default now(),
  unique (house_id, recorded_at)
);

create index idx_instant_metrics_recent on instant_metrics (recorded_at desc);
create index idx_instant_metrics_house on instant_metrics (house_id, recorded_at desc);
```

**Variables nuevas para reglas (set "instant"):**

```ts
const INSTANT_VARIABLES = [
  'current_a_max',         // A — pico de corriente últimos 15 min
  'power_active_kw',       // kW — demanda activa actual
  'power_reactive_kvar',   // kvar — reactiva actual
  'cos_phi_now',           // 0-1 — fp instantáneo
  'fase_max_imbalance_pct',// % — desbalance entre fases
  'batt_soc',              // % — SoC batería
  'inv_state',             // 'on'/'off' (categórica, operator='eq')
  'gateway_offline_min',   // minutos sin reportar — derivado
];
```

---

## 🚦 Reglas seed propuestas (para el cron 15 min)

| Regla | Variable | Operador | Umbral | Severidad | Caso de uso |
|---|---|---|---|---|---|
| **Corriente cercana al rating del breaker** | `current_a_max` | `gt` | 70 (87% de 80 A) | medium | Pre-trip del breaker — pedir bajar demanda |
| **Sobrepaso de breaker** | `current_a_max` | `gt` | 80 | high | YA está en zona de trip — riesgo inmediato |
| **Demanda alta sostenida** | `power_active_kw` | `gt` | 45 | medium | Acercándose a contratada |
| **Factor de potencia bajo en vivo** | `cos_phi_now` | `lt` | 0.9 | medium | Penalización acumulándose ahora mismo |
| **Desbalance de fases** | `fase_max_imbalance_pct` | `gt` | 30 | medium | Daña neutros, sobrecarga monofásica |
| **Batería críticamente baja** | `batt_soc` | `lt` | 15 | high | Sin respaldo si corta la red |
| **Inversor apagado inesperado** | `inv_state` | `eq` | `off` | high | Cero generación |
| **Gateway offline > 15 min** | `gateway_offline_min` | `gt` | 15 | high | Casa muda |

> El umbral del breaker es por casa (algunas pueden ser 50 A, otras 100 A). La columna
> `alert_rules.scope` ya soporta "all" o un nombre de casa específico — perfecto para
> reglas individualizadas tipo "Casa 10 breaker 80A" vs "Casa 76 breaker 100A".

---

## 💰 Costo y opciones de disparador

Vercel Hobby = cron solo diario. Para 15 min hay 4 caminos:

| Opción | Costo | Pros | Contras |
|---|---|---|---|
| **GitHub Actions** workflow `*/15 * * * *` | Gratis ilimitado | Cero configuración extra, ya tenemos el repo | Ligera latencia (workers compartidos) |
| **cron-job.org** | Gratis hasta 50 jobs | UI bonita, manda alerts si el endpoint falla | Servicio externo dependiente |
| **Supabase pg_cron** | Gratis | Corre dentro de Supabase, sin red extra | Requiere extensión + escribir lógica en SQL/plpgsql |
| **Vercel Pro** | USD $20/mes | Cero migración, mismo proveedor | Costo recurrente |

**Recomendación**: GitHub Actions. El workflow vive en `.github/workflows/instant-check.yml`,
usa el `CRON_SECRET` que ya está en Vercel env, y se puede pausar/desactivar editando un
toggle del repo.

Ejemplo de workflow (pendiente crear si se aprueba):

```yaml
name: Instant alerts check
on:
  schedule:
    - cron: '*/15 * * * *'
  workflow_dispatch: {}

jobs:
  ping:
    runs-on: ubuntu-latest
    steps:
      - name: Trigger instant check
        run: |
          curl -fsSL \
            -H "Authorization: Bearer ${{ secrets.CRON_SECRET }}" \
            https://sunnyhes.vercel.app/api/cron/instant-check
```

---

## 🔁 Reactiva en vivo — el caso particular que mencionaste

Hoy las reglas reactivas se evalúan **month-to-date** (acumulado del mes). Eso responde
"¿la casa va a ser penalizada este mes?". Pero NO responde "¿en este momento está
consumiendo reactiva en exceso?".

Con el cron 15 min agregaríamos **2 capas de reactiva en vivo**:

1. **fp instantáneo** (`cos_phi_now`) — calculado de `powerAI` y `powerRI` del meter rojo:
   ```
   cos_phi = powerAI / √(powerAI² + powerRI²)
   ```
   Si `< 0.9` → la casa ESTÁ generando excedente reactivo ahora mismo. Si esto persiste
   por varias ventanas de 15 min, la regla mensual eventualmente disparará la alerta CREG.

2. **Δ reactiva acumulada en 15 min** — usa `energyRI` y `energyAI` (las versiones
   instantáneas, no las Cenergy*):
   ```
   ratio_15min = (energyRI[t] − energyRI[t-15min]) / (energyAI[t] − energyAI[t-15min])
   ```
   Si > 50% sostenido durante 1 hora → trigger temprano de "Casa va camino a penalización".

Esto nos permite **avisar al cliente DENTRO del mes** (no a fin de mes cuando ya facturaron).

---

## 📋 Próximos pasos sugeridos

1. **Aprobar arquitectura** del cron 15 min (esta propuesta o variante)
2. **Crear migración SQL** para `instant_metrics` + índices
3. **Crear `/api/cron/instant-check`** que:
   - Recorra las 28 casas
   - Por cada una, fetch keys instantáneas del meter rojo + inversor (con `agg=NONE` o `AVG` últimos 15 min)
   - Calcule derivadas (cos_phi, imbalance)
   - Upsert en `instant_metrics`
   - Evalúe reglas con `INSTANT_VARIABLES`
4. **Extender `alerts_rules`** para distinguir tipo: `daily` vs `instant`
5. **Setup GitHub Actions workflow** apuntando al endpoint
6. **Seed inicial de 8 reglas** (las de la tabla arriba) — todas opcionales/configurables
7. **Capturar las `flag*` de Livoltek** como parte del paso 3 para alarmas de fábrica

Estimación: 4-6 horas de trabajo total.

---

## ❓ Decisiones pendientes que necesito de ti

- ¿Umbral del breaker es **mismo para todas las casas** o cada una tiene su rating? Si es individual, puedes editarlo en `alert_rules.scope` por casa.
- ¿Aceptas la **latencia 15 min** o necesitas más rápido? (Pulsar reporta cada 15 min, ir más frecuente no daría datos nuevos).
- ¿Las **alarmas de inversor Livoltek (`flag*`)** son prioritarias para esta primera versión? Si sí, hay que mapear cada flag a un mensaje legible (sobre-voltaje, sobre-temperatura, etc.).
- ¿Tiene sentido que cada casa tenga su **propia política** de reactiva (algunos cliente pueden negociar diferente con el comercializador)?
