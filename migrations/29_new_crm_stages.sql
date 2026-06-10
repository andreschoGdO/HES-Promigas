-- ─────────────────────────────────────────────────────────────────
-- Phase 29 — Nuevas etapas post-operativo
--
-- Agrega 3 etapas adicionales para tener control fino del ciclo de vida
-- post-instalación:
--   - logistica_inversa  → ticket de garantía / cambio de equipos
--   - desistido          → cliente desistió (puede ocurrir desde dimensionado o operativo)
--   - sin_renovacion     → fin de contrato, equipos retornan a bodega
-- ─────────────────────────────────────────────────────────────────

alter table crm_projects drop constraint if exists crm_projects_operations_stage_check;
alter table crm_projects add constraint crm_projects_operations_stage_check
  check (operations_stage in (
    'pending',
    'visita_previa',        -- legacy
    'dimensionamiento',     -- legacy
    'dimensionado',
    'alistamiento',
    'instalacion',
    'operativo',
    'logistica_inversa',    -- NUEVO
    'desistido',            -- NUEVO
    'sin_renovacion',       -- NUEVO
    'legalizado',           -- legacy
    'completado'
  ));
