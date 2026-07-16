# Dash Construcción: Gantt de obra + Curva S + checklist de instalación

Fecha: 2026-07-16
Estado: Aprobado en brainstorming, pendiente de plan de implementación.

## Contexto

El Dash de Construcción (`/dash`, `src/app/dash/page.tsx` + `src/app/api/dash/report/route.ts`)
hoy tiene una diapositiva "Weekly / Construcción" (línea ~384-483 de `dash/page.tsx`) con
stats de la semana, pero no hay ninguna vista de cronograma: no se sabe si una casa va
adelantada o atrasada respecto a lo planeado, ni hay forma de ver de un vistazo el estado
de avance físico de las casas que están en obra.

Se agregan dos diapositivas nuevas justo después de "Weekly Construcción": un **Gantt** de
todas las casas activas con cronograma cargado, y una **curva S** (planeado vs real
acumulado) para medir cumplimiento de cronograma en el tiempo. Para que ambas tengan datos,
se adelanta la captura del cronograma (contratista + fechas) al momento de crear la tarjeta
del proyecto, y se agrega un checklist de 3 hitos en la etapa de Instalación que alimenta un
% de avance físico.

## Alcance

Dentro de este spec:
1. Migración: 3 columnas booleanas de checklist + 1 columna de fecha de inicio de cronograma.
2. Mover contratista + fechas de cronograma a la creación de la tarjeta (Dimensionado).
3. Checklist de 3 preguntas en la etapa Instalación (CRM), con % derivado.
4. Vista de Gantt en `/dash` con 3 filtros (zona, constructor, conjunto).
5. Vista de curva S en `/dash` con filtro de rango de fechas.

Fuera de alcance (explícitamente descartado en el brainstorming):
- El checklist NO bloquea la transición a "Operativo" — es informativo.
- No se crea un selector de "conjuntos existentes"; el campo Conjunto sigue siendo texto
  libre (ya existe hoy en el formulario de creación, sin cambios).
- No se sincroniza el checklist con el Acta de Instalación de `/visitas` — vive únicamente
  en el CRM.
- No se usa ninguna librería de Gantt/charting nueva — se construye con `recharts`, que ya
  es dependencia del proyecto.

## 1. Modelo de datos (migración `54_cronograma_instalacion.sql`)

En `crm_projects`:

```sql
alter table crm_projects add column if not exists cronograma_fecha_inicio date;
alter table crm_projects add column if not exists inst_paneles_dc boolean not null default false;
alter table crm_projects add column if not exists inst_equipos_ac boolean not null default false;
alter table crm_projects add column if not exists inst_config_cierre boolean not null default false;
```

- `installation_date` (ya existe) se reutiliza como **fin** del cronograma planeado — no se
  migra ni se renombra la columna, solo cambia su label en la UI de "Fecha instalación" a
  "Fecha fin cronograma".
- `contractor_name` (ya existe) se reutiliza para "Contratista", sin cambios de columna.
- El % de instalación **no se persiste** — se deriva siempre como
  `count([inst_paneles_dc, inst_equipos_ac, inst_config_cierre] === true) / 3 * 100`
  para no tener dos fuentes de verdad (columna vs cálculo).

## 2. Creación de tarjeta + checklist de instalación

### 2.1 Formulario de creación (`CrmModule.tsx`, modal "Nuevo proyecto en Operaciones")

Se agregan 3 campos requeridos en la sección "Operación" (nueva o junto a la existente,
antes de "Comercial"):
- **Contratista** (texto) → `contractor_name`.
- **Fecha inicio cronograma** (date) → `cronograma_fecha_inicio`.
- **Fecha fin cronograma** (date) → `installation_date` (reutilizado, relabel en UI).

`src/app/api/crm/projects/route.ts` (POST) ya acepta `contractor_name` e
`installation_date` en el payload — solo se agrega `cronograma_fecha_inicio` a la lista de
campos aceptados. Los 3 se marcan `required` en el modal (bloquean el submit si faltan,
igual que "Título" y "Cliente" hoy).

### 2.2 Ajuste a la transición "Iniciar instalación"

En `src/lib/crm-stages.ts`, la transición `operations_to_instalacion` deja de tener
`contractor_name`, `contractor_email` e `installation_date` en `requiredFields` (ya
vienen cargados desde la creación). `contractor_email` se mueve también al formulario de
creación como campo opcional, junto a Contratista.

Los 3 campos siguen siendo editables después (en el detalle del proyecto, sección
"Operación"), por si cambian de contratista o se reprograma el cronograma.

### 2.3 Checklist en la etapa Instalación

En el detalle del proyecto (`CrmModule.tsx`), cuando `operations_stage === 'instalacion'`,
se muestra una nueva `FormSection title="Avance de instalación"` con 3 checkboxes:

- Instalación Paneles y Cableado DC → `inst_paneles_dc`
- Instalación Equipos y Cableado AC → `inst_equipos_ac`
- Configuración Sistema y cierre constructivo → `inst_config_cierre`

Cada toggle dispara un `PATCH /api/crm/projects/[id]` inmediato (autoguardado, mismo patrón
que el resto de campos editables del detalle — no requiere una transición de etapa). El
endpoint ya acepta updates arbitrarios de columnas propias vía el mecanismo existente de
edición de proyecto; solo hay que sumar las 3 columnas a la lista de campos editables
permitidos (`ALLOWED_EDIT_FIELDS` o equivalente en `[id]/route.ts` — se confirma el nombre
exacto en el plan de implementación).

**Progreso visible en 2 lugares:**
- **Tarjeta del Kanban** (etapa Instalación): barra de progreso delgada debajo del nombre,
  con el % (0/33/66/100).
- **Gantt** (bloque 4): relleno proporcional de la barra del proyecto mientras está en
  `instalacion`.

No bloquea "Marcar operativo" — es puramente informativo.

## 3. Vista de Gantt (`/dash`)

Nueva `<section className="card">` insertada inmediatamente después de la sección "Weekly
Construcción" (después de la línea ~483 de `dash/page.tsx`), con
`<SectionHeader eyebrow="Cronograma" title="Gantt de obra" size="large" />` para mantener
la identidad visual de esa diapositiva.

### 3.1 API — `GET /api/dash/gantt`

Nuevo endpoint (no se sobrecarga `dash/report/route.ts`, que ya tiene ~680 líneas). Trae de
`crm_projects` los proyectos con `current_module != 'closed'` que tengan
`cronograma_fecha_inicio` **y** `installation_date` no nulos. Por fila devuelve:

```ts
{
  id, code, cliente_casa: string,       // mismo casaLabel() del report existente
  zona: string, constructor: string | null, conjunto: string | null,
  cronograma_fecha_inicio: string, cronograma_fecha_fin: string, // = installation_date
  operations_stage: string,
  inst_progreso_pct: number,            // 0 | 33 | 66 | 100, calculado server-side
  operativo_at: string | null,
}
```

Sin filtros server-side — se trae todo el set activo (esperado: decenas, no miles de filas)
y se filtra client-side, más simple y evita round-trips al cambiar filtros.

### 3.2 UI — filtros

3 `<select>` encima del chart, poblados dinámicamente con los valores únicos presentes en
la respuesta (no hardcodeados): **Zona**, **Constructor**, **Conjunto residencial**. Cada
uno en modo "Todas" por default, combinables (AND).

### 3.3 UI — chart

`recharts` `BarChart` horizontal (`layout="vertical"`), una fila por proyecto (eje Y =
`cliente_casa`), apilando 2 series por fila:
1. Barra invisible de "offset": días desde el mínimo `cronograma_fecha_inicio` del set
   filtrado hasta el `cronograma_fecha_inicio` de esa fila (`fill="transparent"`).
2. Barra visible de "duración": desde `cronograma_fecha_inicio` hasta `cronograma_fecha_fin`,
   coloreada según `operations_stage`:
   - `dimensionado`/`alistamiento` → gris (`#94a3b8`, aún no arrancó obra).
   - `instalacion` → azul, con opacidad/relleno proporcional a `inst_progreso_pct` (se
     dibuja como 2 sub-barras: la parte "hecha" en azul sólido, el resto en azul claro).
   - `operativo` (o cualquier etapa posterior) → verde (`#10b981`).

Si el set filtrado supera ~25 filas, se ordena por `cronograma_fecha_inicio` ascendente y se
muestra un aviso "Usa los filtros para acotar — mostrando las primeras 25 de N" en vez de
paginar (mantiene el chart legible).

## 4. Curva S (`/dash`)

Nueva `<section className="card">` justo después del Gantt, mismo patrón de header grande:
`<SectionHeader eyebrow="Cronograma" title="Curva S — planeado vs real" size="large" />`.

### 4.1 API — `GET /api/dash/scurve?from=YYYY-MM-DD&to=YYYY-MM-DD`

Nuevo endpoint. Universo: proyectos activos con `installation_date` (fin planeado) dentro
de `[from, to]` — ese conjunto es el denominador (100%). Para cada semana `w` entre `from` y
`to` (inclusive), calcula:

```
planeado[w]  = count(p.installation_date <= w) / total * 100
real[w]      = count(p.operativo_at != null && p.operativo_at <= w) / total * 100
```

Devuelve `{ total: number, points: Array<{ week: string, planeado: number, real: number }> }`.

### 4.2 UI

Dos `<input type="date">` (Desde / Hasta) arriba del chart. Default: `desde = dash_project_start`
(setting existente en `app_settings`, ya usado por `dash/report`) y `hasta = hoy + 60 días`.
Al cambiar cualquiera de los dos, refetch.

`recharts` `LineChart`: eje X = `week` (formateado corto, ej. "12 Ene"), eje Y = 0-100%,
dos líneas: **Planeado** (punteada, gris) y **Real** (sólida, color de marca `#07c5a8`),
tooltip mostrando ambos valores + la diferencia (`real - planeado`) para que se vea de un
vistazo si van adelantados o atrasados.

## Errores y casos borde

- Proyecto sin `cronograma_fecha_inicio`/`installation_date`: no aparece en Gantt ni en
  curva S (no rompe, simplemente se excluye del query).
- `cronograma_fecha_inicio` posterior a `installation_date` (fecha inválida cargada a mano):
  no se valida en este spec — se muestra tal cual (barra "invertida"/de largo 0), se puede
  agregar validación en el formulario de creación (`fecha_inicio <= fecha_fin`) como mejora
  menor durante la implementación.
- Curva S con `total = 0` (ningún proyecto con fin de cronograma en el rango elegido):
  se muestra un estado vacío ("No hay proyectos con cronograma en este rango") en vez de un
  chart con división por cero.
- Checklist: los 3 campos son booleanos independientes, sin orden forzado (se puede marcar
  la 3ra antes que la 1ra) — no se valida secuencia.

## Testing

- Manual: crear un proyecto de prueba con cronograma, moverlo por las etapas, marcar el
  checklist parcialmente y verificar que el % en la tarjeta y en el Gantt coincidan.
- Manual: verificar que los filtros del Gantt combinan correctamente (AND) y que "Todas"
  los limpia.
- Manual: verificar que la curva S no rompe con `total = 0` y que cambiar el rango de
  fechas hace refetch.
- No se agregan tests automatizados — el proyecto no tiene suite de tests hoy (verificado:
  no hay `*.test.ts`/`*.spec.ts` en `webapp/src`), consistente con el resto del código.
