-- ─────────────────────────────────────────────────────────────────
-- Phase 55 — Vínculo con deals de ActiveCampaign (TopLeads)
--
-- El cron /api/cron/import-activecampaign crea proyectos en
-- Dimensionado a partir de deals en la etapa "Contrato firmado"
-- (pipeline Ventas, stage id 47). ac_deal_id guarda el id del deal
-- de origen para no importarlo dos veces.
-- Ver docs/superpowers/specs/2026-07-21-activecampaign-import-design.md
-- ─────────────────────────────────────────────────────────────────

alter table crm_projects
  add column if not exists ac_deal_id text;

create unique index if not exists idx_crm_projects_ac_deal_id
  on crm_projects (ac_deal_id)
  where ac_deal_id is not null;
