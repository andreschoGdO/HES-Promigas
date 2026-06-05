-- ─────────────────────────────────────────────────────────────────
-- Phase 20 — Costo por categoría de inventario
--
-- En lugar de capturar el `acquired_cost_cop` en cada serial individual,
-- ahora se puede fijar UN precio por modelo (categoría). Cuando un item
-- no tiene su propio costo, Facturación cae al default de la categoría.
--
-- Flujo recomendado:
--   1. En /inventario → Categorías, fija el costo unitario de cada modelo
--      (ej. "Livoltek HP3-10KL2 = 5,200,000 COP").
--   2. Al recibir nuevos equipos, no necesitas re-capturar el precio.
--   3. Facturación suma el precio del modelo × cantidad de items instalados.
--   4. Si UN equipo tuvo un precio especial (descuento, importación),
--      capturas `acquired_cost_cop` en ese serial y prevalece sobre la categoría.
-- ─────────────────────────────────────────────────────────────────

alter table inventory_categories
  add column if not exists default_cost_cop numeric;
