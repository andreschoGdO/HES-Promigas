-- ============================================================================
-- Cleanup: eliminar Ventas e Ingeniería del CRM
-- ============================================================================
-- Borra físicamente los proyectos que están en módulos 'sales' o 'engineering'
-- (que ya no tienen UI). Sus eventos de audit se borran también.
--
-- Proyectos en 'operations' o 'closed' permanecen intactos (incluido su
-- historial de eventos, aunque tengan transiciones desde sales/engineering
-- en su audit log — eso es historia válida).
--
-- Las columnas sales_stage / engineering_stage en crm_projects NO se borran:
-- proyectos sobrevivientes pueden tener valores como 'completado' allí, y
-- la app las mantiene por compatibilidad de schema.
--
-- ¡EJECUTAR EN SUPABASE SQL EDITOR! Esta operación es IRREVERSIBLE.
-- Ejecutar dentro de una transacción para revisar antes del COMMIT.
-- ============================================================================

BEGIN;

-- 1. Inspeccionar primero (no destructivo)
SELECT current_module, COUNT(*) AS proyectos
FROM crm_projects
WHERE current_module IN ('sales', 'engineering')
GROUP BY current_module
ORDER BY current_module;

-- 2. Borrar eventos de audit de proyectos sales/engineering
DELETE FROM crm_project_events
WHERE project_id IN (
  SELECT id FROM crm_projects
  WHERE current_module IN ('sales', 'engineering')
);

-- 3. Borrar los proyectos
DELETE FROM crm_projects
WHERE current_module IN ('sales', 'engineering');

-- 4. Confirmar que no queden
SELECT current_module, COUNT(*) AS proyectos_restantes
FROM crm_projects
GROUP BY current_module
ORDER BY current_module;

-- Si los conteos del paso 4 muestran solo 'operations' y/o 'closed', hacer COMMIT.
-- Si algo no cuadra (ej. errores de FK por reserva/visita huérfana), hacer ROLLBACK
-- y reportar para ajustar.

-- COMMIT;
-- ROLLBACK;
