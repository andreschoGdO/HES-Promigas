-- ─────────────────────────────────────────────────────────────────
-- Phase 49 — Ampliar opciones de agpe_estado
--
-- Mig 39 permitía: Radicado, En revisión, Aprobado, Rechazado.
-- Se agregan las opciones operativas del flujo real:
--   - Con visita (visita previa del operador de red)
--   - Legalizada (aprobada + habilitada para venta de excedentes)
--
-- Aprobado y Rechazado se conservan por compatibilidad con datos históricos.
-- ─────────────────────────────────────────────────────────────────

begin;

alter table crm_projects drop constraint if exists crm_projects_agpe_estado_check;
alter table crm_projects add constraint crm_projects_agpe_estado_check
  check (agpe_estado is null or agpe_estado in (
    'Con visita', 'Radicado', 'En revisión', 'Legalizada',
    'Aprobado', 'Rechazado'
  ));

commit;
