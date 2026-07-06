-- ─────────────────────────────────────────────────────────────────
-- Phase 45 — Transferencias con flujo de estados completo
--
-- Estados nuevos:
--   reserved            (al crear — items apartados en origen)
--   in_transit          (despachado del origen al destino)
--   received            (llegó a destino) [TERMINAL OK]
--   in_transit_return   (cancelado en tránsito, viaje de vuelta)
--   returned            (llegó de vuelta al origen) [TERMINAL CANCEL]
--   cancelled           (cancelado antes de despachar) [TERMINAL CANCEL]
--
-- Estado viejo 'draft' se conserva para transferencias legacy que aún
-- no hayan sido confirmadas.
--
-- Items ahora aceptan status='in_transit' además de los previos.
-- ─────────────────────────────────────────────────────────────────

begin;

-- 1. Extender check constraint de inventory_transfers.status
alter table inventory_transfers drop constraint if exists inventory_transfers_status_check;
alter table inventory_transfers add constraint inventory_transfers_status_check
  check (status in ('draft', 'reserved', 'in_transit', 'received',
                    'in_transit_return', 'returned', 'cancelled'));

-- 2. Agregar timestamps para las transiciones nuevas
alter table inventory_transfers
  add column if not exists reserved_at        timestamptz,
  add column if not exists return_shipped_at  timestamptz,
  add column if not exists returned_at        timestamptz,
  add column if not exists reserved_by        text,
  add column if not exists return_shipped_by  text,
  add column if not exists returned_by        text;

-- 3. Extender check constraint de inventory_items.status para permitir in_transit
alter table inventory_items drop constraint if exists inventory_items_status_check;
alter table inventory_items add constraint inventory_items_status_check
  check (status in ('in_stock', 'reserved', 'installed', 'in_repair',
                    'rma', 'decommissioned', 'lost', 'in_transit'));

-- 4. Extender check de inventory_movements.type para transferencias completas
alter table inventory_movements drop constraint if exists inventory_movements_type_check;
alter table inventory_movements add constraint inventory_movements_type_check
  check (type in ('receive', 'install', 'uninstall', 'transfer',
                  'repair_start', 'repair_end', 'rma_send', 'rma_return',
                  'decommission', 'adjust_quantity', 'reserve', 'unreserve',
                  'ship', 'receive_at_destination', 'return_ship', 'return_arrived'));

commit;

-- Verificación:
-- select constraint_name, check_clause from information_schema.check_constraints
--  where constraint_name like '%transfers_status%' or constraint_name like '%items_status%';
