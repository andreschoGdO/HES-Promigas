-- ─────────────────────────────────────────────────────────────────
-- Phase 53 — Enlace de devices con Deye Cloud (developer.deyecloud.com)
--
-- Al enviar comandos por /api/inverter/command, el adapter Deye
-- (src/lib/deye-cloud.ts) necesita saber a qué deviceSn / stationId
-- de Deye Cloud corresponde cada inversor local. Añadimos ambas
-- columnas nullables; sin ellas el adapter retorna status='unavailable'
-- (reason='no_device_sn') y el endpoint marca el comando como 'mocked'.
--
-- Cómo se llenan (manual, hasta que haya import batch):
--   update devices
--      set deye_device_sn = '<sn del inversor en Deye>',
--          deye_station_id = '<id de la planta en Deye>'
--    where id = '<uuid del inversor>';
-- ─────────────────────────────────────────────────────────────────

alter table devices
  add column if not exists deye_device_sn  text,
  add column if not exists deye_station_id text;

-- Índice de búsqueda inversa (deviceSn → device) para el day cuando
-- Deye envíe callbacks / webhooks al backend.
create index if not exists idx_devices_deye_device_sn
  on devices (deye_device_sn)
  where deye_device_sn is not null;
