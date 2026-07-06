-- ─────────────────────────────────────────────────────────────────
-- Phase 44 — Reserva de inventario por CANTIDADES (no por seriales)
--
-- Contexto: hoy `inventory_reservation_items` fija seriales específicos al
-- pasar Dimensionado → Alistamiento. Pero los seriales reales solo se
-- conocen el día de la instalación cuando el técnico escanea los QR.
-- Los seriales del catálogo (PEND-LBH-CL-001) son placeholders — no sirven
-- para vincular al proyecto de forma definitiva.
--
-- Nueva tabla `inventory_reservation_lines` guarda la reserva por
-- (categoría × bodega × qty), sin tocar items específicos. Los items solo se
-- marcan como `installed` cuando el acta de instalación aporta los seriales
-- reales.
--
-- La tabla vieja `inventory_reservation_items` NO se borra por compatibilidad
-- retroactiva (las reservas existentes siguen funcionando con el modelo viejo).
-- Nuevas reservas usan el modelo por líneas.
-- ─────────────────────────────────────────────────────────────────

begin;

create table if not exists inventory_reservation_lines (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references inventory_reservations(id) on delete cascade,
  category_id uuid not null references inventory_categories(id) on delete restrict,
  warehouse_id uuid not null references warehouses(id) on delete restrict,
  qty_reserved integer not null check (qty_reserved > 0),
  qty_delivered integer not null default 0 check (qty_delivered >= 0),
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_reservation_lines_reservation on inventory_reservation_lines (reservation_id);
create index if not exists idx_reservation_lines_category on inventory_reservation_lines (category_id);
create index if not exists idx_reservation_lines_warehouse on inventory_reservation_lines (warehouse_id);

-- Trigger updated_at (asume que existe la función set_updated_at de mig 01/07)
drop trigger if exists trg_reservation_lines_updated on inventory_reservation_lines;
create trigger trg_reservation_lines_updated before update on inventory_reservation_lines
  for each row execute function set_updated_at();

-- Constraint: qty_delivered no puede superar qty_reserved
alter table inventory_reservation_lines
  add constraint check_delivered_le_reserved
  check (qty_delivered <= qty_reserved);

commit;

-- Uso: para saber cuánto stock EFECTIVO hay disponible por categoría/bodega:
--   available = count(items in_stock) − sum(qty_reserved − qty_delivered) por línea activa
-- Ejemplo:
--   select
--     ic.name,
--     (select count(*) from inventory_items i
--       where i.category_id = ic.id and i.warehouse_id = w.id and i.status = 'in_stock')
--     − coalesce((
--         select sum(rl.qty_reserved - rl.qty_delivered)
--         from inventory_reservation_lines rl
--         join inventory_reservations r on r.id = rl.reservation_id
--         where rl.category_id = ic.id and rl.warehouse_id = w.id
--           and r.status not in ('fulfilled','cancelled')
--       ), 0) as disponible
--   from inventory_categories ic, warehouses w;
