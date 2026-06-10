-- ─────────────────────────────────────────────────────────────────
-- Phase 28 — Transferencias formales entre bodegas (guía de remisión)
--
-- A diferencia del bulk-transfer instantáneo (phase 27), aquí los items
-- viven en estado intermedio "en tránsito" mientras se mueven físicamente
-- entre bodegas remotas. Tres estados:
--
--   draft       → preparando, líneas editables, items aún en bodega origen
--   in_transit  → enviado, items en estado intermedio, esperando recepción
--   received    → recibido en destino, items con warehouse_id = destino
--   cancelled   → revertido (items vuelven a la bodega origen)
--
-- Cada transferencia tiene un código autogenerado TRF-YYYY-NNNN y puede
-- tener N líneas de items serializados + N líneas de consumibles con qty.
-- ─────────────────────────────────────────────────────────────────

create table if not exists inventory_transfers (
  id uuid primary key default gen_random_uuid(),
  code text unique,                                -- TRF-YYYY-NNNN autogenerado
  from_warehouse_id uuid references warehouses(id) on delete set null,
  to_warehouse_id uuid references warehouses(id) on delete set null,
  status text not null default 'draft'
    check (status in ('draft', 'in_transit', 'received', 'cancelled')),
  shipped_at timestamptz,
  received_at timestamptz,
  cancelled_at timestamptz,
  shipped_by text,
  received_by text,
  carrier text,                                    -- transportadora
  tracking_number text,
  notes text,
  created_by text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_transfers_status on inventory_transfers (status, created_at desc);
create index if not exists idx_transfers_from on inventory_transfers (from_warehouse_id);
create index if not exists idx_transfers_to on inventory_transfers (to_warehouse_id);

drop trigger if exists trg_transfers_updated on inventory_transfers;
create trigger trg_transfers_updated before update on inventory_transfers
  for each row execute function set_updated_at();

-- Líneas de equipos serializados
create table if not exists inventory_transfer_items (
  id uuid primary key default gen_random_uuid(),
  transfer_id uuid not null references inventory_transfers(id) on delete cascade,
  item_id uuid not null references inventory_items(id) on delete restrict,
  picked boolean not null default false,
  received boolean not null default false,
  notes text,
  created_at timestamptz default now()
);

create index if not exists idx_transfer_items_transfer on inventory_transfer_items (transfer_id);
create index if not exists idx_transfer_items_item on inventory_transfer_items (item_id);
create unique index if not exists uniq_transfer_item on inventory_transfer_items (transfer_id, item_id);

-- Líneas de consumibles con cantidad
create table if not exists inventory_transfer_consumables (
  id uuid primary key default gen_random_uuid(),
  transfer_id uuid not null references inventory_transfers(id) on delete cascade,
  consumable_id uuid not null references inventory_consumables(id) on delete restrict,
  quantity numeric not null check (quantity > 0),
  received_quantity numeric,                       -- puede diferir al recibir (pérdida en tránsito)
  notes text,
  created_at timestamptz default now()
);

create index if not exists idx_transfer_cons_transfer on inventory_transfer_consumables (transfer_id);
create unique index if not exists uniq_transfer_cons on inventory_transfer_consumables (transfer_id, consumable_id);

-- Función para autogenerar el código TRF-YYYY-NNNN
create or replace function transfer_generate_code()
returns text
language plpgsql
as $$
declare
  yr text := to_char(now(), 'YYYY');
  next_seq int;
begin
  select coalesce(max((regexp_match(code, 'TRF-' || yr || '-(\d+)'))[1]::int), 0) + 1
    into next_seq
    from inventory_transfers
    where code like 'TRF-' || yr || '-%';
  return 'TRF-' || yr || '-' || lpad(next_seq::text, 4, '0');
end;
$$;

create or replace function transfer_set_code_trigger()
returns trigger
language plpgsql
as $$
begin
  if new.code is null or new.code = '' then
    new.code := transfer_generate_code();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_transfer_set_code on inventory_transfers;
create trigger trg_transfer_set_code before insert on inventory_transfers
  for each row execute function transfer_set_code_trigger();
