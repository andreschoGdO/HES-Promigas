-- ─────────────────────────────────────────────────────────────────
-- Phase 59 — Una OC puede mezclar líneas de construcción (por kWp) y
-- líneas de otro tema (costo fijo, ej. "Sistema Medida Direct")
--
-- La OC real 4200028778 (Estruccon) trae en la MISMA orden:
--   - "MANO DE OBRA Y BOS AUTOGENERACION" → proporcional a los 205.28 kWp
--     del proyecto (línea de construcción)
--   - "SISTEMA MEDIDA DIRECT" → costo fijo del proyecto, nada que ver con
--     kWp de paneles (otro tema)
--
-- Antes el kWp de la OC se prorrateaba sobre valor_total completo, mezclando
-- ambos temas en un solo $/kWp — incorrecto. Ahora:
--   1. kwp_total pasa a ser opcional (una OC puede ser 100% "otro tema").
--   2. El precio $/kWp de construcción se deriva SOLO de los items cuya
--      categoria es de construcción (ver CONSTRUCTION_CATEGORIES en
--      src/lib/purchase-orders.ts), no del valor_total completo.
--   3. Cada casa asignada a la OC puede llevar kwp_asignado (para la parte
--      de construcción) Y/O monto_fijo (para la parte de otro tema,
--      capturado a mano por casa — no hay una regla automática de reparto).
-- ─────────────────────────────────────────────────────────────────

alter table purchase_orders
  alter column kwp_total drop not null;

alter table purchase_order_addendum_items
  add column if not exists codigo_servicio text;

alter table purchase_order_house_assignments
  alter column kwp_asignado drop not null,
  add column if not exists monto_fijo numeric check (monto_fijo >= 0);

alter table purchase_order_house_assignments
  drop constraint if exists purchase_order_house_assignments_kwp_asignado_check;
alter table purchase_order_house_assignments
  add constraint purchase_order_house_assignments_check
    check (kwp_asignado is not null or monto_fijo is not null);
