-- ─────────────────────────────────────────────────────────────────
-- Phase 33 — Curtailment DC pre-calculado por casa y por día
--
-- El cálculo del curtailment a partir de Metrum + irradiancia es caro
-- (login + fetch por inversor + integración trapezoidal). Llamarlo en
-- vivo desde el ranking NAR tarda 10–30s para 30 casas.
--
-- Esta tabla guarda el integral diario por casa, computado por el cron
-- nocturno (/api/cron/compute-curtailment). El ranking solo suma estas
-- filas en el rango pedido, y la respuesta es instantánea.
--
-- Granularidad: 1 fila por casa por día. Se sobrescribe si se recalcula
-- el mismo día (idempotente).
-- ─────────────────────────────────────────────────────────────────

create table if not exists daily_curtailment_by_house (
  id uuid primary key default gen_random_uuid(),
  casa text not null,
  house_id uuid references client_houses(id) on delete set null,
  record_date date not null,
  curtailment_kwh numeric not null default 0,    -- kWh perdidos por curtailment en ese día
  devices_count integer not null default 0,     -- cuántos inversores aportaron al cálculo
  source text not null default 'metrum+ghi',    -- por si en el futuro hay otra fuente
  computed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create unique index if not exists uniq_daily_curtailment_casa_date
  on daily_curtailment_by_house (casa, record_date);

create index if not exists idx_daily_curtailment_date
  on daily_curtailment_by_house (record_date desc);

create index if not exists idx_daily_curtailment_casa
  on daily_curtailment_by_house (casa, record_date desc);

comment on table daily_curtailment_by_house is
  'Curtailment DC integrado por día y casa. Lo llena /api/cron/compute-curtailment ejecutado por el scheduler nocturno; el ranking NAR consulta esto en vez de calcular al vuelo.';
