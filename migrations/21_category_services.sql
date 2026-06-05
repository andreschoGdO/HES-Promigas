-- ─────────────────────────────────────────────────────────────────
-- Phase 21 — Categorías de servicios (mano de obra, desmantelamiento)
--
-- Se usa la MISMA tabla inventory_categories para guardar precios estáticos
-- de servicios: mano de obra de instalación, desmantelamiento, puesta en
-- marcha, etc. Las nuevas familias son:
--   - mano_obra
--   - desmantelamiento
--   - puesta_en_marcha
--   - servicio (genérico)
--
-- Un nuevo campo `provider` identifica el proveedor de construcción /
-- contratista que cobra ese precio. La derivación en Facturación matchea:
--   1. provider == project.contractor_name → usa default_cost_cop
--   2. default_brand == una de las marcas instaladas en la casa → usa
--      default_cost_cop (sirve para "instalación específica para Livoltek")
--
-- Las familias preexistentes (inverter, battery, panel, etc.) no se afectan.
-- ─────────────────────────────────────────────────────────────────

alter table inventory_categories
  add column if not exists provider text;

create index if not exists idx_inv_cat_provider on inventory_categories (provider) where provider is not null;
