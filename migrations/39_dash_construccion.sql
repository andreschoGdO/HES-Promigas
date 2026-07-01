-- ─────────────────────────────────────────────────────────────────
-- Phase 39 — Datos para el Dash de Construcción
--
-- Cubre lo que el reporte semanal necesita y hoy no existe:
--   1. `zona` en crm_projects (Norte / Interior / Sur)
--   2. Nueva etapa `legalizacion` en operations_stage (AGPE)
--      + campos para el trámite (operador de red, estado, fecha estimada)
--   3. Campos de garantía por proyecto (falla, retorno a bodega)
--      — la etapa `logistica_inversa` ya existe (mig 29)
--   4. Meta anual de casas + tiempos máximos por etapa (stand-by)
--      en app_settings, editables desde /configuracion.
--
-- Stand-by NO es un campo: se deriva. Un proyecto está en stand-by si
-- `updated_at` de su etapa actual lleva más días que el umbral configurado.
-- ─────────────────────────────────────────────────────────────────

-- 1) Zona geográfica (para la tabla "Casas y CAPEX por Zona" del reporte)
alter table crm_projects
  add column if not exists zona text
    check (zona in ('Norte', 'Interior', 'Sur'));

create index if not exists idx_crm_proj_zona on crm_projects (zona);

-- 2) Nueva etapa `legalizacion` (trámite AGPE ante el operador de red)
alter table crm_projects drop constraint if exists crm_projects_operations_stage_check;
alter table crm_projects add constraint crm_projects_operations_stage_check
  check (operations_stage in (
    'pending',
    'visita_previa',
    'dimensionamiento',
    'dimensionado',
    'alistamiento',
    'instalacion',
    'legalizacion',         -- NUEVO: AGPE
    'operativo',
    'logistica_inversa',    -- garantía / cambio de equipos
    'desistido',
    'sin_renovacion',
    'legalizado',           -- legacy
    'completado'
  ));

-- Campos de trámite AGPE (usados cuando el proyecto está en `legalizacion`)
alter table crm_projects
  add column if not exists agpe_operador_red text,
  add column if not exists agpe_estado text
    check (agpe_estado in ('Radicado', 'En revisión', 'Aprobado', 'Rechazado')),
  add column if not exists agpe_fecha_estimada date,
  add column if not exists agpe_fecha_aprobacion date;

create index if not exists idx_crm_proj_agpe_estado on crm_projects (agpe_estado)
  where agpe_estado is not null;

-- 3) Campos de garantía / postventa
-- (proyectos en etapa `logistica_inversa` completan estos campos)
alter table crm_projects
  add column if not exists garantia_marca text,
  add column if not exists garantia_equipo text,
  add column if not exists garantia_falla text,
  add column if not exists garantia_estado text
    check (garantia_estado in ('Abierto', 'En revisión', 'Reemplazo aprobado', 'Resuelto en sitio', 'Cerrado')),
  add column if not exists garantia_retorno_bodega date;

-- 4) Configuración global editable desde /configuracion
insert into app_settings (key, value)
values
  ('dash_meta_anual_casas', '{"value": 230}'::jsonb),
  ('dash_standby_dias', '{
      "dimensionado": 14,
      "alistamiento": 10,
      "instalacion": 7,
      "legalizacion": 21,
      "logistica_inversa": 30
    }'::jsonb),
  ('dash_solucion_umbrales', '{
      "sol1_max_paneles": 5,
      "sol2_max_paneles": 10,
      "sol3_max_paneles": 16,
      "sol4_max_paneles": 19
    }'::jsonb)
on conflict (key) do nothing;
