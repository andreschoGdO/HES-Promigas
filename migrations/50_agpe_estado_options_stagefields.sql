-- ─────────────────────────────────────────────────────────────────
-- Phase 50 — Actualizar opciones de agpe_estado en crm_stage_fields
--
-- Mig 49 amplió el check constraint del columna crm_projects.agpe_estado.
-- Pero el dropdown que ve el usuario en el modal de "Legalizar →" carga
-- opciones desde la tabla crm_stage_fields (ver /api/crm/stage-fields).
-- Esa tabla ya tenía sembrada la config con las opciones viejas
-- ['Radicado', 'En revisión'] — mig 50 la actualiza a la lista nueva.
-- ─────────────────────────────────────────────────────────────────

begin;

update crm_stage_fields
   set options = '["Con visita", "Radicado", "En revisión", "Legalizada"]'::jsonb
 where module = 'operations'
   and stage = 'legalizacion'
   and field_key = 'agpe_estado';

commit;

-- Verificación:
-- select field_key, options from crm_stage_fields
--  where module='operations' and stage='legalizacion' and field_key='agpe_estado';
-- Esperado: ["Con visita", "Radicado", "En revisión", "Legalizada"]
