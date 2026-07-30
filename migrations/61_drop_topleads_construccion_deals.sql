-- ─────────────────────────────────────────────────────────────────
-- Phase 61 — Corrección: "BD Clientes Firmados Construcción" NO sale de
-- TopLeads
--
-- La migración 60 asumió que esta tabla salía del pipeline "Constructoras"
-- de TopLeads (14 deals, uno por conjunto). Con el Excel real de
-- referencia (BD _ Clientes Firmados _ Construcción .xlsx, hojas VALLE/
-- COSTA) quedó claro que es una vista de NUESTRO propio crm_projects,
-- filtrada por zona ('Valle'/'Costa') y contrato_signed_at — un registro
-- por casa/cliente, no por conjunto. Se consulta en vivo (ver
-- /api/topleads/construccion), no hace falta snapshot diario porque ya es
-- nuestra propia base.
-- ─────────────────────────────────────────────────────────────────

drop table if exists topleads_construccion_deals;
