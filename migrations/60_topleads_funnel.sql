-- ─────────────────────────────────────────────────────────────────
-- Phase 60 — Funnel de TopLeads (ActiveCampaign) + BD Clientes
-- Firmados Construcción
--
-- TopLeads tiene 4 pipelines (dealGroups):
--   1 "Prospectos Sunny"      → funnel de ventas (Postulaciones ... Instalados)
--   2 "Postulación Inmuebles" → 1 etapa
--   4 "Constructoras"         → el "CRM de construcción": Contacto Registrado
--                               → Levantamiento → Diseño → Minuta Contractual
--                               → Construcción → No Viable
--   5 "Lista de Espera"
--
-- `topleads_funnel_snapshot` = foto del pipeline 1 (conteo + valor por
-- etapa), para el gráfico de funnel.
-- `topleads_construccion_deals` = foto de TODOS los deals del pipeline 4
-- ("Constructoras") — la "BD Clientes Firmados Construcción" descargable.
--
-- Ambas se REEMPLAZAN completas 1 vez al día (cron) — no se guarda
-- histórico día a día, solo la foto más reciente + cuándo se tomó.
-- ─────────────────────────────────────────────────────────────────

create table if not exists topleads_funnel_snapshot (
  id uuid primary key default gen_random_uuid(),
  pipeline_id text not null,
  pipeline_title text not null,
  stage_id text not null,
  stage_title text not null,
  stage_order int not null,
  deals_count int not null default 0,
  deals_value_total numeric not null default 0,
  captured_at timestamptz not null default now()
);

create index if not exists idx_topleads_funnel_pipeline on topleads_funnel_snapshot (pipeline_id, stage_order);

create table if not exists topleads_construccion_deals (
  id uuid primary key default gen_random_uuid(),
  ac_deal_id text not null unique,
  title text not null,
  stage_id text not null,
  stage_title text not null,
  contact_name text,
  contact_email text,
  contact_phone text,
  value numeric,
  ac_created_at timestamptz,
  ac_updated_at timestamptz,
  captured_at timestamptz not null default now()
);

create index if not exists idx_topleads_construccion_stage on topleads_construccion_deals (stage_id);
