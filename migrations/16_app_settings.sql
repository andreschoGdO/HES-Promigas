-- ─────────────────────────────────────────────────────────────────
-- Phase 16 — App settings (configuración global compartida entre usuarios)
--
-- Tabla genérica key-value para opciones que deben ser globales, no
-- por-navegador. La primera consumidora es la visibilidad del menú lateral:
-- antes vivía en localStorage por usuario, ahora se aplica a toda la cuenta.
-- ─────────────────────────────────────────────────────────────────

create table if not exists app_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz default now(),
  updated_by text
);

drop trigger if exists trg_app_settings_updated on app_settings;
create trigger trg_app_settings_updated before update on app_settings
  for each row execute function set_updated_at();
