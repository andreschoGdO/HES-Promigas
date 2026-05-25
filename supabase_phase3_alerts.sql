-- ─────────────────────────────────────────────────────────────────
-- Phase 3 — Módulo de Alertas
-- Reglas configurables que el cron evalúa contra daily_casa_metrics.
-- ─────────────────────────────────────────────────────────────────

create table if not exists alert_rules (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  variable text not null,        -- generacion_wh | demanda_wh | yield_real | desempeno_pct | imax_a | gen_dem_pct | exc_gen_pct | imp_dem_pct
  operator text not null,        -- gt | lt | eq | gte | lte
  threshold numeric not null,
  severity text not null,        -- high | medium | low
  enabled boolean not null default true,
  scope text not null default 'all',  -- 'all' o el casa name ej "Casa 10"
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_alert_rules_enabled on alert_rules (enabled);

create table if not exists alert_events (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid not null references alert_rules(id) on delete cascade,
  house_id uuid references client_houses(id) on delete set null,
  casa text not null,
  record_date date not null,
  variable text not null,
  value numeric,
  threshold numeric,
  operator text,
  severity text not null,
  message text not null,
  fired_at timestamptz default now(),
  acknowledged boolean default false,
  acknowledged_at timestamptz,
  unique (rule_id, house_id, record_date)  -- no duplicar el mismo evento
);

create index if not exists idx_alert_events_fired on alert_events (fired_at desc);
create index if not exists idx_alert_events_severity on alert_events (severity, acknowledged);
create index if not exists idx_alert_events_house on alert_events (house_id, fired_at desc);

-- Seed de reglas iniciales útiles
insert into alert_rules (name, description, variable, operator, threshold, severity, scope) values
  ('Generación crítica baja', 'Generación diaria menor a 5 kWh', 'generacion_wh', 'lt', 5000, 'high', 'all'),
  ('Desempeño (PR) bajo', 'Performance Ratio menor al 60%', 'desempeno_pct', 'lt', 60, 'medium', 'all'),
  ('Yield Real bajo', 'Yield Real menor a 3 kWh/kWp', 'yield_real', 'lt', 3, 'medium', 'all'),
  ('Corriente máxima alta', 'Imax mayor a 100 A (pico de demanda)', 'imax_a', 'gt', 100, 'medium', 'all'),
  ('Importación red excesiva', 'Más del 80% de demanda viene de la red', 'imp_dem_pct', 'gt', 80, 'low', 'all')
on conflict do nothing;
