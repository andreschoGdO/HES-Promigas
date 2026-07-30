-- ─────────────────────────────────────────────────────────────────
-- Phase 56 — Órdenes de Compra
--
-- Hoy el costo de cada casa vive solo en `facturacion_records` (una fila
-- por proyecto). No hay trazabilidad de qué Orden de Compra pagó qué casa,
-- ni de que una OC se reparte entre varias casas, ni de que una casa puede
-- estar financiada por más de una OC.
--
-- `purchase_orders` = cabecera de la OC (numero, proveedor, kWp total,
-- valor total, PDF).
-- `purchase_order_solution_prices` = precio $/kWp por "solución" (1-4)
-- dentro de la misma OC — nullable, una OC puede tener un solo precio.
-- `purchase_order_items` = líneas de detalle (mano de obra, medidores...).
--   `categoria` usa la MISMA lista de nombres que `budget_items.grupo_nombre`
--   (fase 58) para poder agregar presupuesto-vs-ejecutado sin acoplar tablas.
-- `purchase_order_house_assignments` = N:N casa↔OC con el kWp que le
--   corresponde a esa casa de esa OC. "Ejecutado" NO se guarda acá — se
--   deriva en query cruzando con `crm_projects.operations_stage`.
-- ─────────────────────────────────────────────────────────────────

create table if not exists purchase_orders (
  id uuid primary key default gen_random_uuid(),
  numero_oc text not null unique,
  proveedor text not null,
  fecha_documento date,
  fecha_entrega date,
  condiciones_pago text,
  moneda text not null default 'COP',
  kwp_total numeric not null check (kwp_total > 0),
  valor_total numeric not null check (valor_total >= 0),
  observaciones text,
  pdf_storage_path text,                   -- bucket 'purchase-orders' (privado, signed URL — mismo patrón que visit-photos)
  created_by text,
  updated_by text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

drop trigger if exists trg_purchase_orders_updated on purchase_orders;
create trigger trg_purchase_orders_updated before update on purchase_orders
  for each row execute function set_updated_at();

create table if not exists purchase_order_solution_prices (
  id uuid primary key default gen_random_uuid(),
  oc_id uuid not null references purchase_orders(id) on delete cascade,
  solucion int check (solucion between 1 and 4),   -- null = precio único de la OC (no diferencia por solución)
  precio_kwp numeric not null check (precio_kwp >= 0),
  unique (oc_id, solucion)
);

create table if not exists purchase_order_items (
  id uuid primary key default gen_random_uuid(),
  oc_id uuid not null references purchase_orders(id) on delete cascade,
  posicion int not null,
  categoria text not null,
  codigo_servicio text,
  descripcion text not null,
  cantidad numeric,
  unidad text,
  precio_unitario numeric,
  valor_total numeric not null check (valor_total >= 0)
);

create index if not exists idx_oc_items_oc on purchase_order_items (oc_id);

create table if not exists purchase_order_house_assignments (
  id uuid primary key default gen_random_uuid(),
  oc_id uuid not null references purchase_orders(id) on delete cascade,
  project_id uuid not null references crm_projects(id) on delete cascade,
  kwp_asignado numeric not null check (kwp_asignado > 0),
  solucion int check (solucion between 1 and 4),
  created_by text,
  created_at timestamptz default now(),
  unique (oc_id, project_id)
);

create index if not exists idx_oc_assign_oc on purchase_order_house_assignments (oc_id);
create index if not exists idx_oc_assign_project on purchase_order_house_assignments (project_id);
