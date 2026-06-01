-- ─────────────────────────────────────────────────────────────────
-- Phase 14 — Rename dimensionamiento → dimensionado + remove legalizado
--
-- Operations queda con 4 etapas:
--   Dimensionado → Alistamiento → Instalación → Operativo → (closed)
--
-- Legalizado se descarta como etapa intermedia. Los proyectos que estaban en
-- legalizado se migran directo a current_module='closed'.
-- ─────────────────────────────────────────────────────────────────

-- 1. Ampliar el check para incluir 'dimensionado' (mantener legacy values para no romper data)
alter table crm_projects drop constraint if exists crm_projects_operations_stage_check;
alter table crm_projects add constraint crm_projects_operations_stage_check
  check (operations_stage in (
    'pending',
    'visita_previa',       -- legacy fase 11
    'dimensionamiento',    -- legacy fase 13
    'dimensionado',        -- NUEVO nombre canónico
    'alistamiento',
    'instalacion',
    'operativo',
    'legalizado',          -- legacy: ya no se usa como etapa intermedia
    'completado'
  ));

-- 2. Migrar proyectos en dimensionamiento → dimensionado
update crm_projects
   set operations_stage = 'dimensionado'
 where operations_stage = 'dimensionamiento';

-- 3. Cerrar proyectos que estaban en legalizado (asumimos terminados)
update crm_projects
   set current_module = 'closed',
       operations_stage = 'completado',
       closed_at = coalesce(closed_at, legalizado_at, now())
 where operations_stage = 'legalizado';

-- legalizado_at se queda como columna por si algún proyecto cerrado tiene ese timestamp
-- (se sigue usando como referencia de fecha de cierre).

-- 4. Nuevos campos para la card de Dimensionado (creación manual en Operaciones
-- o llegada por API externa)
alter table crm_projects
  add column if not exists conjunto text,                              -- "CONDOMINIO BOSQUES DE PANCE"
  add column if not exists casa_numero text,                           -- "1" (puede ser alfanumérico: "1A", "1p", etc.)
  add column if not exists carga_carro_electrico text,                 -- "Sí - tipo X" / "No tenemos carro eléctrico" / etc.
  add column if not exists autosuficiencia_objetivo_pct numeric;       -- objetivo de cobertura solar (ej. 90)

