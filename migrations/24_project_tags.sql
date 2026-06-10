-- ─────────────────────────────────────────────────────────────────
-- Phase 24 — Tags por proyecto (sub-estados dentro de cada etapa)
--
-- Cada proyecto puede tener N tags (etiquetas libres) que sirven como
-- sub-estados dentro de su etapa. Ejemplos:
--   - "sin revisar" en Dimensionado
--   - "sin stock" (auto-añadido por el sistema cuando el preflight falla)
--   - "esperando contratista" en Alistamiento
--   - "instalación en pausa" en Instalación
--
-- Los tags NO sustituyen las etapas — son banderas adicionales.
-- ─────────────────────────────────────────────────────────────────

alter table crm_projects
  add column if not exists tags text[] not null default '{}';

create index if not exists idx_crm_projects_tags on crm_projects using gin (tags);
