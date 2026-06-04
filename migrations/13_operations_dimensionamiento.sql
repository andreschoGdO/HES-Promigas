-- ─────────────────────────────────────────────────────────────────
-- Phase 13 — Operations workflow: Dimensionamiento como primera etapa
--
-- Cambios:
--   1. operations_stage acepta 'dimensionamiento' (mantenemos 'visita_previa'
--      como valor histórico válido para no romper data existente)
--   2. Renombra valores existentes 'visita_previa' → 'dimensionamiento'
--   3. (Opcional) agrega columna diseno_baterias_cantidad para registrar
--      cuántas baterías lleva el diseño aprobado
-- ─────────────────────────────────────────────────────────────────

-- 1. Ampliar el check constraint para incluir 'dimensionamiento'
alter table crm_projects drop constraint if exists crm_projects_operations_stage_check;
alter table crm_projects add constraint crm_projects_operations_stage_check
  check (operations_stage in (
    'pending',
    'visita_previa',       -- legacy: mantenido para no romper data existente
    'dimensionamiento',    -- nueva primera etapa
    'alistamiento',
    'instalacion',
    'operativo',
    'legalizado',
    'completado'
  ));

-- 2. Migrar proyectos existentes que estaban en visita_previa
update crm_projects
   set operations_stage = 'dimensionamiento'
 where operations_stage = 'visita_previa';

-- 3. Nueva columna para cantidad de baterías del diseño aprobado
alter table crm_projects
  add column if not exists diseno_baterias_cantidad integer;
