-- ─────────────────────────────────────────────────────────────────
-- Phase 23 — Consumibles en reservas
--
-- Las reservas hasta ahora solo soportaban items serializados (1 fila por
-- serial individual). Agregamos consumibles (cable, breakers, conectores)
-- con cantidad por línea.
--
-- Modelo:
--   - Una reserva puede tener N líneas de consumibles
--   - Cada línea apunta a un inventory_consumables.id con su quantity
--   - Al CONFIRMAR la reserva: stock_quantity -= quantity (con guard ≥ 0)
--     y se genera un movimiento type='reserve' + consumable_id en inventory_movements
--   - Al CANCELAR la reserva: stock_quantity += quantity (restitución)
--   - Al FULFILL: no cambia el stock (ya se descontó al confirmar) — solo
--     se marca fulfilled_at en la línea para auditoría
--
-- inventory_movements ya soporta consumable_id + quantity desde phase 7.
-- ─────────────────────────────────────────────────────────────────

create table if not exists inventory_reservation_consumables (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references inventory_reservations(id) on delete cascade,
  consumable_id uuid not null references inventory_consumables(id) on delete restrict,
  quantity numeric not null check (quantity > 0),
  fulfilled_at timestamptz,
  created_at timestamptz default now()
);

create index if not exists idx_resv_cons_reservation on inventory_reservation_consumables (reservation_id);
create index if not exists idx_resv_cons_consumable on inventory_reservation_consumables (consumable_id);
create unique index if not exists uniq_resv_cons on inventory_reservation_consumables (reservation_id, consumable_id);
