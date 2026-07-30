-- ─────────────────────────────────────────────────────────────────
-- Phase 58 — Presupuesto anual (APU: Análisis de Precios Unitarios)
--
-- Tabla editable por año, mismo formato que el Excel "APU Compras equipos
-- 2026" que ya usan: 11 grupos (Inversor, Batería, BMS, Equipos
-- adicionales, Medidores, Modem, Paneles, Puntos de anclaje, Análisis
-- estructural, Mano de obra, Factibilidad), cada uno con sus líneas
-- (item_numero '1.1', '7.2', etc).
--
-- `grupo_nombre` usa la MISMA lista de nombres que
-- `purchase_order_items.categoria` (fase 56) — la comparación
-- presupuestado-vs-ejecutado (`/api/budget/execution`) agrega por ese
-- nombre, SIN vincular líneas 1 a 1 con las de las OC (decisión tomada:
-- demasiado trabajo manual mantener ese vínculo, y no lo pidieron así).
--
-- `precio_cop` y `precio_total` se calculan en la app (precio_usd × trm,
-- precio_cop × cantidad) pero se GUARDAN acá — si la TRM de referencia
-- cambia después, el histórico de un año cerrado no se mueve solo.
-- TOTAL / IVA 19% / GRAN TOTAL del año se calculan al vuelo con un
-- `sum(precio_total)`, no se guardan (evita que queden desactualizados).
-- ─────────────────────────────────────────────────────────────────

create table if not exists budget_items (
  id uuid primary key default gen_random_uuid(),
  anio int not null,
  grupo_numero int not null,
  grupo_nombre text not null,
  item_numero text not null,
  referencia text,
  descripcion text not null,
  precio_usd numeric,
  trm numeric,
  cantidad numeric not null default 0,
  precio_cop numeric,
  precio_total numeric,
  created_by text,
  updated_by text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (anio, item_numero)
);

create index if not exists idx_budget_items_anio on budget_items (anio);
create index if not exists idx_budget_items_grupo on budget_items (anio, grupo_nombre);

drop trigger if exists trg_budget_items_updated on budget_items;
create trigger trg_budget_items_updated before update on budget_items
  for each row execute function set_updated_at();
