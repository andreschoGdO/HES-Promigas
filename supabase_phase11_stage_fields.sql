-- ─────────────────────────────────────────────────────────────────
-- Phase 11 — Configurador de campos por etapa
--
-- Permite que el usuario haga click en el título de una etapa del kanban
-- y vea/agregue/quite los campos que se piden al avanzar A esa etapa.
--
-- Los campos default se siembran automáticamente desde el código la primera
-- vez que se consulta una etapa (vía el endpoint /api/crm/stage-fields).
-- Después, la BD es la fuente de verdad.
--
-- Los campos "default" mapean a columnas físicas de crm_projects.
-- Los campos "custom" (agregados desde el UI) se guardan en custom_data JSONB.
-- ─────────────────────────────────────────────────────────────────

-- 1. Columna JSONB para campos personalizados que no tienen columna física
alter table crm_projects
  add column if not exists custom_data jsonb not null default '{}'::jsonb;

-- 2. Tabla de configuración: lista de campos pedidos por (módulo, etapa)
create table if not exists crm_stage_fields (
  id uuid primary key default gen_random_uuid(),
  module text not null check (module in ('sales', 'engineering', 'operations')),
  stage text not null,
  field_key text not null,
  field_label text not null,
  field_type text not null check (field_type in ('text','textarea','number','date','datetime','email','url','select')),
  options jsonb,                       -- array de strings para field_type='select'
  required boolean not null default false,
  placeholder text,
  help text,
  sort_order integer not null default 0,
  is_custom boolean not null default false,   -- true = agregado por usuario; false = seeded default
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (module, stage, field_key)
);

create index if not exists idx_crm_sf_lookup on crm_stage_fields (module, stage, sort_order);

drop trigger if exists trg_crm_sf_updated on crm_stage_fields;
create trigger trg_crm_sf_updated before update on crm_stage_fields
  for each row execute function set_updated_at();
