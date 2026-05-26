-- ─────────────────────────────────────────────────────────────────
-- Phase 6 — Visitas en Campo
-- Tablas para registrar actas de visitas técnicas en celular,
-- con upload de fotos vía Supabase Storage.
--
-- ⚠️ PASO MANUAL: además de aplicar este SQL, hay que crear el bucket de fotos:
--   Supabase Dashboard → Storage → New bucket
--     • Name: visit-photos
--     • Public: NO (usaremos signed URLs)
--     • File size limit: 10 MB
--     • Allowed MIME types: image/*
-- ─────────────────────────────────────────────────────────────────

create table if not exists field_visits (
  id uuid primary key default gen_random_uuid(),
  visit_type text not null check (visit_type in ('previa', 'instalacion', 'emergencia', 'normalizacion')),
  house_id uuid references client_houses(id) on delete set null,
  casa text,                          -- snapshot del nombre por si la casa cambia
  technician_name text,               -- nombre del técnico que hizo la visita
  technician_email text,              -- email del técnico
  visit_date date not null default current_date,
  visit_time time,                    -- hora de la visita
  status text not null default 'draft' check (status in ('draft', 'completed', 'cancelled')),
  -- Datos del formulario por tipo de visita — schema dinámico
  form_data jsonb not null default '{}'::jsonb,
  -- Geolocalización opcional (cuando el celular lo permite)
  lat numeric,
  lng numeric,
  -- Notas generales
  notes text,
  -- Auditoría
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  created_by text,
  completed_at timestamptz
);

create index if not exists idx_visits_recent on field_visits (visit_date desc, created_at desc);
create index if not exists idx_visits_type on field_visits (visit_type, visit_date desc);
create index if not exists idx_visits_casa on field_visits (casa, visit_date desc);
create index if not exists idx_visits_status on field_visits (status, visit_date desc);

create table if not exists field_visit_photos (
  id uuid primary key default gen_random_uuid(),
  visit_id uuid not null references field_visits(id) on delete cascade,
  storage_path text not null,         -- path dentro del bucket visit-photos
  filename text,
  description text,                   -- "antes de instalar", "panel quemado", etc.
  size_bytes integer,
  uploaded_at timestamptz default now(),
  uploaded_by text
);

create index if not exists idx_visit_photos_visit on field_visit_photos (visit_id, uploaded_at desc);

-- Trigger para updated_at
create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_field_visits_updated on field_visits;
create trigger trg_field_visits_updated
  before update on field_visits
  for each row execute function set_updated_at();
