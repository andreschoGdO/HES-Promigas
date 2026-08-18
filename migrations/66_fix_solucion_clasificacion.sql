-- ─────────────────────────────────────────────────────────────────
-- Phase 66 — Corrige facturacion_records.solucion para que coincida
-- con la clasificación real por # de paneles (mismos umbrales que ya
-- usa /api/dash/report para el gráfico "Casas por mes, por solución":
-- sol1 ≤5, sol2 ≤10, sol3 ≤16, sol4 resto).
--
-- El campo `solucion` se había quedado con etiquetas manuales/viejas
-- que no coincidían: 3 casas de 5 paneles estaban en "2" (debían ser
-- "1" — por eso la tarjeta "USD/Wp por Solución" del Dash nunca
-- mostraba Solución 1), y 4 casas de 15-16 paneles estaban en "4"
-- (debían ser "3").
-- ─────────────────────────────────────────────────────────────────

update facturacion_records f
set solucion = case
  when p.diseno_paneles <= 5 then '1'
  when p.diseno_paneles <= 10 then '2'
  when p.diseno_paneles <= 16 then '3'
  else '4'
end
from crm_projects p
where p.id = f.project_id and p.diseno_paneles is not null;
