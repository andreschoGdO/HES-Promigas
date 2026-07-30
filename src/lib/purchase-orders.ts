/**
 * Reglas compartidas del módulo de Órdenes de Compra, usadas por varias
 * rutas de /api/purchase-orders y /api/budget — un solo lugar para no
 * repetir la definición de "ejecutado" en cada endpoint.
 */

/**
 * Un kWp asignado a una casa cuenta como "ejecutado" solo cuando el
 * proyecto CRM de esa casa ya arrancó instalación física (no basta con
 * estar asignado a la OC — eso es "comprometido", no gastado).
 */
export const EXECUTED_OPERATIONS_STAGES = [
  'instalacion',
  'legalizacion',
  'operativo',
  'logistica_inversa',
  'legalizado',
  'completado',
] as const;

export function isExecutedStage(stage: string | null | undefined): boolean {
  return !!stage && (EXECUTED_OPERATIONS_STAGES as readonly string[]).includes(stage);
}

export const PURCHASE_ORDER_CATEGORIES = [
  'Inversor',
  'Batería',
  'BMS',
  'Equipos adicionales',
  'Medidores',
  'Modem',
  'Paneles',
  'Puntos de anclaje',
  'Análisis estructural',
  'Mano de obra',
  'Factibilidad',
  'Otro',
] as const;
