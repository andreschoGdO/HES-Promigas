-- ─────────────────────────────────────────────────────────────────
-- Phase 65 — Catálogo de Contratistas
--
-- Antes, "Contratista" y "Email del contratista" eran texto libre escrito
-- a mano en cada proyecto (Cronograma de instalación, etapa Dimensionado)
-- — se repetía el mismo nombre/correo una y otra vez, con riesgo de typos
-- y sin un solo lugar para corregir un dato. Mismo patrón que
-- inventory_categories: un catálogo reusable, se elige de una lista en vez
-- de volver a escribir.
--
-- crm_projects.contractor_name / contractor_email se mantienen (siguen
-- siendo lo que se guarda en el proyecto, y de ahí lee todo lo demás —
-- Planner, OC, etc.) — el catálogo solo alimenta el selector, no reemplaza
-- esas columnas.
-- ─────────────────────────────────────────────────────────────────

create table if not exists contratistas (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique,
  email text,
  telefono text,
  empresa text,
  activo boolean not null default true,
  created_by text,
  created_at timestamptz not null default now()
);

create index if not exists idx_contratistas_activo on contratistas (activo);

-- Backfill: contratistas distintos ya usados en crm_projects.
insert into contratistas (nombre, email)
select distinct on (lower(trim(contractor_name)))
  trim(contractor_name), nullif(trim(contractor_email), '')
from crm_projects
where contractor_name is not null and trim(contractor_name) <> ''
on conflict (nombre) do nothing;
