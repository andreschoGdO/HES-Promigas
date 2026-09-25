-- ─────────────────────────────────────────────────────────────────
-- Phase 70 — Reemplaza el intento de la migración 69.
--
-- La migración 69 agregó 'bitacora' como un tipo de acta más en
-- field_visits (un registro plano por entrada, como todas las demás
-- actas). El usuario aclaró que la idea real es otra: UN contenedor por
-- casa (que se puede cerrar) con MÚLTIPLES entradas adentro — no encaja
-- en el modelo "un evento = un registro" de field_visits.
--
-- Esta migración:
--   1. Revierte 'bitacora' del check constraint de field_visits (vuelve
--      a la lista de la migración 68 — no se borra nada, solo se deja de
--      permitir crear NUEVAS filas con ese visit_type; no había ninguna
--      real en producción, solo la de prueba que ya se borró).
--   2. Crea el modelo nuevo: construction_logs (la bitácora, 1 por casa,
--      con estado abierta/cerrada) + construction_log_entries (las
--      entradas del día a día) + construction_log_entry_photos (fotos
--      por entrada, mismo patrón que field_visit_photos).
--
-- Permisos: igual que las actas — sin RLS en Postgres, el aislamiento
-- "contratista solo ve lo suyo" se aplica en la capa de API con
-- supabaseAdmin (mismo patrón que /api/visits).
-- ─────────────────────────────────────────────────────────────────

alter table field_visits drop constraint if exists field_visits_visit_type_check;
alter table field_visits add constraint field_visits_visit_type_check
  check (visit_type in ('previa', 'instalacion', 'emergencia', 'normalizacion', 'om', 'abastecimiento'));

create table if not exists construction_logs (
  id uuid primary key default gen_random_uuid(),
  house_id uuid references client_houses(id),
  casa text not null,
  contratista text,
  status text not null default 'abierta' check (status in ('abierta', 'cerrada')),
  opened_by text,
  opened_at timestamptz not null default now(),
  closed_by text,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_construction_logs_casa on construction_logs (casa);
create index if not exists idx_construction_logs_status on construction_logs (status);

create table if not exists construction_log_entries (
  id uuid primary key default gen_random_uuid(),
  log_id uuid not null references construction_logs(id) on delete cascade,
  entry_date date not null default current_date,  -- día que describe la entrada
  etapa text,
  clima text,
  descripcion text not null,
  observaciones text,
  lat double precision,
  lng double precision,
  created_by text,
  created_at timestamptz not null default now()    -- fecha real de digitación
);

create index if not exists idx_construction_log_entries_log on construction_log_entries (log_id, entry_date desc);

create table if not exists construction_log_entry_photos (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references construction_log_entries(id) on delete cascade,
  category text,
  storage_path text not null,
  filename text,
  description text,
  size_bytes integer,
  uploaded_by text,
  uploaded_at timestamptz not null default now()
);

create index if not exists idx_construction_log_entry_photos_entry on construction_log_entry_photos (entry_id);
