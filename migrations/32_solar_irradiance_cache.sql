-- ─────────────────────────────────────────────────────────────────
-- Phase 32 — Cache de irradiancia solar por ciudad
--
-- Para no martillar Open-Meteo, cacheamos GHI (Global Horizontal Irradiance)
-- por ciudad + fecha + hora. Cuando el dashboard pide el envelope ajustado,
-- primero buscamos aquí; solo si falta, llamamos al API y guardamos.
--
-- Granularidad: 1 hora local (COT). Open-Meteo retorna hourly_solar_radiation
-- en W/m² promedio para esa hora.
-- ─────────────────────────────────────────────────────────────────

create table if not exists solar_irradiance_cache (
  id uuid primary key default gen_random_uuid(),
  city text not null,                    -- ej. 'Cali', 'Bogotá'
  date date not null,                    -- fecha local (COT)
  hour integer not null check (hour >= 0 and hour <= 23),  -- hora local 0-23
  ghi_w_m2 numeric not null,             -- W/m²
  source text not null default 'open-meteo',
  created_at timestamptz default now()
);

create unique index if not exists uniq_solar_cache_city_date_hour
  on solar_irradiance_cache (city, date, hour);

create index if not exists idx_solar_cache_city_date
  on solar_irradiance_cache (city, date desc);
