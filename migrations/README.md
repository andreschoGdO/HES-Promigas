# Supabase migrations

Migraciones SQL del proyecto. **Correr en orden** (00 → 17) sobre la BD Supabase usando el SQL Editor del dashboard o vía CLI.

| Archivo | Qué hace |
|---|---|
| `00_schema.sql` | Schema base — tablas iniciales (devices, etc.) |
| `01_phase1.sql` | Cierres diarios + helpers |
| `02_casa_metrics.sql` | Tabla agregada `daily_casa_metrics` |
| `03_alerts.sql` | Tablas `alert_rules` + `alert_events` |
| `04_alarms.sql` | Flags de alarma del inversor en `devices.alarm_flags` |
| `05_control.sql` | Tabla `inverter_commands` |
| `06_visits.sql` | Visitas en campo (`field_visits` + `visit_photos`) |
| `07_inventory.sql` | Inventario WMS-lite (items, locations, categories) |
| `08_voltage.sql` | Tabla `instant_metrics` para lazo 15 min |
| `09_wms.sql` | Reservas, consumables, movements del inventario |
| `10_crm.sql` | Workflow CRM tri-modular (sales/engineering/operations) |
| `11_stage_fields.sql` | Campos configurables por etapa del CRM |
| `12_battery_alerts.sql` | Reglas seed de batería (20-80%) |
| `13_operations_dimensionamiento.sql` | Etapa "dimensionamiento" en Operations |
| `14_dimensionado.sql` | Rename → "dimensionado" + nuevos campos casa |
| `15_planner.sql` | Tabla `planner_tasks` (Planner module) |
| `16_app_settings.sql` | Key-value global para sidebar visibility + granular views |
| `17_planner_team.sql` | Columna `team` en `planner_tasks` |

## Otros archivos relacionados

- `../supabase_email_template_magic_link.html` — plantilla HTML para email de auth magic link (configurar en Supabase Auth dashboard, no es SQL)
