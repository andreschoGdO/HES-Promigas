-- ─────────────────────────────────────────────────────────────────
-- Phase 17 — Planner: agregar columna team (equipo responsable)
--
-- Cada tarea ahora se etiqueta con el equipo dueño: Ingeniería, Operaciones,
-- Construcción, Ventas, Innovación, etc. La columna es texto libre para
-- permitir agregar equipos nuevos sin tocar la BD; el frontend valida contra
-- una lista canónica al crear y al filtrar.
-- ─────────────────────────────────────────────────────────────────

alter table planner_tasks
  add column if not exists team text;

create index if not exists idx_planner_tasks_team on planner_tasks (team);
