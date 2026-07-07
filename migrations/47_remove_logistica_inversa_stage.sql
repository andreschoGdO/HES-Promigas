-- ─────────────────────────────────────────────────────────────────
-- Phase 47 — Retirar etapa 'logistica_inversa' del CRM Construcción
--
-- Motivo: garantía y cambio de equipos se gestionan desde el módulo de
-- inventario (por equipo, con status 'in_repair' o 'rma' en items) — no
-- desde el kanban de proyectos. Un proyecto no debería salir del estado
-- Operativo por un ticket de servicio.
--
-- Acciones:
--   1. Mover proyectos en logistica_inversa → operativo
--      (la casa sigue funcionando; los tickets viven en inventario)
--   2. NO se altera el check constraint — se conserva 'logistica_inversa'
--      como valor válido histórico por si alguien queda con custom_data
--      o eventos apuntando a esa etapa. Nuevos proyectos no la usarán
--      porque el catálogo (crm-stages.ts) ya no la expone.
-- ─────────────────────────────────────────────────────────────────

begin;

update crm_projects
   set operations_stage = 'operativo',
       updated_at = now()
 where operations_stage = 'logistica_inversa';

-- Registrar el cambio en el audit log
insert into crm_project_events (project_id, event_type, to_module, to_stage, actor_email, notes)
select id, 'stage_change', 'operations', 'operativo', 'mig-47',
       'Migración 47: etapa logistica_inversa retirada del CRM. Los tickets de garantía se gestionan desde inventario.'
  from crm_projects
 where operations_stage = 'operativo'
   and updated_at::date = current_date;

commit;

-- Verificación:
-- select count(*) from crm_projects where operations_stage = 'logistica_inversa';
-- Esperado: 0
