-- ─────────────────────────────────────────────────────────────────
-- Phase 35 — Allowlist explícita de usuarios contratistas
--
-- Los admins (correos @gdo.com.co / @promigas.com / @promigas.com.co)
-- entran automáticamente por regla de dominio (ver lib/user-role.ts).
--
-- Los users (cualquier otro dominio = contratistas externos) requieren
-- estar EXPLÍCITAMENTE en esta tabla con enabled=true para acceder. Si
-- no están, el middleware:
--   1. Inserta una fila con enabled=false (estado "pending")
--   2. Cierra su sesión
--   3. Redirige a /login con error=pending
--
-- El admin gestiona desde /usuarios: ve la lista de pendientes y los
-- habilita uno por uno. Sin esto, un email arbitrario podría llegar a
-- la sesión y crear visitas basura.
-- ─────────────────────────────────────────────────────────────────

create table if not exists user_allowlist (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  enabled boolean not null default false,
  note text,
  added_by text,          -- email del admin que habilitó/agregó
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Unique case-insensitive para evitar duplicados por mayúsculas
create unique index if not exists uniq_user_allowlist_email_lc
  on user_allowlist (lower(email));

create index if not exists idx_user_allowlist_enabled
  on user_allowlist (enabled, created_at desc);

comment on table user_allowlist is
  'Allowlist explícita de usuarios contratistas. Admins (gdo/promigas) entran auto por dominio; otros emails deben estar acá con enabled=true. Gestionada desde /usuarios.';
