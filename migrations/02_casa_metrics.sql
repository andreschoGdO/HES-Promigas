-- ─────────────────────────────────────────────────────────────────
-- Phase 2 — Tabla de métricas por casa por día (pre-computadas)
-- Reduce la carga de cómputo del dashboard y evita llamadas repetidas al API
-- de Metrum para la corriente máxima.
-- Se rellena vía /api/cron/sync (Vercel Cron cada 1 hora).
-- ─────────────────────────────────────────────────────────────────

create table if not exists daily_casa_metrics (
  id uuid primary key default gen_random_uuid(),
  house_id uuid not null references client_houses(id) on delete cascade,
  casa text not null,
  record_date date not null,

  -- energía (Wh)
  generacion_wh numeric,        -- ΔCenergyAE inversor
  importacion_wh numeric,       -- ΔCenergyAI medidor red
  excedentes_wh numeric,        -- ΔCenergyAE medidor red
  demanda_wh numeric,           -- gen + imp - exc

  -- ratios (%)
  gen_dem_pct numeric,
  exc_gen_pct numeric,
  imp_dem_pct numeric,

  -- rendimiento
  yield_real numeric,           -- kWh/kWp
  desempeno_pct numeric,        -- vs YIELD_TEORICO_REF (4.5)
  potencia_kw numeric,          -- suma de capacity de inversores

  -- corriente máxima del día (A) — max(currentA, B, C) entre inversor y red meter
  imax_a numeric,

  created_at timestamptz default now(),
  updated_at timestamptz default now(),

  unique (house_id, record_date)
);

create index if not exists idx_casa_metrics_date on daily_casa_metrics (record_date desc);
create index if not exists idx_casa_metrics_house on daily_casa_metrics (house_id, record_date desc);

-- ─────────────────────────────────────────────────────────────────
-- Tabla de auditoría del cron — para saber cuándo corrió y si falló
-- ─────────────────────────────────────────────────────────────────

create table if not exists cron_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running',  -- running | success | error | partial
  trigger text not null default 'cron',    -- cron | manual
  steps jsonb,                              -- {devices: 28, houses: 28, cierres: 168, consumo: 196, casa_metrics: 196}
  error_message text
);

create index if not exists idx_cron_runs_started on cron_runs (started_at desc);
