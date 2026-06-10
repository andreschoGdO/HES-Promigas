-- ─────────────────────────────────────────────────────────────────
-- Phase 22 — Quitar campo "ID reserva inventario" de la transición
-- Alistamiento → Instalación
--
-- El flujo real no usa la tabla `inventory_reservations` (la operación es
-- pequeña, se va por equipo a bodega y se escanean los seriales en la
-- visita de instalación). El picker quedaba vacío y confundía al usuario.
--
-- Esta migration elimina la configuración persistida en crm_stage_fields.
-- crm-stages.ts también fue actualizado para no re-sembrar este campo.
-- ─────────────────────────────────────────────────────────────────

delete from crm_stage_fields
 where module = 'operations'
   and stage = 'instalacion'
   and field_key = 'reservation_id';
