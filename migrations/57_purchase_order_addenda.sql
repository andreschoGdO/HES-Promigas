-- ─────────────────────────────────────────────────────────────────
-- Phase 57 — Adicionales ("otrosí") de una Orden de Compra
--
-- Cuando al contratista le queda faltando cobrar algo de una casa ya
-- asignada a una OC, se pide un adicional. Un adicional vincula 1:1 con
-- UNA OC (`oc_id`), pero una OC puede tener varios adicionales a lo largo
-- del tiempo. La suma de los `valor_total` de los adicionales de una OC no
-- debería superar el 10% de `purchase_orders.valor_total` — se valida en
-- la API al crear/editar (ver src/app/api/purchase-orders/addenda), no acá
-- con un check de SQL porque cruza dos tablas.
-- ─────────────────────────────────────────────────────────────────

create table if not exists purchase_order_addenda (
  id uuid primary key default gen_random_uuid(),
  numero_adicional text not null,
  oc_id uuid not null references purchase_orders(id) on delete cascade,
  fecha date,
  motivo text,
  solicitado_por text,
  aprobado_por text,
  valor_total numeric not null check (valor_total >= 0),
  pdf_storage_path text,
  created_by text,
  created_at timestamptz default now(),
  unique (oc_id, numero_adicional)
);

create index if not exists idx_oc_addenda_oc on purchase_order_addenda (oc_id);

create table if not exists purchase_order_addendum_items (
  id uuid primary key default gen_random_uuid(),
  addendum_id uuid not null references purchase_order_addenda(id) on delete cascade,
  posicion int not null,
  categoria text not null,
  descripcion text not null,
  cantidad numeric,
  unidad text,
  precio_unitario numeric,
  valor_total numeric not null check (valor_total >= 0)
);

create index if not exists idx_oc_addendum_items_addendum on purchase_order_addendum_items (addendum_id);

-- % del adicional que le corresponde a cada casa — distinto por casa, con
-- su propio detalle en texto libre (todo lo demás del adicional es global
-- de la OC/adicional, ya asignada esa casa a la OC principal).
create table if not exists purchase_order_addendum_house_assignments (
  id uuid primary key default gen_random_uuid(),
  addendum_id uuid not null references purchase_order_addenda(id) on delete cascade,
  project_id uuid not null references crm_projects(id) on delete cascade,
  porcentaje numeric not null check (porcentaje > 0 and porcentaje <= 100),
  detalle text,
  created_by text,
  created_at timestamptz default now(),
  unique (addendum_id, project_id)
);

create index if not exists idx_oc_addendum_assign_addendum on purchase_order_addendum_house_assignments (addendum_id);
create index if not exists idx_oc_addendum_assign_project on purchase_order_addendum_house_assignments (project_id);
